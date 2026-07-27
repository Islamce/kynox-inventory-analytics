/**
 * Phase 2 — inventory reconciliation (opening + movements = closing), computed
 * from canonical_transactions and (optionally) reconciled against a linked
 * stock dataset's current quantity.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import request from 'supertest';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kynox-recon-'));
if (!process.env.DB_CLIENT || process.env.DB_CLIENT === 'better-sqlite3') {
  process.env.DB_CLIENT = 'better-sqlite3';
  process.env.DB_FILE = path.join(tmpDir, 'test.sqlite');
}
process.env.JWT_SECRET = 'test-secret-for-reconciliation-tests';
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
async function createDataset(uploadId: number, name: string) {
  return request(app).post('/api/datasets')
    .set('Authorization', `Bearer ${token}`)
    .send({ uploadId, name, approvedActionIds: await safeIdsFor(uploadId) });
}

beforeAll(async () => {
  await db.migrate.latest();
  await db('users').insert({
    email: 'recon@kynox.io', name: 'Reconciliation Tester',
    password_hash: bcrypt.hashSync('reconciliation-test-password', 10),
    role: 'system_admin', active: true,
  });
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'recon@kynox.io', password: 'reconciliation-test-password' });
  token = res.body.token;
});

afterAll(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('reconciliation on a dataset with no canonical data', () => {
  it('reports unavailable rather than pretending to reconcile', async () => {
    // Legacy path: insert a movements dataset directly, bypassing canonical persistence.
    const id = await insertGetId(db, 'datasets', {
      name: 'Legacy Movements', version: 1, kind: 'movements', status: 'ready', row_count: 0, created_by: 1,
    });
    const res = await request(app).get(`/api/analytics/reconciliation/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.results).toEqual([]);
  });
});

describe('reconciliation with canonical data, no stock link', () => {
  it('computes opening + movements = closing per material from canonical_transactions', async () => {
    const csv = [
      'Item Code,Transaction Date,Quantity,Transaction Type,Warehouse',
      'R-1,2026-01-01,100,Goods Receipt,WH1',
      'R-1,2026-01-05,40,Goods Issue,WH1',
      'R-1,2026-01-10,10,Goods Issue,WH1',
      'R-1,2026-01-15,20,Transfer Posting,WH1',   // transfer, sign resolved by generic classifier
    ].join('\n');
    const up = await uploadCsv(csv, 'reconciliation-basic.csv');
    const ds = await createDataset(up.body.id, 'Reconciliation Basic');
    expect(ds.status).toBe(201);

    const res = await request(app).get(`/api/analytics/reconciliation/${ds.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.stockDatasetLinked).toBe(false);

    const row = res.body.results.find((r: { material: string }) => r.material === 'R-1');
    expect(row).toBeDefined();
    expect(row.receiptQty).toBe(100);
    expect(row.consumptionQty).toBe(-50);
    // computedClosing = receipts + consumption + transfer net (opening is 0; no OPENING_BALANCE rows)
    expect(row.computedClosingQty).toBe(row.receiptQty + row.consumptionQty + row.transferNet);
    expect(row.reportedStockQty).toBeNull();
    expect(row.variance).toBeNull();
  });
});

describe('reconciliation with a linked stock dataset', () => {
  it('flags a variance when the computed closing quantity disagrees with reported stock', async () => {
    const movCsv = [
      'Item Code,Transaction Date,Quantity,Transaction Type,Warehouse',
      'R-2,2026-01-01,100,Goods Receipt,WH1',
      'R-2,2026-01-05,30,Goods Issue,WH1',
    ].join('\n');
    const movUp = await uploadCsv(movCsv, 'reconciliation-stock.csv');
    const movDs = await createDataset(movUp.body.id, 'Reconciliation Movements');
    expect(movDs.status).toBe(201);
    // computed closing for R-2 = 100 - 30 = 70

    const stockCsv = [
      'Material,Plant,Unrestricted,Value',
      'R-2,P1,50,500',   // reported stock disagrees with computed closing (70) -> variance
    ].join('\n');
    const stockUp = await uploadCsv(stockCsv, 'reconciliation-stock-snapshot.csv');
    const stockDs = await createDataset(stockUp.body.id, 'Reconciliation Stock');
    expect(stockDs.status).toBe(201);
    expect(stockDs.body.kind).toBe('stock');

    const res = await request(app)
      .get(`/api/analytics/reconciliation/${movDs.body.id}?stockDatasetId=${stockDs.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stockDatasetLinked).toBe(true);

    const row = res.body.results.find((r: { material: string }) => r.material === 'R-2');
    expect(row.computedClosingQty).toBe(70);
    expect(row.reportedStockQty).toBe(50);
    expect(row.variance).toBe(20);
    expect(res.body.summary.materialsWithVariance).toBeGreaterThanOrEqual(1);
  });
});

describe('reconciliation IDOR / RBAC', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/analytics/reconciliation/1');
    expect(res.status).toBe(401);
  });
});
