import type { CleansingAction, QualityIssue, CanonicalField } from '@kynox/shared-types';
import type { MappedRow, DatasetKind } from './rules';
import { parseDate, parseNumber, normalizeText } from './parsers';

/**
 * Proposes cleansing actions from detected issues. Nothing is applied until
 * the user approves; `applyCleansing` produces a NEW row array plus a
 * transformation log — the original rows are never mutated.
 */
export function proposeCleansing(kind: DatasetKind, rows: MappedRow[], issues: QualityIssue[]): CleansingAction[] {
  const actions: CleansingAction[] = [];
  let id = 0;
  const next = () => `cl-${++id}`;

  // Always propose whitespace trimming when text fields contain padding.
  let paddedCount = 0;
  for (const r of rows) {
    for (const [, v] of Object.entries(r)) {
      if (typeof v === 'string' && v !== v.trim()) { paddedCount++; break; }
    }
  }
  if (paddedCount > 0) {
    actions.push({
      id: next(), ruleId: 'whitespace', type: 'trim_whitespace', column: null,
      description: `Trim leading/trailing whitespace in text fields on ${paddedCount} row(s).`,
      affectedRows: paddedCount, safe: true,
    });
  }

  for (const issue of issues) {
    switch (issue.ruleId) {
      case 'duplicate_rows':
        actions.push({
          id: next(), ruleId: issue.ruleId, type: 'remove_duplicate_rows', column: null,
          description: `Remove ${issue.affectedRows} exact duplicate row(s), keeping the first occurrence.`,
          affectedRows: issue.affectedRows, safe: true,
        });
        break;
      case 'missing_material':
        actions.push({
          id: next(), ruleId: issue.ruleId, type: 'drop_empty_rows', column: 'material',
          description: `Exclude ${issue.affectedRows} row(s) without a material code from the analysis dataset (kept in the raw file).`,
          affectedRows: issue.affectedRows, safe: false,
        });
        break;
      case 'invalid_quantity':
        actions.push({
          id: next(), ruleId: issue.ruleId, type: 'drop_empty_rows', column: 'quantity',
          description: `Exclude ${issue.affectedRows} row(s) with unparseable quantities (kept in the raw file).`,
          affectedRows: issue.affectedRows, safe: false,
        });
        break;
      case 'inconsistent_descriptions':
        actions.push({
          id: next(), ruleId: issue.ruleId, type: 'fill_missing_value', column: 'material_description',
          description: `Harmonise descriptions for ${issue.affectedRows} material(s) to the most frequent variant.`,
          affectedRows: issue.affectedRows, safe: true,
        });
        break;
      case 'unexpected_movement_sign':
        actions.push({
          id: next(), ruleId: issue.ruleId, type: 'normalize_number', column: 'movement_qty',
          description: `Normalise movement signs by movement type for ${issue.affectedRows} row(s) (issues negative, receipts positive).`,
          affectedRows: issue.affectedRows, safe: true,
        });
        break;
      case 'count_difference_mismatch':
        actions.push({
          id: next(), ruleId: issue.ruleId, type: 'normalize_number', column: 'count_difference',
          description: `Recompute count difference as counted − book for ${issue.affectedRows} row(s).`,
          affectedRows: issue.affectedRows, safe: true,
        });
        break;
      default:
        // Issues without a safe automatic fix become flag-only entries.
        if (!actions.some((a) => a.ruleId === issue.ruleId)) {
          actions.push({
            id: next(), ruleId: issue.ruleId, type: 'flag_only', column: null,
            description: `${issue.title}: flagged for manual review (${issue.affectedRows} row(s)); no automatic correction is safe.`,
            affectedRows: issue.affectedRows, safe: false,
          });
        }
    }
  }

  // Normalisation of numbers/dates is always proposed so downstream analytics
  // receive clean typed values.
  actions.push({
    id: next(), ruleId: 'normalization', type: 'normalize_number', column: null,
    description: 'Convert all numeric fields to standard numbers (handles decimal commas, thousands separators, SAP trailing minus).',
    affectedRows: rows.length, safe: true,
  });
  actions.push({
    id: next(), ruleId: 'normalization', type: 'normalize_date', column: null,
    description: 'Convert all date fields to ISO format (handles DD.MM.YYYY, DD/MM/YYYY, Excel serial dates).',
    affectedRows: rows.length, safe: true,
  });

  return actions;
}

export interface CleansingResult {
  rows: MappedRow[];
  log: string[];
  excludedRows: { row: number; reason: string; data: MappedRow }[];
}

const NUMERIC_FIELDS: CanonicalField[] = [
  'quantity', 'value', 'movement_qty', 'movement_value', 'unrestricted_qty', 'blocked_qty',
  'quality_qty', 'in_transit_qty', 'reserved_qty', 'safety_stock', 'reorder_point',
  'min_stock', 'max_stock', 'lead_time_days', 'standard_price', 'moving_avg_price',
  'book_qty', 'counted_qty', 'count_difference', 'consumption_qty', 'demand_qty', 'forecast_qty',
];

const DATE_FIELDS: CanonicalField[] = [
  'posting_date', 'document_date', 'last_receipt_date', 'last_issue_date', 'last_movement_date',
];

const ISSUE_MOVEMENT_TYPES = new Set(['201', '221', '261', '281', '291', '301', '311', '601']);

/** Applies only the approved actions, returning new rows + a transformation log. */
export function applyCleansing(
  rows: MappedRow[],
  approvedActions: CleansingAction[],
): CleansingResult {
  let working: MappedRow[] = rows.map((r) => ({ ...r }));
  const log: string[] = [];
  const excludedRows: CleansingResult['excludedRows'] = [];
  const has = (type: CleansingAction['type'], column?: string | null) =>
    approvedActions.some((a) => a.type === type && (column === undefined || a.column === column));

  if (has('trim_whitespace')) {
    let touched = 0;
    for (const r of working) {
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === 'string') {
          const t = normalizeText(v);
          if (t !== v) { (r as Record<string, unknown>)[k] = t; touched++; }
        }
      }
    }
    log.push(`Trimmed whitespace on ${touched} cell(s).`);
  }

  if (has('remove_duplicate_rows')) {
    const seen = new Set<string>();
    const before = working.length;
    working = working.filter((r, i) => {
      const key = JSON.stringify([
        r.material, r.plant, r.storage_location, r.batch,
        r.posting_date, r.document_number, r.movement_qty, r.quantity,
      ]);
      if (seen.has(key)) {
        excludedRows.push({ row: i, reason: 'duplicate', data: r });
        return false;
      }
      seen.add(key);
      return true;
    });
    log.push(`Removed ${before - working.length} duplicate row(s).`);
  }

  if (has('drop_empty_rows', 'material')) {
    const before = working.length;
    working = working.filter((r, i) => {
      if (normalizeText(r.material) === '') {
        excludedRows.push({ row: i, reason: 'missing material code', data: r });
        return false;
      }
      return true;
    });
    log.push(`Excluded ${before - working.length} row(s) without a material code.`);
  }

  if (has('drop_empty_rows', 'quantity')) {
    const before = working.length;
    working = working.filter((r, i) => {
      const raw = r.quantity ?? r.movement_qty ?? r.counted_qty;
      if (raw !== undefined && raw !== null && raw !== '' && parseNumber(raw).value === null) {
        excludedRows.push({ row: i, reason: 'unparseable quantity', data: r });
        return false;
      }
      return true;
    });
    log.push(`Excluded ${before - working.length} row(s) with unparseable quantities.`);
  }

  if (has('fill_missing_value', 'material_description')) {
    const freq = new Map<string, Map<string, number>>();
    for (const r of working) {
      const mat = normalizeText(r.material);
      const desc = normalizeText(r.material_description);
      if (!mat || !desc) continue;
      if (!freq.has(mat)) freq.set(mat, new Map());
      const f = freq.get(mat)!;
      f.set(desc, (f.get(desc) ?? 0) + 1);
    }
    const canonical = new Map<string, string>();
    for (const [mat, f] of freq) {
      canonical.set(mat, [...f.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    }
    let touched = 0;
    for (const r of working) {
      const mat = normalizeText(r.material);
      const best = canonical.get(mat);
      if (best && normalizeText(r.material_description) !== best) {
        r.material_description = best;
        touched++;
      }
    }
    log.push(`Harmonised descriptions on ${touched} row(s) to the most frequent variant per material.`);
  }

  if (has('normalize_number', 'movement_qty')) {
    let touched = 0;
    for (const r of working) {
      const mvt = normalizeText(r.movement_type);
      const qty = parseNumber(r.movement_qty).value;
      if (qty !== null && ISSUE_MOVEMENT_TYPES.has(mvt) && qty > 0) {
        r.movement_qty = -qty;
        touched++;
      }
    }
    log.push(`Normalised movement sign on ${touched} row(s) (issue types forced negative).`);
  }

  if (has('normalize_number', 'count_difference')) {
    let touched = 0;
    for (const r of working) {
      const book = parseNumber(r.book_qty).value;
      const counted = parseNumber(r.counted_qty).value;
      if (book !== null && counted !== null) {
        const diff = counted - book;
        if (parseNumber(r.count_difference).value !== diff) {
          r.count_difference = diff;
          touched++;
        }
      }
    }
    log.push(`Recomputed count difference on ${touched} row(s).`);
  }

  if (has('normalize_number', null)) {
    let touched = 0;
    for (const r of working) {
      for (const f of NUMERIC_FIELDS) {
        const v = r[f];
        if (v !== undefined && v !== null && v !== '' && typeof v !== 'number') {
          const parsed = parseNumber(v).value;
          if (parsed !== null) { r[f] = parsed; touched++; }
        }
      }
    }
    log.push(`Normalised ${touched} numeric cell(s) to standard numbers.`);
  }

  if (has('normalize_date', null)) {
    let touched = 0;
    for (const r of working) {
      for (const f of DATE_FIELDS) {
        const v = r[f];
        if (v !== undefined && v !== null && v !== '') {
          const parsed = parseDate(v).value;
          if (parsed !== null && parsed !== v) { r[f] = parsed; touched++; }
        }
      }
    }
    log.push(`Normalised ${touched} date cell(s) to ISO format.`);
  }

  return { rows: working, log, excludedRows };
}
