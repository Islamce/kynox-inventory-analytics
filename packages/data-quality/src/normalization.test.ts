import { describe, it, expect } from 'vitest';
import {
  normalizeDateValue, detectColumnDateFormat, normalizeDateColumn, formatDisplayDate,
} from './date-normalization';
import {
  classifyTransaction, classifySeparateColumns, sapMovementTypeCategory,
} from './transaction-classification';
import { dateIssues, classificationIssues, mappingConfidenceIssues } from './normalization-rules';

// ---------------------------------------------------------------------------
// Date normalization (Enhancement Two)
// ---------------------------------------------------------------------------

describe('date normalization — unambiguous formats', () => {
  const cases: [unknown, string][] = [
    ['2026-07-22', '2026-07-22'],
    ['2026/07/22', '2026-07-22'],
    ['2026.07.22', '2026-07-22'],
    ['22.07.2026', '2026-07-22'],   // DD.MM.YYYY (22 > 12)
    ['22/07/2026', '2026-07-22'],   // DD/MM/YYYY
    ['07/22/2026', '2026-07-22'],   // MM/DD/YYYY (22 in day slot)
    ['22-07-2026', '2026-07-22'],
    ['20260722', '2026-07-22'],     // YYYYMMDD
    ['22 Jul 2026', '2026-07-22'],  // textual month
    ['July 22, 2026', '2026-07-22'],
    ['22 يوليو 2026', '2026-07-22'], // Arabic month
  ];
  it.each(cases)('parses %s → %s', (input, expected) => {
    const r = normalizeDateValue(input);
    expect(r.dateParsingStatus).toBe('parsed');
    expect(r.normalizedDate).toBe(expected);
  });
});

describe('date normalization — timestamps, excel serial, invalid', () => {
  it('parses ISO timestamp with timezone', () => {
    const r = normalizeDateValue('2026-07-22T14:30:00Z');
    expect(r.dateParsingStatus).toBe('parsed');
    expect(r.detectedDateFormat).toBe('ISO_TIMESTAMP_TZ');
    expect(r.timezoneDetected).toBe('Z');
    expect(r.normalizedDate?.startsWith('2026-07-22T')).toBe(true);
  });
  it('parses ISO timestamp without timezone', () => {
    const r = normalizeDateValue('2026-07-22T14:30:00');
    expect(r.dateParsingStatus).toBe('parsed');
    expect(r.detectedDateFormat).toBe('ISO_TIMESTAMP');
  });
  it('parses Excel serial numbers', () => {
    const r = normalizeDateValue(45000);
    expect(r.dateParsingStatus).toBe('parsed');
    expect(r.detectedDateFormat).toBe('EXCEL_SERIAL');
    expect(r.normalizedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('does NOT treat a normal quantity as a date', () => {
    const r = normalizeDateValue(25);
    expect(r.normalizedDate).toBeNull();
    expect(r.dateParsingStatus).not.toBe('parsed');
  });
  it('flags invalid dates', () => {
    const r = normalizeDateValue('31/02/2026');
    expect(r.normalizedDate).toBeNull();
    expect(r.dateParsingStatus).toBe('invalid');
  });
  it('marks empty values', () => {
    expect(normalizeDateValue('').dateParsingStatus).toBe('empty');
    expect(normalizeDateValue(null).dateParsingStatus).toBe('empty');
  });
});

describe('date normalization — ambiguity resolved from the column (Scenario D/E)', () => {
  it('resolves DD/MM using a value where day > 12', () => {
    const { analysis, dates } = normalizeDateColumn(['03/04/2026', '04/05/2026', '15/06/2026']);
    expect(analysis.order).toBe('DMY');
    expect(analysis.ambiguous).toBe(false);
    expect(dates[0].normalizedDate).toBe('2026-04-03'); // 03 April, consistent with the column
    expect(dates[2].normalizedDate).toBe('2026-06-15');
  });
  it('does not silently guess a fully-ambiguous column', () => {
    const { analysis } = normalizeDateColumn(['03/04/2026', '04/05/2026']);
    expect(analysis.order).toBeNull();
    expect(analysis.ambiguous).toBe(true);
    expect(normalizeDateValue('03/04/2026').dateParsingStatus).toBe('ambiguous');
  });
  it('detects mixed formats in one column', () => {
    const { analysis } = normalizeDateColumn(['22/07/2026', '2026-07-24']);
    expect(analysis.mixed).toBe(true);
  });
});

describe('UI date formatting', () => {
  it('formats ISO → DD/MM/YYYY by default', () => {
    expect(formatDisplayDate('2026-07-22')).toBe('22/07/2026');
    expect(formatDisplayDate('2026-07-22T14:30:00.000Z')).toBe('22/07/2026');
    expect(formatDisplayDate(null)).toBe('');
  });
  it('detectColumnDateFormat reports parsed count', () => {
    const a = detectColumnDateFormat(['2026-01-01', '2026-02-02']);
    expect(a.total).toBe(2);
    expect(a.mixed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Quantity sign & direction classification (Enhancement Three)
// ---------------------------------------------------------------------------

describe('transaction classification — canonical signed quantities', () => {
  it('positive receipt stays positive', () => {
    const r = classifyTransaction({ rawQuantity: 100, typeDescription: 'Goods Receipt' });
    expect(r.category).toBe('RECEIPT');
    expect(r.direction).toBe('IN');
    expect(r.signedQuantity).toBe(100);
  });
  it('consumption becomes negative', () => {
    const r = classifyTransaction({ rawQuantity: 25, typeDescription: 'Goods Issue' });
    expect(r.category).toBe('CONSUMPTION');
    expect(r.signedQuantity).toBe(-25);
  });
  it('positive UNSIGNED consumption with OUT direction → negative (Scenario F)', () => {
    const r = classifyTransaction({ rawQuantity: 25, directionHint: 'OUT', typeDescription: 'Consumption' });
    expect(r.category).toBe('CONSUMPTION');
    expect(r.direction).toBe('OUT');
    expect(r.signedQuantity).toBe(-25);
  });
  it('negative receipt reversal is a stock-decreasing reversal (Scenario I / 6.7)', () => {
    const r = classifyTransaction({ rawQuantity: -100, typeDescription: 'Receipt Reversal' });
    expect(r.category).toBe('REVERSAL_OUT');
    expect(r.direction).toBe('OUT');
    expect(r.signedQuantity).toBe(-100);
  });
  it('consumption reversal restores stock (positive)', () => {
    const r = classifyTransaction({ rawQuantity: 25, typeDescription: 'Reversal of Goods Issue' });
    expect(r.category).toBe('REVERSAL_IN');
    expect(r.signedQuantity).toBe(25);
  });
  it('transfers follow explicit direction and are their own category (Scenario H)', () => {
    const out = classifyTransaction({ rawQuantity: 20, typeDescription: 'Transfer', directionHint: 'OUT' });
    expect(out.category).toBe('TRANSFER_OUT');
    expect(out.signedQuantity).toBe(-20);
    const inn = classifyTransaction({ rawQuantity: 20, typeDescription: 'Transfer', directionHint: 'IN' });
    expect(inn.category).toBe('TRANSFER_IN');
    expect(inn.signedQuantity).toBe(20);
  });
  it('returns to supplier vs from source', () => {
    expect(classifyTransaction({ rawQuantity: 5, typeDescription: 'Return to supplier' }).category).toBe('RETURN_OUT');
    expect(classifyTransaction({ rawQuantity: 5, typeDescription: 'Return from project' }).category).toBe('RETURN_IN');
  });
  it('positive and negative adjustments', () => {
    expect(classifyTransaction({ rawQuantity: 3, typeDescription: 'Positive adjustment' }).category).toBe('ADJUSTMENT_IN');
    expect(classifyTransaction({ rawQuantity: -3, typeDescription: 'Adjustment' }).category).toBe('ADJUSTMENT_OUT');
  });
  it('debit/credit indicator sets direction', () => {
    expect(classifyTransaction({ rawQuantity: 10, debitCredit: 'S' }).direction).toBe('IN');
    expect(classifyTransaction({ rawQuantity: 10, debitCredit: 'H' }).direction).toBe('OUT');
  });
  it('contradictory direction and sign is flagged, direction wins', () => {
    const r = classifyTransaction({ rawQuantity: -5, directionHint: 'IN' });
    expect(r.direction).toBe('IN');
    expect(r.signedQuantity).toBe(5);
    expect(r.directionConflict).toBe(true);
    expect(r.signConflict).toBe(true);
  });
  it('unknown transaction type stays UNKNOWN (not forced into receipt)', () => {
    const r = classifyTransaction({ rawQuantity: 10, typeCode: 'ZZZ', typeDescription: 'Foobar' });
    expect(r.category).toBe('UNKNOWN');
    expect(r.direction).toBe('IN'); // direction can still be inferred from sign
  });
  it('preserves the raw quantity and parses ERP number formats', () => {
    const r = classifyTransaction({ rawQuantity: '1,234', typeDescription: 'Goods Receipt' });
    expect(r.parsedQuantity).toBe(1234);
    expect(r.absoluteQuantity).toBe(1234);
    expect(r.signedQuantity).toBe(1234);
  });
});

describe('transaction classification — separate receipt/consumption columns (Scenario G)', () => {
  it('receipt column becomes positive', () => {
    const r = classifySeparateColumns(100, 0)!;
    expect(r.category).toBe('RECEIPT');
    expect(r.signedQuantity).toBe(100);
  });
  it('consumption column becomes negative', () => {
    const r = classifySeparateColumns(0, 25)!;
    expect(r.category).toBe('CONSUMPTION');
    expect(r.signedQuantity).toBe(-25);
  });
  it('both populated is flagged, never netted', () => {
    const r = classifyTransaction({ receiptQty: 100, consumptionQty: 25 });
    expect(r.simultaneousReceiptAndConsumption).toBe(true);
    expect(r.category).toBe('UNKNOWN');
    expect(r.signedQuantity).toBeNull();
  });
});

describe('SAP adapter — movement types stay in the adapter', () => {
  it('classifies core SAP movement types', () => {
    expect(sapMovementTypeCategory('101')?.category).toBe('RECEIPT');
    expect(sapMovementTypeCategory('261')?.category).toBe('CONSUMPTION');
    expect(sapMovementTypeCategory('311')?.category).toBe('TRANSFER_OUT');
    expect(sapMovementTypeCategory('262')?.category).toBe('REVERSAL_IN');
    expect(sapMovementTypeCategory('999')).toBeNull();
  });
  it('SAP issue reversal (262) restores stock', () => {
    const r = classifyTransaction({ rawQuantity: 10, sapMovementType: '262' });
    expect(r.category).toBe('REVERSAL_IN');
    expect(r.signedQuantity).toBe(10);
    expect(r.classificationSource).toBe('source_adapter');
  });
  it('SAP transfer (311) decreases source stock', () => {
    const r = classifyTransaction({ rawQuantity: 20, sapMovementType: '311' });
    expect(r.category).toBe('TRANSFER_OUT');
    expect(r.signedQuantity).toBe(-20);
  });
});

// ---------------------------------------------------------------------------
// Generalized data-quality rules
// ---------------------------------------------------------------------------

describe('normalization data-quality rules', () => {
  it('reports an ambiguous date with row and reason', () => {
    const { analysis, dates } = normalizeDateColumn(['03/04/2026', '04/05/2026']);
    const issues = dateIssues(dates, analysis, { fileName: 'f.csv', columnName: 'Transaction Date' });
    const amb = issues.find((i) => i.code === 'AMBIGUOUS_DATE_FORMAT');
    expect(amb).toBeTruthy();
    expect(amb!.userActionRequired).toBe(true);
    expect(amb!.explanation).toMatch(/ambiguous/i);
  });
  it('reports simultaneous receipt and consumption', () => {
    const results = [classifyTransaction({ receiptQty: 100, consumptionQty: 25 })];
    const issues = classificationIssues(results, { fileName: 'f.csv' });
    expect(issues.some((i) => i.code === 'SIMULTANEOUS_RECEIPT_AND_CONSUMPTION')).toBe(true);
  });
  it('reports low-confidence column mappings that need confirmation', () => {
    const issues = mappingConfidenceIssues([
      { originalColumnName: 'Col X', detectedCanonicalField: 'material', confidenceScore: 0.6, userConfirmed: false },
      { originalColumnName: 'Item', detectedCanonicalField: 'material', confidenceScore: 0.95, userConfirmed: false },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('LOW_CONFIDENCE_COLUMN_MAPPING');
    expect(issues[0].blocksImport).toBe(true);
  });
});
