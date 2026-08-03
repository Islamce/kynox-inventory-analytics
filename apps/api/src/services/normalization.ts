/**
 * Phase 2 — canonical normalization persistence service.
 *
 * This wires the Phase 1 (source-independent) engines into the real import
 * sequence. It is PURE and side-effect free: given the mapped+cleaned rows of a
 * movements dataset it produces
 *   - the `canonical_transactions` rows to persist (source-neutral, signed,
 *     classified, with the mapped source row preserved as JSON),
 *   - a dataset-level normalization summary, and
 *   - the row-anchored data-quality findings,
 * without touching the database. The route persists the rows inside the same
 * transaction that creates the dataset, so a failure rolls everything back and
 * never leaves a partially-active dataset.
 *
 * Backward compatible: the existing per-kind persistence (movements/stock/…)
 * and analytics are unchanged. Canonical rows are an ADDITIVE side-write for
 * movements/transaction datasets. SAP reports keep working because the SAP
 * adapter (`sapMovementTypeCategory`) is used when the source is SAP and ISO
 * dates parse unambiguously (never blocked).
 */
import type { MappedRow } from '@kynox/data-quality';
import {
  classifyTransaction, normalizeDateColumn, normalizeDateValue,
  dateIssues, classificationIssues,
} from '@kynox/data-quality';
import type {
  SourceSystem, SourceReportType, TransactionCategory, TransactionDirection,
  NormalizationIssue, DetectedDateFormat,
} from '@kynox/shared-types';
import type { ReportType } from '@kynox/shared-types';
import type { ColumnDateAnalysis, LocalePreference } from '@kynox/data-quality';

const NORMALIZATION_VERSION = '1.0.0';

// --- source classification --------------------------------------------------

const SAP_REPORT_TYPES: Partial<Record<ReportType, SourceReportType>> = {
  MB51: 'SAP_MB51',
  MB52: 'SAP_MB52',
  MB5B: 'SAP_MB5B',
  MMBE: 'SAP_MMBE',
  MATERIAL_MASTER: 'SAP_MATERIAL_MASTER',
  PHYSICAL_INVENTORY: 'SAP_PHYSICAL_INVENTORY',
};

/**
 * Resolves the canonical source system + report type from the stored upload
 * `source_system` hint, whether the column mapping matched real SAP technical
 * field codes (MATNR/BWART/BUDAT/…), and the detected report type.
 *
 * Report-type *shape* alone (e.g. "has material + posting_date + quantity")
 * is NOT sufficient evidence of SAP: Phase 1 deliberately unified SAP business
 * labels and fully generic synonyms into the same canonical-field vocabulary,
 * so a purely generic file can legitimately match an SAP report signature.
 * Only an explicit hint or an actual `sap_technical`-mapped column counts as
 * real SAP evidence — otherwise the source stays generic/unknown rather than
 * guessing, consistent with the rest of the normalization engine.
 */
export function classifySource(
  detectedType: string | null | undefined,
  sourceSystemHint: string | null | undefined,
  hasSapTechnicalColumn = false,
): { sourceSystem: SourceSystem; sourceReportType: SourceReportType } {
  const dt = (detectedType ?? 'UNKNOWN') as ReportType;
  const hint = (sourceSystemHint ?? '').trim().toUpperCase();

  const explicit: Record<string, SourceSystem> = {
    SAP: 'SAP', ORACLE: 'ORACLE', DYNAMICS: 'MICROSOFT_DYNAMICS',
    MICROSOFT_DYNAMICS: 'MICROSOFT_DYNAMICS', ODOO: 'ODOO',
    WMS: 'WMS', MANUAL: 'MANUAL', GENERIC: 'GENERIC_ERP', GENERIC_ERP: 'GENERIC_ERP',
  };

  const sapReport = SAP_REPORT_TYPES[dt];
  const isSap = hint === 'SAP' || hasSapTechnicalColumn;

  if (isSap) {
    return { sourceSystem: 'SAP', sourceReportType: sapReport ?? 'SAP_MB51' };
  }
  const sourceSystem = explicit[hint] ?? 'UNKNOWN';
  // Generic report-type mapping.
  const genericReport: Record<string, SourceReportType> = {
    MATERIAL_MASTER: 'GENERIC_MATERIAL_MASTER',
    PHYSICAL_INVENTORY: 'GENERIC_PHYSICAL_INVENTORY',
    MB52: 'GENERIC_INVENTORY_BALANCE',
    MMBE: 'GENERIC_INVENTORY_BALANCE',
  };
  const sourceReportType = genericReport[dt]
    ?? (dt === 'UNKNOWN' ? 'UNKNOWN_SOURCE' : 'GENERIC_ERP_TRANSACTION');
  return { sourceSystem, sourceReportType };
}

// --- summary ----------------------------------------------------------------

export interface NormalizationSummary {
  version: string;
  totalSourceRows: number;
  normalizedRows: number;
  rejectedRows: number;
  warningRows: number;
  unknownTransactionRows: number;
  receiptRows: number;
  consumptionRows: number;
  transferRows: number;
  returnRows: number;
  adjustmentRows: number;
  reversalRows: number;
  neutralRows: number;
  signConflicts: number;
  directionConflicts: number;
  totalReceiptQuantity: number;
  totalConsumptionQuantity: number;
  categoryCounts: Record<string, number>;
  directionCounts: Record<string, number>;
  dateFormat: DetectedDateFormat | null;
  dateFormatConfidence: number;
  dateFormatUserConfirmed: boolean;
  ambiguousDateRows: number;
  invalidDateRows: number;
}

export interface NormalizationResult {
  /** `canonical_transactions` rows, WITHOUT `dataset_id`/`organization_id`. */
  canonicalRows: Record<string, unknown>[];
  summary: NormalizationSummary;
  findings: NormalizationIssue[];
  analysis: ColumnDateAnalysis | null;
  /** True when the date column is genuinely ambiguous and no order was chosen. */
  ambiguousDatesNeedConfirmation: boolean;
}

export interface NormalizeOptions {
  kind: string;
  rows: MappedRow[];
  sourceSystem: SourceSystem;
  sourceReportType: SourceReportType;
  sourceFileName: string;
  sheetName: string | null;
  datasetId?: number | null;
  /** User-selected day/month order (resolves ambiguous date columns). */
  dateOrder?: LocalePreference;
  dateOrderUserConfirmed?: boolean;
  /**
   * Raw (pre-cleansing) transaction-date values, used ONLY to decide day/month
   * order and whether the column is genuinely ambiguous. Necessary because the
   * "normalize dates" cleansing action rewrites dates to ISO before we see the
   * cleaned rows, which would otherwise mask ambiguity.
   */
  rawDateValues?: unknown[];
  now?: Date;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[, ]+/g, ''));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown, max = 255): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, max);
};

const RETURN_CATS: TransactionCategory[] = ['RETURN_IN', 'RETURN_OUT'];
const TRANSFER_CATS: TransactionCategory[] = ['TRANSFER_IN', 'TRANSFER_OUT'];
const ADJUST_CATS: TransactionCategory[] = ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'];
const REVERSAL_CATS: TransactionCategory[] = ['REVERSAL_IN', 'REVERSAL_OUT'];

/**
 * Document-level transfer/reversal pairing (best-effort, in-dataset only).
 *
 * Matches unclaimed TRANSFER_OUT rows to TRANSFER_IN rows (same material, same
 * absolute quantity, closest date) and REVERSAL_IN/REVERSAL_OUT rows to the
 * specific earlier CONSUMPTION/RECEIPT row they most likely reverse (same
 * material, same absolute quantity, most recent qualifying date on or before
 * the reversal). Populates `transfer_id`/`paired_transaction_id` and
 * `reversal_of_transaction_id` on the matched rows.
 *
 * Both legs must be present in THIS dataset to pair. When a transfer's other
 * leg or a reversal's original genuinely falls outside this dataset's scope
 * (a different warehouse's file, a different period), pairing legitimately
 * fails — that is reported as a low-severity, non-blocking finding, not an
 * error, since it is common and often expected.
 */
function pairTransfersAndReversals(
  canonicalRows: Record<string, unknown>[],
  ctx: { fileName: string; sheetName: string | null; datasetId: number | null },
): NormalizationIssue[] {
  const findings: NormalizationIssue[] = [];
  const sameLine = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    a.material_id === b.material_id
    && Math.abs(((a.absolute_quantity as number) ?? -1) - ((b.absolute_quantity as number) ?? -2)) < 1e-9;
  const idFor = (r: Record<string, unknown>) => (r.transaction_id as string | null) ?? `row-${r.source_row_number}`;

  const pairingFinding = (
    code: 'TRANSFER_PAIR_NOT_FOUND' | 'REVERSAL_ORIGINAL_NOT_FOUND',
    r: Record<string, unknown>, explanation: string,
  ): NormalizationIssue => ({
    code, severity: 'low',
    fileName: ctx.fileName, sheetName: ctx.sheetName, datasetId: ctx.datasetId,
    rowNumber: r.source_row_number as number, columnName: null,
    originalValue: null, parsedValue: null, normalizedValue: null,
    explanation,
    recommendedCorrection: code === 'TRANSFER_PAIR_NOT_FOUND'
      ? "Confirm this transfer's other leg exists — import the destination/source warehouse file together, or this is expected if the counterpart falls outside this dataset's scope."
      : 'Confirm this is a genuine reversal, or that the original transaction falls outside this dataset\'s scope.',
    confidenceScore: 1,
    classificationSource: null,
    blocksImport: false,
    userActionRequired: false,
  });

  // --- Transfers -------------------------------------------------------------
  const transferOuts = canonicalRows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.transaction_category === 'TRANSFER_OUT');
  const unclaimedIns = new Set(
    canonicalRows.map((r, i) => ({ r, i })).filter(({ r }) => r.transaction_category === 'TRANSFER_IN').map(({ i }) => i),
  );
  for (const { r: outRow, i: outIdx } of transferOuts) {
    let best: number | null = null;
    let bestDiff = Infinity;
    for (const inIdx of unclaimedIns) {
      const inRow = canonicalRows[inIdx];
      if (!sameLine(outRow, inRow)) continue;
      const diff = Math.abs(new Date(String(inRow.transaction_date)).getTime() - new Date(String(outRow.transaction_date)).getTime());
      if (diff < bestDiff) { bestDiff = diff; best = inIdx; }
    }
    if (best === null) {
      findings.push(pairingFinding('TRANSFER_PAIR_NOT_FOUND', outRow,
        `Row ${(outRow.source_row_number as number) + 2}: no matching transfer-in transaction found in this dataset for material "${outRow.material_id}" (quantity ${outRow.absolute_quantity}).`));
      continue;
    }
    const inRow = canonicalRows[best];
    const transferId = `TXFER-${outIdx}-${best}`;
    outRow.transfer_id = transferId;
    inRow.transfer_id = transferId;
    outRow.paired_transaction_id = idFor(inRow);
    inRow.paired_transaction_id = idFor(outRow);
    unclaimedIns.delete(best);
  }
  for (const inIdx of unclaimedIns) {
    const inRow = canonicalRows[inIdx];
    findings.push(pairingFinding('TRANSFER_PAIR_NOT_FOUND', inRow,
      `Row ${(inRow.source_row_number as number) + 2}: no matching transfer-out transaction found in this dataset for material "${inRow.material_id}" (quantity ${inRow.absolute_quantity}).`));
  }

  // --- Reversals ---------------------------------------------------------------
  const claimedOriginals = new Set<number>();
  const reversals = canonicalRows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.transaction_category === 'REVERSAL_IN' || r.transaction_category === 'REVERSAL_OUT')
    .sort((a, b) => String(a.r.transaction_date).localeCompare(String(b.r.transaction_date)));
  for (const { r: revRow } of reversals) {
    const targetCategory = revRow.transaction_category === 'REVERSAL_OUT' ? 'RECEIPT' : 'CONSUMPTION';
    let best: number | null = null;
    let bestDate = '';
    canonicalRows.forEach((origRow, j) => {
      if (claimedOriginals.has(j) || origRow.transaction_category !== targetCategory || !sameLine(revRow, origRow)) return;
      const origDate = String(origRow.transaction_date);
      if (origDate > String(revRow.transaction_date)) return; // original must be on/before the reversal
      if (origDate > bestDate) { bestDate = origDate; best = j; } // most recent qualifying original wins
    });
    if (best === null) {
      findings.push(pairingFinding('REVERSAL_ORIGINAL_NOT_FOUND', revRow,
        `Row ${(revRow.source_row_number as number) + 2}: no matching ${targetCategory.toLowerCase()} transaction found in this dataset to reverse for material "${revRow.material_id}" (quantity ${revRow.absolute_quantity}).`));
      continue;
    }
    claimedOriginals.add(best);
    revRow.reversal_of_transaction_id = idFor(canonicalRows[best]);
  }

  return findings;
}

/**
 * Builds canonical transaction rows + summary + findings for a
 * movements/transaction dataset. Only `movements`-kind datasets produce
 * canonical rows today; other kinds return an empty result (the existing
 * per-kind persistence is untouched).
 */
export function buildNormalization(opts: NormalizeOptions): NormalizationResult {
  const { rows, sourceSystem, sourceReportType, sourceFileName, sheetName } = opts;
  const emptySummary = (): NormalizationSummary => ({
    version: NORMALIZATION_VERSION,
    totalSourceRows: rows.length,
    normalizedRows: 0, rejectedRows: 0, warningRows: 0, unknownTransactionRows: 0,
    receiptRows: 0, consumptionRows: 0, transferRows: 0, returnRows: 0,
    adjustmentRows: 0, reversalRows: 0, neutralRows: 0,
    signConflicts: 0, directionConflicts: 0,
    totalReceiptQuantity: 0, totalConsumptionQuantity: 0,
    categoryCounts: {}, directionCounts: {},
    dateFormat: null, dateFormatConfidence: 0,
    dateFormatUserConfirmed: !!opts.dateOrderUserConfirmed,
    ambiguousDateRows: 0, invalidDateRows: 0,
  });

  if (opts.kind !== 'movements' || rows.length === 0) {
    return {
      canonicalRows: [], summary: emptySummary(), findings: [],
      analysis: null, ambiguousDatesNeedConfirmation: false,
    };
  }

  const ctx = { fileName: sourceFileName, sheetName, datasetId: opts.datasetId ?? null };

  // --- date normalization (whole column, ambiguity resolved cross-row) ------
  // Ambiguity + day/month order are decided from the RAW column (before the
  // cleansing "normalize dates" action rewrites values to ISO). The cleaned
  // column is then normalized with the resolved order for the canonical rows.
  const rawDateValues = opts.rawDateValues ?? rows.map((r) => r.posting_date ?? r.document_date ?? null);
  const rawNorm = normalizeDateColumn(rawDateValues, { order: opts.dateOrder, now: opts.now });
  const resolvedOrder = rawNorm.analysis.order ?? opts.dateOrder;

  const postingValues = rows.map((r) => r.posting_date ?? r.document_date ?? null);
  const { analysis, dates } = normalizeDateColumn(postingValues, {
    order: resolvedOrder, sourceColumnName: 'posting_date', now: opts.now,
  });
  const documentDates = rows.map((r) =>
    normalizeDateValue(r.document_date ?? null, { order: analysis.order ?? opts.dateOrder, now: opts.now }));

  // --- classification per row ----------------------------------------------
  const results = rows.map((r) => classifyTransaction({
    rawQuantity: (r.movement_qty ?? r.quantity ?? r.demand_qty ?? null) as string | number | null,
    directionHint: str(r.transaction_direction, 40),
    // The numeric SAP movement-type map (`sapMovementType`) is tried first
    // regardless of the dataset's *display* source-system label — a value
    // like "201" or "261" is unambiguous SAP movement-type evidence on its
    // own, even when the rest of the file uses friendly column headers
    // rather than raw SAP technical names (so `sourceSystem` conservatively
    // stayed non-SAP for provenance purposes, per `classifySource()`). It can
    // only ever match an exact known code, so it never misfires on generic
    // text. When it finds nothing, the generic keyword classifier sees the
    // same text as a fallback.
    typeCode: str(r.movement_type, 40),
    debitCredit: str(r.debit_credit_indicator, 20),
    receiptQty: (r.receipt_qty ?? null) as string | number | null,
    consumptionQty: (r.issue_qty ?? r.consumption_qty ?? null) as string | number | null,
    sapMovementType: str(r.movement_type, 40),
  }));

  const summary = emptySummary();
  const nowIso = new Date().toISOString();
  const canonicalRows: Record<string, unknown>[] = [];

  rows.forEach((r, i) => {
    const material = str(r.material, 80);
    const nd = dates[i];
    const transactionDate = nd.dateParsingStatus === 'parsed' ? nd.normalizedDate : null;
    // A movements canonical row requires a material and a usable date.
    if (!material || !transactionDate) {
      summary.rejectedRows += 1;
      return;
    }
    const c = results[i];
    const cat = c.category;
    const dir = c.direction;

    const receiptQuantity = c.receiptQuantity != null
      ? c.receiptQuantity
      : cat === 'RECEIPT' ? c.absoluteQuantity : null;
    const consumptionQuantity = c.consumptionQuantity != null
      ? c.consumptionQuantity
      : cat === 'CONSUMPTION' ? c.absoluteQuantity : null;

    canonicalRows.push({
      organization_id: null,
      source_row_number: i,
      transaction_id: str(r.document_number, 120),
      reference_document: str(r.document_number, 120),
      reference_line: str(r.reservation, 40),
      material_id: material,
      material_description: str(r.material_description, 255),
      material_group: str(r.material_group, 80),
      material_type: str(r.material_type, 40),
      batch_number: str(r.batch, 40),
      warehouse_id: str(r.warehouse, 40),
      warehouse_name: str(r.warehouse, 120),
      location_id: str(r.storage_location, 40),
      location_name: str(r.storage_location, 120),
      plant_id: str(r.plant, 40),
      site_id: str(r.plant, 40),
      business_unit: str(r.cost_center, 80),
      transaction_date: transactionDate,
      posting_date: transactionDate,
      document_date: documentDates[i].dateParsingStatus === 'parsed' ? documentDates[i].normalizedDate : null,
      raw_quantity: str(r.movement_qty ?? r.quantity ?? r.demand_qty, 60),
      parsed_quantity: c.parsedQuantity,
      absolute_quantity: c.absoluteQuantity,
      signed_quantity: c.signedQuantity,
      receipt_quantity: receiptQuantity,
      consumption_quantity: consumptionQuantity,
      unit_of_measure: str(r.base_unit, 20),
      transaction_direction: dir,
      transaction_category: cat,
      transaction_type_code: str(r.movement_type, 40),
      transaction_type_description: null,
      unit_cost: num(r.unit_cost),
      transaction_value: num(r.movement_value ?? r.value),
      currency: str(r.currency, 10),
      opening_quantity: num(r.opening_qty),
      closing_quantity: num(r.closing_qty),
      classification_source: c.classificationSource,
      classification_confidence: c.classificationConfidence,
      original_sign: c.originalSign,
      normalized_sign: c.normalizedSign,
      sign_conflict: c.signConflict,
      direction_conflict: c.directionConflict,
      transfer_id: null,
      paired_transaction_id: null,
      reversal_of_transaction_id: null,
      normalization_warnings: JSON.stringify(c.warnings),
      original_source_record: JSON.stringify(r),
      created_at: nowIso,
    });

    // --- summary accumulation ---
    summary.normalizedRows += 1;
    summary.categoryCounts[cat] = (summary.categoryCounts[cat] ?? 0) + 1;
    summary.directionCounts[dir] = (summary.directionCounts[dir] ?? 0) + 1;
    if (cat === 'UNKNOWN') summary.unknownTransactionRows += 1;
    if (cat === 'RECEIPT') { summary.receiptRows += 1; summary.totalReceiptQuantity += receiptQuantity ?? 0; }
    if (cat === 'CONSUMPTION') { summary.consumptionRows += 1; summary.totalConsumptionQuantity += consumptionQuantity ?? 0; }
    if (TRANSFER_CATS.includes(cat)) summary.transferRows += 1;
    if (RETURN_CATS.includes(cat)) summary.returnRows += 1;
    if (ADJUST_CATS.includes(cat)) summary.adjustmentRows += 1;
    if (REVERSAL_CATS.includes(cat)) summary.reversalRows += 1;
    if (cat === 'NEUTRAL') summary.neutralRows += 1;
    if (c.signConflict) summary.signConflicts += 1;
    if (c.directionConflict) summary.directionConflicts += 1;
    if (c.warnings.length > 0) summary.warningRows += 1;
  });

  summary.dateFormat = rawNorm.analysis.dominantFormat ?? analysis.dominantFormat;
  summary.dateFormatConfidence = analysis.parsedCount === 0
    ? 0 : Math.round((analysis.parsedCount / Math.max(1, analysis.total)) * 100) / 100;
  summary.ambiguousDateRows = rawNorm.dates.filter((d) => d.dateParsingStatus === 'ambiguous').length;
  summary.invalidDateRows = dates.filter((d) => d.dateParsingStatus === 'invalid').length;

  // --- findings -------------------------------------------------------------
  const findings: NormalizationIssue[] = [
    ...dateIssues(dates, analysis, { ...ctx, columnName: 'posting_date' }, { required: true }),
    ...classificationIssues(results, ctx),
    ...pairTransfersAndReversals(canonicalRows, ctx),
  ];

  const ambiguousDatesNeedConfirmation = !opts.dateOrder
    && (rawNorm.analysis.ambiguous || summary.ambiguousDateRows > 0);

  return { canonicalRows, summary, findings, analysis, ambiguousDatesNeedConfirmation };
}

/**
 * Recomputes the category/direction-derived fields of a stored
 * NormalizationSummary from the CURRENT canonical_transactions rows of a
 * dataset — used after a manual per-row classification override, since the
 * summary persisted at import time would otherwise go stale. Date-format and
 * row-count fields (rejectedRows, dateFormat, …) are untouched: they describe
 * the import itself, not the current classification state.
 */
export function recomputeCategorySummary(
  existing: NormalizationSummary,
  rows: { transaction_category: string; transaction_direction: string; receipt_quantity: number | null; consumption_quantity: number | null; sign_conflict: boolean | number; direction_conflict: boolean | number }[],
): NormalizationSummary {
  const summary: NormalizationSummary = {
    ...existing,
    receiptRows: 0, consumptionRows: 0, transferRows: 0, returnRows: 0,
    adjustmentRows: 0, reversalRows: 0, neutralRows: 0, unknownTransactionRows: 0,
    signConflicts: 0, directionConflicts: 0,
    totalReceiptQuantity: 0, totalConsumptionQuantity: 0,
    categoryCounts: {}, directionCounts: {},
  };
  for (const r of rows) {
    const cat = r.transaction_category;
    const dir = r.transaction_direction;
    summary.categoryCounts[cat] = (summary.categoryCounts[cat] ?? 0) + 1;
    summary.directionCounts[dir] = (summary.directionCounts[dir] ?? 0) + 1;
    if (cat === 'UNKNOWN') summary.unknownTransactionRows += 1;
    if (cat === 'RECEIPT') { summary.receiptRows += 1; summary.totalReceiptQuantity += r.receipt_quantity ?? 0; }
    if (cat === 'CONSUMPTION') { summary.consumptionRows += 1; summary.totalConsumptionQuantity += r.consumption_quantity ?? 0; }
    if (TRANSFER_CATS.includes(cat as TransactionCategory)) summary.transferRows += 1;
    if (RETURN_CATS.includes(cat as TransactionCategory)) summary.returnRows += 1;
    if (ADJUST_CATS.includes(cat as TransactionCategory)) summary.adjustmentRows += 1;
    if (REVERSAL_CATS.includes(cat as TransactionCategory)) summary.reversalRows += 1;
    if (cat === 'NEUTRAL') summary.neutralRows += 1;
    if (r.sign_conflict) summary.signConflicts += 1;
    if (r.direction_conflict) summary.directionConflicts += 1;
  }
  return summary;
}

export { NORMALIZATION_VERSION };
