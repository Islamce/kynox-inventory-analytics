import type { QualityIssue, IssueSeverity, CanonicalField } from '@kynox/shared-types';
import { parseDate, parseNumber, normalizeText } from './parsers';

/** A mapped row: canonical field -> raw value from the source file. */
export type MappedRow = Partial<Record<CanonicalField, unknown>>;

export type DatasetKind = 'stock' | 'movements' | 'material_master' | 'physical_inventory';

const MAX_SAMPLES = 20;

interface RuleContext {
  kind: DatasetKind;
  rows: MappedRow[];
  today: string; // ISO date used for future-date checks
}

type Rule = (ctx: RuleContext) => QualityIssue | null;

function makeIssue(
  ruleId: string,
  severity: IssueSeverity,
  title: string,
  description: string,
  recommendation: string,
  autoFixSafe: boolean,
  businessImpact: string,
  samples: { row: number; column: string; value: unknown }[],
  affectedRows: number,
): QualityIssue | null {
  if (affectedRows === 0) return null;
  return {
    ruleId, severity, title, description, recommendation, autoFixSafe,
    affectedRows, samples: samples.slice(0, MAX_SAMPLES), businessImpact,
  };
}

function collect(
  rows: MappedRow[],
  column: CanonicalField,
  predicate: (value: unknown, row: MappedRow) => boolean,
): { row: number; column: string; value: unknown }[] {
  const hits: { row: number; column: string; value: unknown }[] = [];
  rows.forEach((r, i) => {
    if (predicate(r[column], r)) hits.push({ row: i, column, value: r[column] ?? null });
  });
  return hits;
}

const numericFields: CanonicalField[] = [
  'quantity', 'value', 'movement_qty', 'movement_value', 'unrestricted_qty',
  'blocked_qty', 'safety_stock', 'reorder_point', 'min_stock', 'max_stock',
  'lead_time_days', 'standard_price', 'moving_avg_price', 'book_qty', 'counted_qty',
];

const dateFields: CanonicalField[] = [
  'posting_date', 'document_date', 'last_receipt_date', 'last_issue_date', 'last_movement_date',
];

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const missingMaterial: Rule = (ctx) => {
  const hits = collect(ctx.rows, 'material', (v) => normalizeText(v) === '');
  return makeIssue(
    'missing_material', 'critical', 'Missing material codes',
    'Rows without a material identifier cannot be attributed to any material and would silently distort every material-level metric.',
    'Fix the source extract or exclude these rows before analysis.',
    false,
    'All material-level analyses (ABC, aging, excess) would be understated.',
    hits, hits.length,
  );
};

const duplicateRows: Rule = (ctx) => {
  const seen = new Map<string, number>();
  const hits: { row: number; column: string; value: unknown }[] = [];
  ctx.rows.forEach((r, i) => {
    const key = JSON.stringify([
      r.material, r.plant, r.storage_location, r.batch,
      r.posting_date, r.document_number, r.movement_qty, r.quantity,
    ]);
    if (seen.has(key)) hits.push({ row: i, column: 'material', value: r.material ?? null });
    else seen.set(key, i);
  });
  return makeIssue(
    'duplicate_rows',
    ctx.kind === 'movements' ? 'high' : 'medium',
    'Duplicate rows',
    'Identical rows (same material, location, document, quantity and date) inflate totals when double-counted.',
    'Remove duplicates after confirming they are extraction artefacts and not genuine repeated postings.',
    true,
    'Stock and consumption totals would be overstated.',
    hits, hits.length,
  );
};

const invalidQuantities: Rule = (ctx) => {
  const col: CanonicalField = ctx.kind === 'movements' ? 'movement_qty'
    : ctx.kind === 'physical_inventory' ? 'counted_qty' : 'quantity';
  const hits = collect(ctx.rows, col, (v) => v !== undefined && v !== null && v !== '' && parseNumber(v).value === null);
  return makeIssue(
    'invalid_quantity', 'critical', 'Non-numeric quantities',
    `Values in '${col}' could not be interpreted as numbers in any supported format.`,
    'Correct the source values; these rows are blocked from analysis.',
    false,
    'Rows with unparseable quantities would be dropped or mis-summed.',
    hits, hits.length,
  );
};

const negativeStock: Rule = (ctx) => {
  if (ctx.kind !== 'stock') return null;
  const hits = collect(ctx.rows, 'quantity', (v) => {
    const n = parseNumber(v).value;
    return n !== null && n < 0;
  });
  return makeIssue(
    'negative_stock', 'high', 'Negative stock quantities',
    'Negative on-hand stock usually indicates posting errors, un-reversed movements, or a snapshot taken mid-posting.',
    'Investigate the negative lines in the source system; they are flagged, not auto-corrected.',
    false,
    'Availability and shortage analyses treat these as critical shortage signals.',
    hits, hits.length,
  );
};

const zeroValueStock: Rule = (ctx) => {
  if (ctx.kind !== 'stock') return null;
  const hits = collect(ctx.rows, 'value', (v, r) => {
    const val = parseNumber(v).value;
    const qty = parseNumber(r.quantity).value;
    return qty !== null && qty > 0 && (val === null || val === 0);
  });
  return makeIssue(
    'zero_value_stock', 'medium', 'Stock with quantity but zero/missing value',
    'Positive quantities without a value distort financial KPIs and usually indicate missing prices in the material master.',
    'Maintain valuation prices, or accept that these rows are excluded from value-based KPIs.',
    false,
    'Inventory value and working-capital figures would be understated.',
    hits, hits.length,
  );
};

const missingPrices: Rule = (ctx) => {
  if (ctx.kind !== 'material_master') return null;
  const hits = ctx.rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => parseNumber(r.standard_price).value === null && parseNumber(r.moving_avg_price).value === null)
    .map(({ r, i }) => ({ row: i, column: 'standard_price', value: r.standard_price ?? null }));
  return makeIssue(
    'missing_prices', 'medium', 'Materials without any price',
    'Neither standard price nor moving average price is maintained.',
    'Maintain valuation data in the material master.',
    false,
    'These materials cannot participate in value-based analyses.',
    hits, hits.length,
  );
};

const invalidDates: Rule = (ctx) => {
  const hits: { row: number; column: string; value: unknown }[] = [];
  ctx.rows.forEach((r, i) => {
    for (const f of dateFields) {
      const v = r[f];
      if (v !== undefined && v !== null && v !== '' && parseDate(v).value === null) {
        hits.push({ row: i, column: f, value: v });
      }
    }
  });
  return makeIssue(
    'invalid_dates', 'high', 'Unparseable dates',
    'Date values that match none of the supported formats (ISO, DD.MM.YYYY, DD/MM/YYYY, Excel serial).',
    'Correct the source format; rows keep their other fields but date-based analyses will exclude them.',
    false,
    'Aging and consumption trend calculations would exclude these rows.',
    hits, hits.length,
  );
};

const futureDates: Rule = (ctx) => {
  const hits: { row: number; column: string; value: unknown }[] = [];
  ctx.rows.forEach((r, i) => {
    const v = r.posting_date;
    const parsed = parseDate(v).value;
    if (parsed && parsed > ctx.today) hits.push({ row: i, column: 'posting_date', value: v });
  });
  return makeIssue(
    'future_posting_dates', 'medium', 'Future posting dates',
    'Postings dated after today typically indicate wrong period entries or extraction of planned documents.',
    'Verify whether these are planned receipts; exclude them from historical consumption.',
    false,
    'Consumption history would include not-yet-real transactions.',
    hits, hits.length,
  );
};

const inconsistentDescriptions: Rule = (ctx) => {
  const byMaterial = new Map<string, Set<string>>();
  ctx.rows.forEach((r) => {
    const mat = normalizeText(r.material);
    const desc = normalizeText(r.material_description);
    if (!mat || !desc) return;
    if (!byMaterial.has(mat)) byMaterial.set(mat, new Set());
    byMaterial.get(mat)!.add(desc.toLowerCase());
  });
  const conflicting = [...byMaterial.entries()].filter(([, descs]) => descs.size > 1);
  const hits = conflicting.slice(0, MAX_SAMPLES).map(([mat, descs]) => ({
    row: -1, column: 'material_description', value: `${mat}: ${[...descs].join(' | ')}`,
  }));
  return makeIssue(
    'inconsistent_descriptions', 'low', 'Different descriptions for the same material',
    'The same material code appears with more than one description, indicating master-data drift across sources.',
    'Harmonise descriptions in the material master; the platform uses the most frequent description.',
    true,
    'Cosmetic in analytics but a governance signal for master data.',
    hits, conflicting.length,
  );
};

const missingGroups: Rule = (ctx) => {
  if (!ctx.rows.some((r) => r.material_group !== undefined)) return null;
  const hits = collect(ctx.rows, 'material_group', (v, r) => normalizeText(r.material) !== '' && normalizeText(v) === '');
  return makeIssue(
    'missing_material_group', 'low', 'Missing material groups',
    'Rows without a material group cannot participate in group-level drill-downs.',
    'Maintain material groups, or analyse these rows under an "Unassigned" group.',
    true,
    'Group-level breakdowns show an "Unassigned" bucket.',
    hits, hits.length,
  );
};

const invalidLeadTimes: Rule = (ctx) => {
  const hits = collect(ctx.rows, 'lead_time_days', (v) => {
    if (v === undefined || v === null || v === '') return false;
    const n = parseNumber(v).value;
    return n === null || n < 0 || n > 1095;
  });
  return makeIssue(
    'invalid_lead_time', 'medium', 'Invalid lead times',
    'Lead times that are negative, non-numeric, or implausibly long (> 3 years).',
    'Correct planned delivery time in the material master; affected materials are excluded from lead-time-based planning proposals.',
    false,
    'Safety-stock and reorder-point proposals skip these materials.',
    hits, hits.length,
  );
};

const abnormalUnitPrice: Rule = (ctx) => {
  if (ctx.kind !== 'stock') return null;
  const prices: number[] = [];
  ctx.rows.forEach((r) => {
    const qty = parseNumber(r.quantity).value;
    const val = parseNumber(r.value).value;
    if (qty && val && qty > 0 && val > 0) prices.push(val / qty);
  });
  if (prices.length < 10) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length / 2)];
  const hits: { row: number; column: string; value: unknown }[] = [];
  let count = 0;
  ctx.rows.forEach((r, i) => {
    const qty = parseNumber(r.quantity).value;
    const val = parseNumber(r.value).value;
    if (qty && val && qty > 0 && val > 0) {
      const unit = val / qty;
      if (p50 > 0 && (unit > p50 * 1000 || unit < p50 / 1000)) {
        count += 1;
        if (hits.length < MAX_SAMPLES) hits.push({ row: i, column: 'value', value: `unit price ${unit.toFixed(4)}` });
      }
    }
  });
  return makeIssue(
    'abnormal_unit_price', 'medium', 'Extreme unit-price outliers',
    'Implied unit prices more than 1000× away from the dataset median suggest unit-of-measure or currency errors.',
    'Verify units and currency for the flagged rows.',
    false,
    'A single wrong row can dominate value-based KPIs.',
    hits, count,
  );
};

const unexpectedMovementSign: Rule = (ctx) => {
  if (ctx.kind !== 'movements') return null;
  // SAP convention: odd movement types are receipts (positive), even are issues/reversals.
  const issueTypes = new Set(['201', '221', '261', '281', '291', '301', '311', '601']);
  const receiptTypes = new Set(['101', '501', '561', '531']);
  const hits: { row: number; column: string; value: unknown }[] = [];
  let count = 0;
  ctx.rows.forEach((r, i) => {
    const mvt = normalizeText(r.movement_type);
    const qty = parseNumber(r.movement_qty).value;
    if (qty === null) return;
    if ((receiptTypes.has(mvt) && qty < 0) || (issueTypes.has(mvt) && qty > 0)) {
      count += 1;
      if (hits.length < MAX_SAMPLES) hits.push({ row: i, column: 'movement_qty', value: `${mvt}: ${qty}` });
    }
  });
  return makeIssue(
    'unexpected_movement_sign', 'medium', 'Unexpected movement signs',
    'Receipt movement types with negative quantities or issue types with positive quantities. Some extracts export issues as positive numbers; the platform normalises signs by movement type.',
    'Confirm the sign convention of the export; sign normalisation is proposed as a cleansing action.',
    true,
    'Consumption could be counted with the wrong sign.',
    hits, count,
  );
};

const countDifferenceMismatch: Rule = (ctx) => {
  if (ctx.kind !== 'physical_inventory') return null;
  const hits: { row: number; column: string; value: unknown }[] = [];
  let count = 0;
  ctx.rows.forEach((r, i) => {
    const book = parseNumber(r.book_qty).value;
    const counted = parseNumber(r.counted_qty).value;
    const diff = parseNumber(r.count_difference).value;
    if (book !== null && counted !== null && diff !== null
        && Math.abs((counted - book) - diff) > 0.001) {
      count += 1;
      if (hits.length < MAX_SAMPLES) {
        hits.push({ row: i, column: 'count_difference', value: `stated ${diff}, computed ${counted - book}` });
      }
    }
  });
  return makeIssue(
    'count_difference_mismatch', 'high', 'Stated count difference does not equal counted − book',
    'The exported difference column disagrees with the difference computed from book and counted quantities.',
    'The platform uses the computed difference; verify the export logic.',
    true,
    'Inventory accuracy KPIs would be wrong if the stated column were trusted.',
    hits, count,
  );
};

const conflictingUnits: Rule = (ctx) => {
  if (!ctx.rows.some((r) => r.base_unit !== undefined)) return null;
  const byMaterial = new Map<string, Set<string>>();
  ctx.rows.forEach((r) => {
    const mat = normalizeText(r.material);
    const unit = normalizeText(r.base_unit).toUpperCase();
    if (!mat || !unit) return;
    if (!byMaterial.has(mat)) byMaterial.set(mat, new Set());
    byMaterial.get(mat)!.add(unit);
  });
  const conflicting = [...byMaterial.entries()].filter(([, units]) => units.size > 1);
  const hits = conflicting.slice(0, MAX_SAMPLES).map(([mat, units]) => ({
    row: -1, column: 'base_unit', value: `${mat}: ${[...units].join(' | ')}`,
  }));
  return makeIssue(
    'conflicting_units', 'high', 'Same material with different units of measure',
    'Quantities recorded in different units cannot be aggregated without conversion factors, which are not present in the upload.',
    'Provide a single unit per material or supply conversion factors; quantity totals for these materials are unreliable until then.',
    false,
    'Quantity aggregations for the affected materials mix incompatible units.',
    hits, conflicting.length,
  );
};

const mixedCurrencies: Rule = (ctx) => {
  if (!ctx.rows.some((r) => r.currency !== undefined)) return null;
  const currencies = new Set<string>();
  ctx.rows.forEach((r) => {
    const c = normalizeText(r.currency).toUpperCase();
    if (c) currencies.add(c);
  });
  if (currencies.size <= 1) return null;
  return makeIssue(
    'mixed_currencies', 'high', 'Multiple currencies in one dataset',
    `Values appear in ${currencies.size} currencies (${[...currencies].join(', ')}). Value totals would silently mix currencies without conversion.`,
    'Extract the report in a single (local) currency, or split by currency; value-based KPIs assume one currency.',
    false,
    'All value aggregations (inventory value, excess value, ABC by value) are unreliable across currencies.',
    [{ row: -1, column: 'currency', value: [...currencies].join(', ') }],
    ctx.rows.length,
  );
};

export const ALL_RULES: Rule[] = [
  conflictingUnits,
  mixedCurrencies,
  missingMaterial,
  duplicateRows,
  invalidQuantities,
  negativeStock,
  zeroValueStock,
  missingPrices,
  invalidDates,
  futureDates,
  inconsistentDescriptions,
  missingGroups,
  invalidLeadTimes,
  abnormalUnitPrice,
  unexpectedMovementSign,
  countDifferenceMismatch,
];

export function runQualityRules(kind: DatasetKind, rows: MappedRow[], today?: string): QualityIssue[] {
  const ctx: RuleContext = { kind, rows, today: today ?? new Date().toISOString().slice(0, 10) };
  const issues: QualityIssue[] = [];
  for (const rule of ALL_RULES) {
    const issue = rule(ctx);
    if (issue) issues.push(issue);
  }
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || b.affectedRows - a.affectedRows);
}
