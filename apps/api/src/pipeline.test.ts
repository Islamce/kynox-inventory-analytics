/**
 * Data-import integrity tests: multi-sheet XLSX, Arabic + SAP technical
 * headers, duplicate headers, EU number formats, Excel serial dates, negative
 * quantities, size limits, source-file immutability, reversal handling.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kynox-pipe-'));
if (!process.env.DB_CLIENT || process.env.DB_CLIENT === 'better-sqlite3') {
  process.env.DB_CLIENT = 'better-sqlite3';
  process.env.DB_FILE = path.join(tmpDir, 'test.sqlite');
}
process.env.JWT_SECRET = 'test-secret-for-pipeline-tests';
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.EXPORT_DIR = path.join(tmpDir, 'exports');
process.env.AI_PROVIDER = 'none';
process.env.MAX_UPLOAD_MB = '1';

const { createApp } = await import('./app');
const { db } = await import('./db');

const app = createApp();
let token = '';

function xlsxBuffer(sheets: { name: string; rows: Record<string, unknown>[] }[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function uploadBuffer(buf: Buffer, filename: string, contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  return request(app).post('/api/uploads')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', buf, { filename, contentType });
}

beforeAll(async () => {
  await db.migrate.latest();
  await db('users').insert({
    email: 'pipe@kynox.io', name: 'Pipeline Tester',
    password_hash: bcrypt.hashSync('pipeline-test-password', 10),
    role: 'system_admin', active: true,
  });
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'pipe@kynox.io', password: 'pipeline-test-password' });
  token = res.body.token;
});

afterAll(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('multi-sheet workbooks', () => {
  it('lists all sheets and supports switching the active sheet', async () => {
    const buf = xlsxBuffer([
      { name: 'Notes', rows: [{ Info: 'cover sheet', Author: 'x' }] },
      {
        name: 'MB52',
        rows: [
          { Material: 'X-1', Plant: 'P1', Unrestricted: 10, Value: 100 },
          { Material: 'X-2', Plant: 'P1', Unrestricted: 5, Value: 50 },
        ],
      },
    ]);
    const up = await uploadBuffer(buf, 'stock-multi.xlsx');
    expect(up.status).toBe(201);
    expect(up.body.sheets.map((s: { name: string }) => s.name)).toEqual(['Notes', 'MB52']);

    const switched = await request(app).put(`/api/uploads/${up.body.id}/sheet`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sheet: 'MB52' });
    expect(switched.status).toBe(200);
    expect(switched.body.detection.reportType).toBe('MB52');
    expect(switched.body.rowCount).toBe(2);
  });
});

describe('header handling', () => {
  it('maps Arabic headers to canonical fields', async () => {
    const buf = xlsxBuffer([{
      name: 'Sheet1',
      rows: [
        { 'رقم المادة': 'AR-1', 'الوصف': 'مادة اختبار', 'الكمية': 20, 'القيمة': 400, 'المصنع': 'P9' },
      ],
    }]);
    const up = await uploadBuffer(buf, 'arabic.xlsx');
    expect(up.status).toBe(201);
    const byField = Object.fromEntries(
      up.body.mapping.filter((m: { canonicalField: string | null }) => m.canonicalField)
        .map((m: { canonicalField: string; sourceColumn: string }) => [m.canonicalField, m.sourceColumn]),
    );
    expect(byField.material).toBe('رقم المادة');
    expect(byField.quantity).toBe('الكمية');
    expect(byField.value).toBe('القيمة');
    expect(byField.plant).toBe('المصنع');
  });

  it('maps SAP technical column names', async () => {
    const buf = xlsxBuffer([{
      name: 'export',
      rows: [{ MATNR: 'S-1', WERKS: 'P1', LGORT: '0001', LABST: 3, SALK3: 30, MAKTX: 'Widget' }],
    }]);
    const up = await uploadBuffer(buf, 'sap-technical.xlsx');
    const byField = Object.fromEntries(
      up.body.mapping.filter((m: { canonicalField: string | null }) => m.canonicalField)
        .map((m: { canonicalField: string; sourceColumn: string }) => [m.canonicalField, m.sourceColumn]),
    );
    expect(byField.material).toBe('MATNR');
    expect(byField.plant).toBe('WERKS');
    expect(byField.storage_location).toBe('LGORT');
    expect(byField.material_description).toBe('MAKTX');
  });

  it('disambiguates duplicate headers instead of overwriting columns', async () => {
    const csv = 'Material,Quantity,Quantity\nD-1,5,7\n';
    const up = await uploadBuffer(Buffer.from(csv), 'dup-headers.csv', 'text/csv');
    expect(up.status).toBe(201);
    const preview = await request(app).get(`/api/uploads/${up.body.id}/preview`)
      .set('Authorization', `Bearer ${token}`);
    expect(preview.body.headers).toContain('Quantity');
    expect(preview.body.headers).toContain('Quantity (2)');
  });
});

describe('number and date normalisation end to end', () => {
  it('handles decimal commas, thousands separators, SAP trailing minus and Excel serial dates', async () => {
    const csv = [
      'Material,Qty in unit of entry,Amount in Local Currency,Posting Date,Movement Type',
      'N-1,"1.234,5","2.469,00",45107,201',       // EU format + Excel serial (2023-06-30)
      'N-2,"2,000","4,000.50",15.03.2026,201',    // US thousands + DD.MM.YYYY
      'N-3,100-,200-,2026/03/16,201',             // SAP trailing minus
    ].join('\n');
    const up = await uploadBuffer(Buffer.from(csv), 'mb51-formats.csv', 'text/csv');
    expect(up.status).toBe(201);
    const validation = await request(app).post(`/api/uploads/${up.body.id}/validate`)
      .set('Authorization', `Bearer ${token}`);
    const safeIds = validation.body.proposals.filter((p: { safe: boolean }) => p.safe).map((p: { id: string }) => p.id);
    const ds = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: 'Format Test', approvedActionIds: safeIds });
    expect(ds.status).toBe(201);

    const rows = await db('movements').where({ dataset_id: ds.body.id }).orderBy('material');
    // Postgres returns date columns as Date objects; SQLite/MySQL as strings.
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
    expect(rows).toHaveLength(3);
    // 201 is an issue type: sign normalisation makes all quantities negative.
    expect(rows[0].movement_qty).toBe(-1234.5);
    expect(iso(rows[0].posting_date)).toBe('2023-06-30');
    expect(rows[1].movement_qty).toBe(-2000);
    expect(iso(rows[1].posting_date)).toBe('2026-03-15');
    expect(rows[2].movement_qty).toBe(-100);
    expect(iso(rows[2].posting_date)).toBe('2026-03-16');
  });
});

describe('quality flags for risky data', () => {
  it('flags negative stock, mixed currencies and conflicting units', async () => {
    const buf = xlsxBuffer([{
      name: 'stock',
      rows: [
        { Material: 'Q-1', Quantity: -5, Value: -50, Currency: 'USD', 'Base Unit': 'EA' },
        { Material: 'Q-1', Quantity: 10, Value: 100, Currency: 'EUR', 'Base Unit': 'KG' },
      ],
    }]);
    const up = await uploadBuffer(buf, 'quality-flags.xlsx');
    const validation = await request(app).post(`/api/uploads/${up.body.id}/validate`)
      .set('Authorization', `Bearer ${token}`);
    const ids = validation.body.issues.map((i: { ruleId: string }) => i.ruleId);
    expect(ids).toContain('negative_stock');
    expect(ids).toContain('mixed_currencies');
    expect(ids).toContain('conflicting_units');
  });
});

describe('upload limits and immutability', () => {
  it('rejects files above the configured size limit', async () => {
    const big = Buffer.alloc(1_500_000, 'a'); // MAX_UPLOAD_MB=1 in this suite
    const res = await uploadBuffer(big, 'too-big.csv', 'text/csv');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('never modifies the original uploaded file, even after cleansing', async () => {
    const csv = 'Material,Quantity,Value\n IM-1 ,"1,5",30\n IM-1 ,"1,5",30\n';
    const original = Buffer.from(csv);
    const originalHash = crypto.createHash('sha256').update(original).digest('hex');
    const up = await uploadBuffer(original, 'immutable.csv', 'text/csv');
    const validation = await request(app).post(`/api/uploads/${up.body.id}/validate`)
      .set('Authorization', `Bearer ${token}`);
    const safeIds = validation.body.proposals.filter((p: { safe: boolean }) => p.safe).map((p: { id: string }) => p.id);
    const ds = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: 'Immutability Test', approvedActionIds: safeIds });
    expect(ds.status).toBe(201);
    expect(ds.body.cleansingLog.length).toBeGreaterThan(0); // transformations traceable

    const uploadRow = await db('uploads').where({ id: up.body.id }).first();
    const stored = fs.readFileSync(path.join(process.env.UPLOAD_DIR!, uploadRow.stored_name));
    expect(crypto.createHash('sha256').update(stored).digest('hex')).toBe(originalHash);
  });
});

describe('physical inventory pipeline', () => {
  it('detects, loads and analyses a count export', async () => {
    const buf = xlsxBuffer([{
      name: 'PI Documents',
      rows: [
        { Material: 'PI-1', 'Book Quantity': 100, 'Counted Quantity': 98, Plant: 'P1' },
        { Material: 'PI-2', 'Book Quantity': 50, 'Counted Quantity': 55, Plant: 'P1' },
        { Material: 'PI-3', 'Book Quantity': 10, 'Counted Quantity': 10, Plant: 'P1' },
      ],
    }]);
    const up = await uploadBuffer(buf, 'physical-inventory.xlsx');
    expect(up.body.detection.reportType).toBe('PHYSICAL_INVENTORY');
    const validation = await request(app).post(`/api/uploads/${up.body.id}/validate`)
      .set('Authorization', `Bearer ${token}`);
    const safeIds = validation.body.proposals.filter((p: { safe: boolean }) => p.safe).map((p: { id: string }) => p.id);
    const ds = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: 'PI Test', approvedActionIds: safeIds });
    expect(ds.status).toBe(201);

    const analysis = await request(app).get(`/api/analytics/physical/${ds.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(analysis.status).toBe(200);
    // 1 of 3 lines exact → 33.3%; |−2| + |5| + 0 = 7 over book 160 → 95.6%.
    expect(analysis.body.lineAccuracyPct).toBeCloseTo(33.3, 0);
    expect(analysis.body.quantityAccuracyPct).toBeCloseTo(95.6, 0);
    expect(analysis.body.positiveVariance).toBe(5);
    expect(analysis.body.negativeVariance).toBe(2);
  });
});

describe('reversals and duplicates in consumption', () => {
  it('consumption analytics count CONSUMPTION only; reversals are tracked separately, not netted', async () => {
    // Consumption/ABC/XYZ/shortage/excess/health analytics are computed from
    // the canonical `TransactionCategory` model (`DEMAND_CATEGORIES` =
    // ['CONSUMPTION'] only, per @kynox/shared-types): REVERSAL_IN/OUT is a
    // distinct category from CONSUMPTION by design, so a reversed issue is
    // visible in the reversal count/reconciliation view rather than silently
    // reducing demand. This replaced an earlier increment's legacy SAP
    // heuristic (`movements` table + hardcoded movement-type sets) that
    // subtracted issue reversals straight out of consumption — an explicit,
    // user-approved architectural decision, not an accidental regression.
    const csv = [
      'Material,Movement Type,Posting Date,Qty in unit of entry,Amount in Local Currency,Material Document',
      'R-1,261,2026-01-10,-100,-1000,DOC1',
      'R-1,261,2026-01-10,-100,-1000,DOC1',    // exact duplicate -> removed by cleansing
      'R-1,262,2026-01-12,60,600,DOC2',        // reversal -> own category, not netted
      'R-1,261,2026-02-10,-40,-400,DOC3',
      'R-1,311,2026-02-15,-500,-5000,DOC4',    // transfer -> not consumption
    ].join('\n');
    const up = await uploadBuffer(Buffer.from(csv), 'mb51-reversals.csv', 'text/csv');
    const validation = await request(app).post(`/api/uploads/${up.body.id}/validate`)
      .set('Authorization', `Bearer ${token}`);
    const safeIds = validation.body.proposals.filter((p: { safe: boolean }) => p.safe).map((p: { id: string }) => p.id);
    const ds = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: 'Reversal Test', approvedActionIds: safeIds });
    expect(ds.status).toBe(201);
    expect(ds.body.rowCount).toBe(4); // duplicate removed

    const canonical = await db('canonical_transactions').where({ dataset_id: ds.body.id }).orderBy('source_row_number');
    expect(canonical.map((r) => r.transaction_category)).toEqual(['CONSUMPTION', 'REVERSAL_IN', 'CONSUMPTION', 'TRANSFER_OUT']);

    const consumption = await request(app)
      .get(`/api/analytics/consumption/${ds.body.id}?material=R-1&granularity=month`)
      .set('Authorization', `Bearer ${token}`);
    expect(consumption.status).toBe(200);
    // 100 + 40 = 140 (transfer excluded, duplicate removed, reversal NOT subtracted).
    expect(consumption.body.stats.totalQuantity).toBe(140);
  });
});
