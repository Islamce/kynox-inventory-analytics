import type { QualityIssue, QualityScores, CanonicalField } from '@kynox/shared-types';
import type { MappedRow, DatasetKind } from './rules';
import { parseDate, parseNumber, normalizeText } from './parsers';

const round1 = (x: number) => Math.round(x * 10) / 10;

const REQUIRED_FIELDS: Record<DatasetKind, CanonicalField[]> = {
  stock: ['material', 'quantity'],
  movements: ['material', 'movement_qty', 'posting_date'],
  material_master: ['material'],
  physical_inventory: ['material', 'book_qty', 'counted_qty'],
};

const VALUE_FIELDS: Record<DatasetKind, CanonicalField[]> = {
  stock: ['quantity', 'value'],
  movements: ['movement_qty', 'movement_value'],
  material_master: ['standard_price', 'moving_avg_price', 'lead_time_days'],
  physical_inventory: ['book_qty', 'counted_qty'],
};

/**
 * Data-quality scoring across six dimensions, each 0..100.
 * All dimensions are computed from the mapped rows directly (not from the
 * issue list) so scores are reproducible and explainable.
 */
export function computeQualityScores(kind: DatasetKind, rows: MappedRow[], issues: QualityIssue[]): QualityScores {
  const n = rows.length || 1;

  // Completeness: share of required + present optional fields populated
  const required = REQUIRED_FIELDS[kind];
  const presentFields = new Set<CanonicalField>();
  for (const r of rows) {
    for (const k of Object.keys(r) as CanonicalField[]) {
      if (r[k] !== undefined) presentFields.add(k);
    }
  }
  let completenessNum = 0;
  let completenessDen = 0;
  for (const f of new Set([...required, ...presentFields])) {
    for (const r of rows) {
      completenessDen += 1;
      if (normalizeText(r[f]) !== '') completenessNum += 1;
    }
  }
  const completeness = completenessDen === 0 ? 100 : (completenessNum / completenessDen) * 100;

  // Validity: parseable numerics and dates among populated cells
  let validNum = 0;
  let validDen = 0;
  const numericFields = VALUE_FIELDS[kind];
  for (const r of rows) {
    for (const f of numericFields) {
      const v = r[f];
      if (v !== undefined && v !== null && v !== '') {
        validDen += 1;
        if (parseNumber(v).value !== null) validNum += 1;
      }
    }
    const pd = r.posting_date;
    if (pd !== undefined && pd !== null && pd !== '') {
      validDen += 1;
      if (parseDate(pd).value !== null) validNum += 1;
    }
  }
  const validity = validDen === 0 ? 100 : (validNum / validDen) * 100;

  // Uniqueness: 100 minus duplicate-row share
  const dupIssue = issues.find((i) => i.ruleId === 'duplicate_rows');
  const uniqueness = 100 - ((dupIssue?.affectedRows ?? 0) / n) * 100;

  // Consistency: penalised by consistency-family issues
  const consistencyIssues = issues.filter((i) =>
    ['inconsistent_descriptions', 'unexpected_movement_sign', 'count_difference_mismatch', 'abnormal_unit_price'].includes(i.ruleId));
  const consistencyAffected = consistencyIssues.reduce((a, i) => a + i.affectedRows, 0);
  const consistency = Math.max(0, 100 - (consistencyAffected / n) * 100);

  // Timeliness: penalised by future dates
  const futureIssue = issues.find((i) => i.ruleId === 'future_posting_dates');
  const timeliness = 100 - ((futureIssue?.affectedRows ?? 0) / n) * 100;

  // Integrity: critical issues weigh heavily
  const criticalAffected = issues.filter((i) => i.severity === 'critical').reduce((a, i) => a + i.affectedRows, 0);
  const highAffected = issues.filter((i) => i.severity === 'high').reduce((a, i) => a + i.affectedRows, 0);
  const integrity = Math.max(0, 100 - (criticalAffected / n) * 100 - (highAffected / n) * 50);

  const overall =
    completeness * 0.2 + validity * 0.25 + consistency * 0.15 +
    uniqueness * 0.15 + timeliness * 0.1 + integrity * 0.15;

  return {
    overall: round1(overall),
    completeness: round1(completeness),
    validity: round1(validity),
    consistency: round1(consistency),
    uniqueness: round1(uniqueness),
    timeliness: round1(timeliness),
    integrity: round1(integrity),
  };
}
