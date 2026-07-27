import type {
  TransactionCategory, TransactionDirection, ClassificationSource,
} from '@kynox/shared-types';
import { CATEGORY_DIRECTION } from '@kynox/shared-types';
import { parseNumber } from './parsers';

/**
 * Source-independent transaction classification.
 *
 * Determines transaction DIRECTION (IN / OUT / NEUTRAL / UNKNOWN), CATEGORY
 * (receipt, consumption, transfer, return, adjustment, reversal, …) and a
 * canonical SIGNED quantity (+ increases stock, − decreases) using an explicit
 * priority ladder — never quantity sign alone.
 *
 * SAP-specific movement-type numeric codes live in the SAP adapter
 * (`sapMovementTypeCategory`) and are NOT baked into the generic classifier or
 * the analytics engine.
 */

export interface ClassifyInput {
  rawQuantity?: string | number | null;
  /** Value of an explicit direction column ("IN"/"OUT"/"receipt"/"issue"/"+"/"-"). */
  directionHint?: string | null;
  /** Transaction / movement type code (e.g. generic "GRN", or SAP "261"). */
  typeCode?: string | null;
  /** Transaction / movement type description ("Goods Issue", "Transfer Posting"). */
  typeDescription?: string | null;
  /** Debit/credit indicator ("S"/"H", "D"/"C", "debit"/"credit", "+"/"-"). */
  debitCredit?: string | null;
  /** Separate receipt / consumption columns (mutually exclusive per row). */
  receiptQty?: string | number | null;
  consumptionQty?: string | number | null;
  openingQty?: number | null;
  closingQty?: number | null;
  /** When the source is SAP, the adapter result is trusted above generic keywords. */
  sapMovementType?: string | null;
}

export interface ClassifyResult {
  direction: TransactionDirection;
  category: TransactionCategory;
  parsedQuantity: number | null;
  absoluteQuantity: number | null;
  signedQuantity: number | null;
  receiptQuantity: number | null;
  consumptionQuantity: number | null;
  originalSign: -1 | 0 | 1 | null;
  normalizedSign: -1 | 0 | 1 | null;
  signConflict: boolean;
  directionConflict: boolean;
  classificationSource: ClassificationSource;
  classificationConfidence: number;   // 0..1
  warnings: string[];
  /** Both receipt and consumption populated on one row. */
  simultaneousReceiptAndConsumption: boolean;
}

const sign = (n: number | null): -1 | 0 | 1 | null =>
  n == null ? null : n > 0 ? 1 : n < 0 ? -1 : 0;

// --- keyword dictionaries (generic, source-neutral) ------------------------
const RX = {
  reversal: /revers|storno|cancel(l)?ation|cancelled|reverse|undo/i,
  transfer: /transfer|stock\s*transfer|transfer\s*posting|move(ment)?\s*between|relocat|inter[-\s]?warehouse/i,
  ret: /return|rma|goods\s*return/i,
  toSupplier: /supplier|vendor|to\s*supplier|to\s*vendor/i,
  fromSource: /from\s*(user|project|production|customer|shop\s*floor)|customer\s*return|production\s*return/i,
  adjustment: /adjust|correction|write[-\s]?off|scrap|damage|expir|obsolet|loss|gain/i,
  count: /physical\s*(inventory|count)|cycle\s*count|stock\s*count|count\b/i,
  receipt: /receipt|grn|goods\s*receipt|purchase|inbound|delivery\s*in|put\s*away|received/i,
  issue: /issue|goods\s*issue|consum|withdrawal|pick(ing)?|outbound|delivery\s*out|used|usage/i,
  opening: /opening(\s*balance)?|brought\s*forward|b\/?f/i,
  closing: /closing(\s*balance)?|carried\s*forward|c\/?f/i,
  reservation: /reservation|reserved/i,
  blocked: /block(ed)?/i,
  quality: /quality|inspection|qc\b/i,
  in: /^\s*(in|\+|receipt|received|debit|dr)\s*$/i,
  out: /^\s*(out|-|issue|issued|credit|cr)\s*$/i,
};

export function parseDirectionHint(hint?: string | null): TransactionDirection | null {
  if (!hint) return null;
  const s = String(hint).trim();
  if (RX.in.test(s)) return 'IN';
  if (RX.out.test(s)) return 'OUT';
  if (/neutral|none|transfer/i.test(s)) return 'NEUTRAL';
  return null;
}

export function parseDebitCredit(dc?: string | null): TransactionDirection | null {
  if (!dc) return null;
  const s = String(dc).trim().toLowerCase();
  if (['s', 'd', 'debit', 'dr', '+'].includes(s)) return 'IN';   // SAP 'S' (Soll) = debit = stock in
  if (['h', 'c', 'credit', 'cr', '-'].includes(s)) return 'OUT'; // SAP 'H' (Haben) = credit = stock out
  return null;
}

/**
 * Generic keyword classification of a transaction type. `signHint` (from the
 * quantity) only decides IN vs OUT variants of transfers/adjustments/reversals
 * when the text itself does not.
 */
export function classifyGenericType(
  typeCode?: string | null, typeDescription?: string | null, signHint?: -1 | 0 | 1 | null,
): { category: TransactionCategory; confidence: number } | null {
  const text = `${typeCode ?? ''} ${typeDescription ?? ''}`.trim();
  if (!text) return null;
  const outward = signHint === -1;

  if (RX.reversal.test(text)) {
    // Reversal of an issue restores stock (IN); reversal of a receipt removes it (OUT).
    if (RX.issue.test(text) || outward === false && RX.receipt.test(text) === false && signHint === 1) {
      return { category: 'REVERSAL_IN', confidence: 0.8 };
    }
    if (RX.receipt.test(text)) return { category: 'REVERSAL_OUT', confidence: 0.8 };
    return { category: outward ? 'REVERSAL_OUT' : 'REVERSAL_IN', confidence: 0.6 };
  }
  if (RX.transfer.test(text)) {
    return { category: outward ? 'TRANSFER_OUT' : 'TRANSFER_IN', confidence: 0.75 };
  }
  if (RX.ret.test(text)) {
    if (RX.toSupplier.test(text)) return { category: 'RETURN_OUT', confidence: 0.8 };
    if (RX.fromSource.test(text)) return { category: 'RETURN_IN', confidence: 0.8 };
    return { category: outward ? 'RETURN_OUT' : 'RETURN_IN', confidence: 0.6 };
  }
  if (RX.count.test(text)) return { category: 'STOCK_COUNT', confidence: 0.7 };
  if (RX.adjustment.test(text)) {
    return { category: outward ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN', confidence: 0.7 };
  }
  if (RX.opening.test(text)) return { category: 'OPENING_BALANCE', confidence: 0.85 };
  if (RX.closing.test(text)) return { category: 'CLOSING_BALANCE', confidence: 0.85 };
  if (RX.reservation.test(text)) return { category: 'RESERVATION', confidence: 0.8 };
  if (RX.blocked.test(text)) return { category: 'BLOCKED_STOCK', confidence: 0.75 };
  if (RX.quality.test(text)) return { category: 'QUALITY_INSPECTION', confidence: 0.75 };
  if (RX.receipt.test(text)) return { category: 'RECEIPT', confidence: 0.8 };
  if (RX.issue.test(text)) return { category: 'CONSUMPTION', confidence: 0.8 };
  return null;
}

/**
 * SAP adapter: maps SAP BWART movement types to canonical categories. Kept
 * separate from the generic engine so SAP semantics never leak into generic
 * analytics. Reversal codes (2nd digit) offset their base movement.
 */
export function sapMovementTypeCategory(code?: string | null): { category: TransactionCategory; confidence: number } | null {
  if (!code) return null;
  const c = String(code).trim();
  const map: Record<string, TransactionCategory> = {
    '101': 'RECEIPT', '105': 'RECEIPT', '501': 'RECEIPT', '511': 'RECEIPT', '531': 'RECEIPT',
    '561': 'OPENING_BALANCE',
    '201': 'CONSUMPTION', '261': 'CONSUMPTION', '221': 'CONSUMPTION', '241': 'CONSUMPTION',
    '281': 'CONSUMPTION', '601': 'CONSUMPTION',
    '311': 'TRANSFER_OUT', '301': 'TRANSFER_OUT', '303': 'TRANSFER_OUT', '351': 'TRANSFER_OUT',
    '312': 'TRANSFER_IN', '302': 'TRANSFER_IN', '304': 'TRANSFER_IN', '352': 'TRANSFER_IN',
    '122': 'RETURN_OUT', '161': 'RETURN_OUT',
    '453': 'RETURN_IN', '653': 'RETURN_IN',
    '701': 'ADJUSTMENT_IN', '703': 'ADJUSTMENT_IN', '707': 'ADJUSTMENT_IN',
    '702': 'ADJUSTMENT_OUT', '704': 'ADJUSTMENT_OUT', '708': 'ADJUSTMENT_OUT',
    // Reversals (issue reversals restore stock; receipt reversals remove it)
    '102': 'REVERSAL_OUT', '502': 'REVERSAL_OUT', '532': 'REVERSAL_OUT',
    '202': 'REVERSAL_IN', '262': 'REVERSAL_IN', '222': 'REVERSAL_IN', '242': 'REVERSAL_IN',
    '344': 'BLOCKED_STOCK', '343': 'BLOCKED_STOCK',
  };
  const category = map[c];
  return category ? { category, confidence: 0.95 } : null;
}

/** Directional category pairs whose IN/OUT variant follows the resolved direction. */
const CATEGORY_PAIR: Partial<Record<TransactionCategory, { in: TransactionCategory; out: TransactionCategory }>> = {
  TRANSFER_IN: { in: 'TRANSFER_IN', out: 'TRANSFER_OUT' },
  TRANSFER_OUT: { in: 'TRANSFER_IN', out: 'TRANSFER_OUT' },
  RETURN_IN: { in: 'RETURN_IN', out: 'RETURN_OUT' },
  RETURN_OUT: { in: 'RETURN_IN', out: 'RETURN_OUT' },
  ADJUSTMENT_IN: { in: 'ADJUSTMENT_IN', out: 'ADJUSTMENT_OUT' },
  ADJUSTMENT_OUT: { in: 'ADJUSTMENT_IN', out: 'ADJUSTMENT_OUT' },
  REVERSAL_IN: { in: 'REVERSAL_IN', out: 'REVERSAL_OUT' },
  REVERSAL_OUT: { in: 'REVERSAL_IN', out: 'REVERSAL_OUT' },
};

function alignCategory(category: TransactionCategory, direction: TransactionDirection): TransactionCategory {
  const pair = CATEGORY_PAIR[category];
  if (!pair || (direction !== 'IN' && direction !== 'OUT')) return category;
  return direction === 'IN' ? pair.in : pair.out;
}

function signedFor(direction: TransactionDirection, abs: number | null, rawSigned: number | null): number | null {
  if (abs == null) return null;
  if (direction === 'IN') return abs;
  if (direction === 'OUT') return -abs;
  if (direction === 'NEUTRAL') return 0;
  return rawSigned;   // UNKNOWN: preserve the imported sign
}

/**
 * Handles files with separate Receipt / Consumption columns. Receipts become
 * positive, consumption negative; both populated on one row is flagged, never
 * silently netted.
 */
export function classifySeparateColumns(receiptQty?: string | number | null, consumptionQty?: string | number | null): ClassifyResult | null {
  const r = parseNumber(receiptQty ?? null).value;
  const c = parseNumber(consumptionQty ?? null).value;
  const rNon = r != null && r !== 0;
  const cNon = c != null && c !== 0;
  if (!rNon && !cNon && r == null && c == null) return null; // neither column present

  const warnings: string[] = [];
  let direction: TransactionDirection;
  let category: TransactionCategory;
  let signed: number | null;
  let simultaneous = false;

  if (rNon && cNon) {
    simultaneous = true;
    warnings.push('Both receipt and consumption quantities are populated on the same row; kept separate for review (not netted).');
    direction = 'UNKNOWN';
    category = 'UNKNOWN';
    signed = null;
  } else if (rNon) {
    direction = 'IN'; category = 'RECEIPT'; signed = Math.abs(r as number);
  } else if (cNon) {
    direction = 'OUT'; category = 'CONSUMPTION'; signed = -Math.abs(c as number);
  } else {
    direction = 'NEUTRAL'; category = 'NEUTRAL'; signed = 0;
  }

  return {
    direction, category,
    parsedQuantity: signed,
    absoluteQuantity: signed == null ? null : Math.abs(signed),
    signedQuantity: signed,
    receiptQuantity: r, consumptionQuantity: c,
    originalSign: null, normalizedSign: sign(signed),
    signConflict: false, directionConflict: false,
    classificationSource: 'separate_quantity_columns',
    classificationConfidence: simultaneous ? 0.3 : 0.9,
    warnings, simultaneousReceiptAndConsumption: simultaneous,
  };
}

/** Full classification using the priority ladder. */
export function classifyTransaction(input: ClassifyInput): ClassifyResult {
  // 4. Separate receipt / consumption columns take precedence when present.
  if (input.receiptQty != null || input.consumptionQty != null) {
    const sep = classifySeparateColumns(input.receiptQty, input.consumptionQty);
    if (sep) return sep;
  }

  const parsed = parseNumber(input.rawQuantity ?? null).value;
  const abs = parsed == null ? null : Math.abs(parsed);
  const rawSign = sign(parsed);
  const warnings: string[] = [];
  // Whether the source provided a transaction-type signal at all. When it did
  // but we could not recognise it, the category stays UNKNOWN (never forced
  // into RECEIPT/CONSUMPTION) even if a direction can be inferred.
  const hadType = !!(input.typeCode || input.typeDescription || input.sapMovementType);

  let category: TransactionCategory = 'UNKNOWN';
  let direction: TransactionDirection = 'UNKNOWN';
  let source: ClassificationSource = 'unknown';
  let confidence = 0;

  // 8/3. Source adapter (SAP) then generic type keywords define the category.
  const typed = (input.sapMovementType ? sapMovementTypeCategory(input.sapMovementType) : null)
    ?? classifyGenericType(input.typeCode, input.typeDescription, rawSign);
  if (typed) {
    category = typed.category;
    direction = CATEGORY_DIRECTION[category];
    source = input.sapMovementType ? 'source_adapter' : 'transaction_type';
    confidence = typed.confidence;
  }

  // 1/2. Explicit direction / receipt-issue indicator (highest authority).
  const explicitDir = parseDirectionHint(input.directionHint);
  if (explicitDir) {
    if (direction !== 'UNKNOWN' && direction !== 'NEUTRAL' && explicitDir !== 'NEUTRAL' && explicitDir !== direction) {
      warnings.push(`Explicit direction "${input.directionHint}" (${explicitDir}) overrides type-derived ${direction}.`);
    }
    direction = explicitDir;
    source = 'explicit_direction_field';
    confidence = Math.max(confidence, 0.9);
    category = category === 'UNKNOWN'
      ? (explicitDir === 'IN' ? 'RECEIPT' : explicitDir === 'OUT' ? 'CONSUMPTION' : 'NEUTRAL')
      : alignCategory(category, explicitDir);
  }

  // 5. Debit / credit indicator.
  if (direction === 'UNKNOWN') {
    const dc = parseDebitCredit(input.debitCredit);
    if (dc) { direction = dc; source = 'debit_credit_indicator'; confidence = Math.max(confidence, 0.8); if (category === 'UNKNOWN' && !hadType) category = dc === 'IN' ? 'RECEIPT' : 'CONSUMPTION'; }
  }

  // 6. Quantity sign (last automatic resort — never on its own if we already know).
  if (direction === 'UNKNOWN' && rawSign != null && rawSign !== 0) {
    direction = rawSign > 0 ? 'IN' : 'OUT';
    source = 'quantity_sign';
    confidence = Math.max(confidence, 0.5);
    // Only infer a category from sign when NO type was supplied; a supplied but
    // unrecognised type stays UNKNOWN and visible.
    if (category === 'UNKNOWN' && !hadType) category = rawSign > 0 ? 'RECEIPT' : 'CONSUMPTION';
  }

  // 7. Opening/closing reconciliation hint.
  if (direction === 'UNKNOWN' && input.openingQty != null && input.closingQty != null && abs != null) {
    const delta = input.closingQty - input.openingQty;
    if (delta > 0) direction = 'IN';
    else if (delta < 0) direction = 'OUT';
    if (direction !== 'UNKNOWN') { source = 'balance_reconciliation'; confidence = Math.max(confidence, 0.55); }
  }

  const signed = signedFor(direction, abs, parsed);
  const normSign = sign(signed);
  const signConflict = rawSign != null && rawSign !== 0 && normSign != null && normSign !== 0 && rawSign !== normSign;
  const directionConflict =
    !!explicitDir && rawSign != null && rawSign !== 0 &&
    ((explicitDir === 'IN' && rawSign === -1) || (explicitDir === 'OUT' && rawSign === 1));

  if (signConflict) warnings.push(`Imported quantity sign (${rawSign}) differs from the classified stock effect; normalized to the classification.`);
  if (direction === 'UNKNOWN') warnings.push('Transaction direction could not be determined; left as UNKNOWN for review.');

  return {
    direction, category,
    parsedQuantity: parsed, absoluteQuantity: abs, signedQuantity: signed,
    receiptQuantity: null, consumptionQuantity: null,
    originalSign: rawSign, normalizedSign: normSign,
    signConflict, directionConflict,
    classificationSource: source,
    classificationConfidence: Math.round(confidence * 100) / 100,
    warnings,
    simultaneousReceiptAndConsumption: false,
  };
}
