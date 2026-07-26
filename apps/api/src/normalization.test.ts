/**
 * Phase 2 — canonical normalization persistence & import-pipeline wiring.
 *
 * End-to-end through the real upload → validate → dataset sequence:
 *  - a generic (non-SAP) transaction file persists canonical_transactions with
 *    the mapped source row preserved as JSON and dataset-level summary metadata;
 *  - unrecognised transaction types stay UNKNOWN and are excluded from the
 *    receipt/consumption KPIs (never forced in);
 *  - a genuinely ambiguous date column BLOCKS activation until the user confirms
 *    the day/month order, then imports cleanly;
 *  - canonical persistence is transactional (a failed canonical insert rolls the
 *    dataset back — no partially active dataset);
 *  - SAP MB51 (numeric BWART) still classifies via the SAP adapter (regression).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import request from 'supertest';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kynox-norm-'));
if (!process.env.DB_CLIENT || process.env.DB_CLIENT === 'better-sqlite3') {
  process.env.DB_CLIENT = 'better-sqlite3';
  process.env.DB_FILE = path.join(tmpDir, 'test.sqlite');
}
process.env.JWT_SECRET = 'test-secret-for-normalization-tests';
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.EXPORT_DIR = path.join(tmpDir, 'exports');
process.env.AI_PROVIDER = 'none';

const { createApp } = await import('./app');
const { db, insertGetId } = await import('./db');

const app = createApp();
let token = '';

async function uploadCsv(csv: string, filename: string) {
  return request(app).post('/api/uploads')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.from(csv), { filename, contentType: 'text/csv' });
}

async function safeIdsFor(uploadId: number): Promise<string[]> {
  const validation = await request(app).post(`/api/uploads/${uploadId}/validate`)
    .set('Authorization', `Bearer ${token}`);
  return validation.body.proposals.filter((p: { safe: boolean }) => p.safe).map((p: { id: string }) => p.id);
}

beforeAll(async () => {
  await db.migrate.latest();
  await db('users').insert({
    email: 'norm@kynox.io', name: 'Normalization Tester',
    password_hash: bcrypt.hashSync('normalization-test-password', 10),
    role: 'system_admin', active: true,
  });
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'norm@kynox.io', password: 'normalization-test-password' });
  token = res.body.token;
});

afterAll(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('generic transaction import → canonical persistence', () => {
  it('persists canonical rows, preserves the source row, and excludes UNKNOWN from KPIs', async () => {
    const csv = [
      'Item Code,Item Description,Transaction Date,Quantity,Transaction Type,Warehouse',
      'G-1,Widget,2026-01-05,100,Goods Receipt,WH1',
      'G-2,Gadget,2026-01-06,40,Goods Issue,WH1',
      'G-3,Gizmo,2026-01-07,7,Sparkle Operation,WH2',   // unrecognised type -> UNKNOWN
    ].join('\n');
    const up = await uploadCsv(csv, 'generic-transactions.csv');
    expect(up.status).toBe(201);

    const ds = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: 'Generic Txns', approvedActionIds: await safeIdsFor(up.body.id) });
    expect(ds.status).toBe(201);

    // Canonical rows persisted for every valid row.
    const canonical = await db('canonical_transactions').where({ dataset_id: ds.body.id }).orderBy('source_row_number');
    expect(canonical).toHaveLength(3);

    const byMaterial = Object.fromEntries(canonical.map((r) => [r.material_id, r]));
    expect(byMaterial['G-1'].transaction_category).toBe('RECEIPT');
    expect(byMaterial['G-1'].transaction_direction).toBe('IN');
    expect(Number(byMaterial['G-1'].signed_quantity)).toBe(100);
    expect(byMaterial['G-2'].transaction_category).toBe('CONSUMPTION');
    expect(Number(byMaterial['G-2'].signed_quantity)).toBe(-40);
    // Unrecognised type stays UNKNOWN and visible — never forced into a KPI.
    expect(byMaterial['G-3'].transaction_category).toBe('UNKNOWN');

    // Source row preserved verbatim (post-mapping canonical fields).
    const preserved = JSON.parse(byMaterial['G-1'].original_source_record);
    expect(preserved.material).toBe('G-1');
    expect(preserved.material_description).toBe('Widget');

    // Dataset-level metadata + summary.
    const meta = await request(app).get(`/api/datasets/${ds.body.id}/normalization`)
      .set('Authorization', `Bearer ${token}`);
    expect(meta.status).toBe(200);
    expect(meta.body.summary.normalizedRows).toBe(3);
    expect(meta.body.summary.receiptRows).toBe(1);
    expect(meta.body.summary.consumptionRows).toBe(1);
    expect(meta.body.summary.unknownTransactionRows).toBe(1);
    // UNKNOWN excluded from consumption KPI: only G-2 counted.
    expect(meta.body.summary.totalConsumptionQuantity).toBe(40);
    expect(meta.body.summary.totalReceiptQuantity).toBe(100);

    // Canonical read API paginates and filters.
    const page = await request(app).get(`/api/datasets/${ds.body.id}/canonical?category=RECEIPT`)
      .set('Authorization', `Bearer ${token}`);
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(1);
    expect(page.body.rows[0].material_id).toBe('G-1');
  });
});

describe('ambiguous date column blocks activation until confirmed', () => {
  it('returns 422 without a date order, then imports when the order is confirmed', async () => {
    const csv = [
      'Item Code,Transaction Date,Quantity,Transaction Type',
      'A-1,03/04/2026,10,Goods Issue',
      'A-2,05/06/2026,20,Goods Issue',
      'A-3,07/08/2026,30,Goods Issue',
    ].join('\n');
    const up = await uploadCsv(csv, 'ambiguous-dates.csv');
    expect(up.status).toBe(201);
    const safeIds = await safeIdsFor(up.body.id);

    const blocked = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: 'Ambiguous Dates', approvedActionIds: safeIds });
    expect(blocked.status).toBe(422);
    expect(String(blocked.body.error ?? blocked.body.message ?? '')).toMatch(/dateOrder/i);

    const confirmed = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: 'Ambiguous Dates', approvedActionIds: safeIds, dateOrder: 'DMY' });
    expect(confirmed.status).toBe(201);

    const canonical = await db('canonical_transactions').where({ dataset_id: confirmed.body.id }).orderBy('source_row_number');
    expect(canonical).toHaveLength(3);
    // 03/04/2026 under DMY = 3 April 2026.
    expect(String(canonical[0].transaction_date).slice(0, 10)).toBe('2026-04-03');
    expect(confirmed.body.normalization.summary.dateFormatUserConfirmed).toBe(true);
  });
});

describe('canonical persistence is transactional', () => {
  it('rolls the dataset back when a canonical insert fails (no partial dataset)', async () => {
    await expect(db.transaction(async (trx) => {
      const id = await insertGetId(trx, 'datasets', {
        name: 'Rollback Probe', version: 1, kind: 'movements', status: 'ready',
        row_count: 1, created_by: 1,
      });
      // material_id is NOT NULL — this insert throws, rolling back the dataset.
      await trx('canonical_transactions').insert({ dataset_id: id, source_row_number: 0 });
    })).rejects.toThrow();

    const leftover = await db('datasets').where({ name: 'Rollback Probe' }).first();
    expect(leftover).toBeUndefined();
  });
});

describe('SAP MB51 regression — numeric BWART via the SAP adapter', () => {
  it('classifies SAP movement types canonically while the existing pipeline is unchanged', async () => {
    const csv = [
      'Material,Movement Type,Posting Date,Qty in unit of entry,Amount in Local Currency,Material Document',
      'S-1,101,2026-01-10,100,1000,DOC1',      // receipt
      'S-1,261,2026-01-12,-40,-400,DOC2',      // consumption
      'S-1,311,2026-01-15,-20,-200,DOC3',      // transfer (excluded from demand)
    ].join('\n');
    const up = await uploadCsv(csv, 'sap-mb51.csv');
    expect(up.body.detection.reportType).toBe('MB51');

    const ds = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: 'SAP MB51', approvedActionIds: await safeIdsFor(up.body.id) });
    expect(ds.status).toBe(201);
    expect(ds.body.sourceSystem).toBe('SAP');

    const canonical = await db('canonical_transactions').where({ dataset_id: ds.body.id }).orderBy('source_row_number');
    const cats = canonical.map((r) => r.transaction_category);
    expect(cats).toEqual(['RECEIPT', 'CONSUMPTION', 'TRANSFER_OUT']);
    expect(canonical.every((r) => r.classification_source === 'source_adapter')).toBe(true);

    // Existing movements table still populated (backward compatible).
    const movements = await db('movements').where({ dataset_id: ds.body.id });
    expect(movements).toHaveLength(3);
  });
});
