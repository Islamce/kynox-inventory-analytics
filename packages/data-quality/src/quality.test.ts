import { describe, it, expect } from 'vitest';
import { parseNumber, parseDate, similarity } from './parsers';
import { runQualityRules, type MappedRow } from './rules';
import { computeQualityScores } from './scoring';
import { proposeCleansing, applyCleansing } from './cleansing';

describe('parseNumber', () => {
  it('parses plain numbers', () => {
    expect(parseNumber('123.45').value).toBe(123.45);
    expect(parseNumber(42).value).toBe(42);
  });
  it('parses EU decimal commas', () => {
    expect(parseNumber('1.234,56').value).toBe(1234.56);
    expect(parseNumber('123,45').value).toBe(123.45);
  });
  it('parses US thousands separators', () => {
    expect(parseNumber('1,234.56').value).toBe(1234.56);
    expect(parseNumber('1,234').value).toBe(1234);
  });
  it('parses SAP trailing minus and accounting parentheses', () => {
    expect(parseNumber('100-').value).toBe(-100);
    expect(parseNumber('(50)').value).toBe(-50);
  });
  it('fails cleanly on garbage', () => {
    expect(parseNumber('abc').value).toBeNull();
    expect(parseNumber('').value).toBeNull();
    expect(parseNumber(null).value).toBeNull();
  });
});

describe('parseDate', () => {
  it('parses common formats to ISO', () => {
    expect(parseDate('2026-07-15').value).toBe('2026-07-15');
    expect(parseDate('15.07.2026').value).toBe('2026-07-15');
    expect(parseDate('15/07/2026').value).toBe('2026-07-15');
    expect(parseDate('20260715').value).toBe('2026-07-15');
  });
  it('parses Excel serial dates', () => {
    expect(parseDate(45000).value).toBe('2023-03-15');
  });
  it('rejects impossible dates', () => {
    expect(parseDate('31.02.2026').value).toBeNull();
    expect(parseDate('not a date').value).toBeNull();
  });
});

describe('quality rules', () => {
  const stockRows: MappedRow[] = [
    { material: 'M1', quantity: 10, value: 100, material_description: 'Bolt M8' },
    { material: '', quantity: 5, value: 50 },
    { material: 'M2', quantity: 'xx', value: 20 },
    { material: 'M3', quantity: -4, value: -40 },
    { material: 'M1', quantity: 10, value: 100, material_description: 'BOLT M-8' },
  ];

  it('detects missing materials, invalid and negative quantities', () => {
    const issues = runQualityRules('stock', stockRows, '2026-07-19');
    const ids = issues.map((i) => i.ruleId);
    expect(ids).toContain('missing_material');
    expect(ids).toContain('invalid_quantity');
    expect(ids).toContain('negative_stock');
    expect(ids).toContain('inconsistent_descriptions');
    const missing = issues.find((i) => i.ruleId === 'missing_material')!;
    expect(missing.severity).toBe('critical');
    expect(missing.affectedRows).toBe(1);
    expect(missing.samples[0].row).toBe(1);
  });

  it('detects duplicates and future postings in movements', () => {
    const rows: MappedRow[] = [
      { material: 'M1', movement_qty: -5, posting_date: '2026-01-10', document_number: 'D1', movement_type: '201' },
      { material: 'M1', movement_qty: -5, posting_date: '2026-01-10', document_number: 'D1', movement_type: '201' },
      { material: 'M2', movement_qty: 3, posting_date: '2099-01-01', document_number: 'D2', movement_type: '201' },
    ];
    const issues = runQualityRules('movements', rows, '2026-07-19');
    const ids = issues.map((i) => i.ruleId);
    expect(ids).toContain('duplicate_rows');
    expect(ids).toContain('future_posting_dates');
    expect(ids).toContain('unexpected_movement_sign'); // 201 issue with positive qty
  });

  it('detects count-difference mismatches', () => {
    const rows: MappedRow[] = [
      { material: 'M1', book_qty: 10, counted_qty: 8, count_difference: 5 },
    ];
    const issues = runQualityRules('physical_inventory', rows, '2026-07-19');
    expect(issues.map((i) => i.ruleId)).toContain('count_difference_mismatch');
  });

  it('is quiet on clean data', () => {
    const rows: MappedRow[] = [
      { material: 'M1', quantity: 10, value: 100 },
      { material: 'M2', quantity: 20, value: 200 },
    ];
    const issues = runQualityRules('stock', rows, '2026-07-19');
    expect(issues.filter((i) => i.severity === 'critical')).toHaveLength(0);
  });
});

describe('quality scoring', () => {
  it('scores clean data near 100 and flawed data lower', () => {
    const clean: MappedRow[] = [
      { material: 'M1', quantity: 10, value: 100 },
      { material: 'M2', quantity: 20, value: 200 },
    ];
    const cleanScores = computeQualityScores('stock', clean, runQualityRules('stock', clean, '2026-07-19'));
    expect(cleanScores.overall).toBeGreaterThan(90);

    const dirty: MappedRow[] = [
      { material: '', quantity: 'bad', value: null },
      { material: 'M1', quantity: 10, value: 100 },
      { material: 'M1', quantity: 10, value: 100 },
    ];
    const dirtyScores = computeQualityScores('stock', dirty, runQualityRules('stock', dirty, '2026-07-19'));
    expect(dirtyScores.overall).toBeLessThan(cleanScores.overall);
    expect(dirtyScores.uniqueness).toBeLessThan(100);
  });
});

describe('cleansing', () => {
  it('proposes actions and applies only approved ones without mutating input', () => {
    const rows: MappedRow[] = [
      { material: ' M1 ', quantity: '1.234,56', posting_date: '15.07.2026', movement_type: '201', movement_qty: '10' },
      { material: 'M2', quantity: '10', posting_date: '2026-07-01' },
      { material: 'M2', quantity: '10', posting_date: '2026-07-01' },
    ];
    const issues = runQualityRules('movements', rows, '2026-07-19');
    const proposals = proposeCleansing('movements', rows, issues);
    expect(proposals.length).toBeGreaterThan(0);

    const approved = proposals.filter((p) => p.safe);
    const original = JSON.stringify(rows);
    const result = applyCleansing(rows, approved);

    expect(JSON.stringify(rows)).toBe(original); // source untouched
    expect(result.log.length).toBeGreaterThan(0);
    const m1 = result.rows.find((r) => r.material === 'M1')!;
    expect(m1.quantity).toBe(1234.56);
    expect(m1.posting_date).toBe('2026-07-15');
    expect(m1.movement_qty).toBe(-10); // sign normalised for issue type 201
    // duplicate removed
    expect(result.rows.filter((r) => r.material === 'M2')).toHaveLength(1);
    expect(result.excludedRows.some((e) => e.reason === 'duplicate')).toBe(true);
  });
});

describe('similarity', () => {
  it('scores similar strings high and different ones low', () => {
    expect(similarity('Material', 'material')).toBe(1);
    expect(similarity('Bolt M8', 'Bolt M-8')).toBeGreaterThan(0.7);
    expect(similarity('Bolt', 'Gasket')).toBeLessThan(0.4);
  });
});
