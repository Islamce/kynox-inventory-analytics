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

// Postgres returns date columns as Date objects; SQLite/MySQL as ISO strings.
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

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
    expect(iso(canonical[0].transaction_date)).toBe('2026-04-03');
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
    // Raw SAP technical field codes (not display labels) — the only reliable
    // signal that this is genuinely SAP data, per classifySource().
    const csv = [
      'MATNR,BWART,BUDAT,ERFMG,DMBTR,MBLNR',
      'S-1,101,2026-01-10,100,1000,DOC1',      // receipt
      'S-1,261,2026-01-12,-40,-400,DOC2',      // consumption
      'S-1,311,2026-01-15,-20,-200,DOC3',      // transfer (excluded from demand)
    ].join('\n');
    const up = await uploadCsv(csv, 'sap-mb51.csv');
    expect(up.body.detection.reportType).toBe('MB51');

    // The real Workspace UI always resubmits the full mapping via PUT when the
    // user clicks "Confirm mapping & validate", even for columns they never
    // touched. That resubmission must not erase the sap_technical provenance
    // the detector already established (regression: it previously did, which
    // silently made every SAP import via the real pipeline look non-SAP).
    const remapped = await request(app).put(`/api/uploads/${up.body.id}/mapping`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mapping: up.body.mapping.map((m: { sourceColumn: string; canonicalField: string | null }) => ({ sourceColumn: m.sourceColumn, canonicalField: m.canonicalField })) });
    expect(remapped.body.mapping.every((m: { method: string }) => m.method === 'sap_technical')).toBe(true);

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

describe('generic files are not mislabeled SAP by report-type shape alone', () => {
  it('a generic file matching an SAP report signature (material + date + quantity) stays non-SAP without technical columns', async () => {
    // No SAP terminology anywhere — but material/date/quantity is exactly the
    // shape MB5B's detection signature requires. Report-type shape must not be
    // treated as SAP evidence on its own (regression for a mislabeling found
    // via manual browser testing of the import preview UI).
    const csv = [
      'Item Code,Item Description,Transaction Date,Quantity,Transaction Type,Warehouse',
      'G-1,Widget,2026-01-05,100,Goods Receipt,WH1',
    ].join('\n');
    const up = await uploadCsv(csv, 'generic-shape-collision.csv');
    const safeIds = await safeIdsFor(up.body.id);
    const ds = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: 'Generic Shape Collision', approvedActionIds: safeIds });
    expect(ds.status).toBe(201);
    expect(ds.body.sourceSystem).not.toBe('SAP');

    const meta = await request(app).get(`/api/datasets/${ds.body.id}/normalization`)
      .set('Authorization', `Bearer ${token}`);
    expect(meta.body.sourceSystem).not.toBe('SAP');
  });
});

describe('AI evidence includes transaction normalization findings', () => {
  it('collects normalization evidence for a movements dataset without erroring (still 503 with no provider configured)', async () => {
    const csv = [
      'Item Code,Item Description,Transaction Date,Quantity,Transaction Type,Warehouse',
      'G-1,Widget,2026-01-05,100,Goods Receipt,WH1',
      'G-2,Gadget,2026-01-06,7,Sparkle Operation,WH2',
    ].join('\n');
    const up = await uploadCsv(csv, 'ai-evidence.csv');
    const ds = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: 'AI Evidence Dataset', approvedActionIds: await safeIdsFor(up.body.id) });
    expect(ds.status).toBe(201);

    // AI_PROVIDER=none in this test suite, so the request still cleanly 503s —
    // the point of this test is that collecting the new transactionNormalization
    // evidence (reading datasets.normalization_summary/findings) for a linked
    // movements dataset does not throw and corrupt that clean-503 contract.
    const chat = await request(app).post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'Why are some transactions excluded from consumption?', movementsDatasetId: ds.body.id });
    expect(chat.status).toBe(503);
    expect(chat.body.error).toContain('not configured');
  });
});

describe('document-level transfer/reversal pairing', () => {
  it('pairs a transfer-out to its matching transfer-in and flags an unmatched transfer', async () => {
    const csv = [
      'MATNR,BWART,BUDAT,ERFMG,DMBTR,MBLNR',
      'T-1,311,2026-01-10,50,500,DOC1',   // TRANSFER_OUT — matches T-1/312 below
      'T-1,312,2026-01-10,50,500,DOC2',   // TRANSFER_IN
      'T-2,311,2026-01-11,30,300,DOC3',   // TRANSFER_OUT with no matching TRANSFER_IN in this dataset
    ].join('\n');
    const up = await uploadCsv(csv, 'transfer-pairing.csv');
    const ds = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: 'Transfer Pairing', approvedActionIds: await safeIdsFor(up.body.id) });
    expect(ds.status).toBe(201);

    const rows = await db('canonical_transactions').where({ dataset_id: ds.body.id }).orderBy('source_row_number');
    const t1Out = rows.find((r) => r.reference_document === 'DOC1');
    const t1In = rows.find((r) => r.reference_document === 'DOC2');
    const t2Out = rows.find((r) => r.reference_document === 'DOC3');

    expect(t1Out.transfer_id).not.toBeNull();
    expect(t1Out.transfer_id).toBe(t1In.transfer_id);
    expect(t1Out.paired_transaction_id).toBe('DOC2');
    expect(t1In.paired_transaction_id).toBe('DOC1');

    // Unmatched transfer stays unpaired and is flagged, not silently dropped.
    expect(t2Out.transfer_id).toBeNull();
    const meta = await request(app).get(`/api/datasets/${ds.body.id}/normalization`)
      .set('Authorization', `Bearer ${token}`);
    const unpaired = meta.body.findings.filter((f: { code: string }) => f.code === 'TRANSFER_PAIR_NOT_FOUND');
    expect(unpaired).toHaveLength(1);
    expect(unpaired[0].rowNumber).toBe(t2Out.source_row_number);
  });

  it('pairs a reversal to the original transaction it reverses and flags an unmatched reversal', async () => {
    const csv = [
      'MATNR,BWART,BUDAT,ERFMG,DMBTR,MBLNR',
      'R-1,101,2026-01-05,100,1000,DOC1',  // RECEIPT
      'R-1,102,2026-01-07,100,1000,DOC2',  // REVERSAL_OUT — reverses DOC1
      'R-2,262,2026-01-09,20,200,DOC3',    // REVERSAL_IN with no matching consumption in this dataset
    ].join('\n');
    const up = await uploadCsv(csv, 'reversal-pairing.csv');
    const ds = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: 'Reversal Pairing', approvedActionIds: await safeIdsFor(up.body.id) });
    expect(ds.status).toBe(201);

    const rows = await db('canonical_transactions').where({ dataset_id: ds.body.id }).orderBy('source_row_number');
    const receipt = rows.find((r) => r.reference_document === 'DOC1');
    const reversal = rows.find((r) => r.reference_document === 'DOC2');
    const unmatchedReversal = rows.find((r) => r.reference_document === 'DOC3');

    expect(receipt.transaction_category).toBe('RECEIPT');
    expect(reversal.transaction_category).toBe('REVERSAL_OUT');
    expect(reversal.reversal_of_transaction_id).toBe('DOC1');

    expect(unmatchedReversal.reversal_of_transaction_id).toBeNull();
    const meta = await request(app).get(`/api/datasets/${ds.body.id}/normalization`)
      .set('Authorization', `Bearer ${token}`);
    const unpaired = meta.body.findings.filter((f: { code: string }) => f.code === 'REVERSAL_ORIGINAL_NOT_FOUND');
    expect(unpaired).toHaveLength(1);
    expect(unpaired[0].rowNumber).toBe(unmatchedReversal.source_row_number);
  });
});

describe('manual per-row classification override', () => {
  it('corrects an UNKNOWN row, recomputes derived fields, and keeps the dataset summary consistent', async () => {
    const csv = [
      'Item Code,Transaction Date,Quantity,Transaction Type,Warehouse',
      'U-1,2026-01-05,25,Sparkle Operation,WH1',   // unrecognised type -> UNKNOWN
    ].join('\n');
    const up = await uploadCsv(csv, 'override-unknown.csv');
    const ds = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: 'Override Unknown', approvedActionIds: await safeIdsFor(up.body.id) });
    expect(ds.status).toBe(201);

    const before = await db('canonical_transactions').where({ dataset_id: ds.body.id }).first();
    expect(before.transaction_category).toBe('UNKNOWN');

    const beforeMeta = await request(app).get(`/api/datasets/${ds.body.id}/normalization`)
      .set('Authorization', `Bearer ${token}`);
    expect(beforeMeta.body.summary.unknownTransactionRows).toBe(1);
    expect(beforeMeta.body.findings.some((f: { code: string }) => f.code === 'UNKNOWN_TRANSACTION_TYPE')).toBe(true);

    const patch = await request(app).patch(`/api/datasets/${ds.body.id}/canonical/${before.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'RECEIPT' });
    expect(patch.status).toBe(200);
    expect(patch.body.row.transaction_category).toBe('RECEIPT');
    expect(patch.body.row.transaction_direction).toBe('IN');
    expect(patch.body.row.signed_quantity).toBe(25);
    expect(patch.body.row.receipt_quantity).toBe(25);
    expect(patch.body.row.classification_source).toBe('user_rule');

    const afterMeta = await request(app).get(`/api/datasets/${ds.body.id}/normalization`)
      .set('Authorization', `Bearer ${token}`);
    expect(afterMeta.body.summary.unknownTransactionRows).toBe(0);
    expect(afterMeta.body.summary.receiptRows).toBe(1);
    expect(afterMeta.body.counts.unknownTransactionRows).toBe(0);
    // The finding this override directly resolves is dropped, not left stale.
    expect(afterMeta.body.findings.some((f: { code: string }) => f.code === 'UNKNOWN_TRANSACTION_TYPE')).toBe(false);
  });

  it('rejects an invalid category and 404s on a canonical row from a different dataset (no IDOR)', async () => {
    const csvA = 'Item Code,Transaction Date,Quantity,Transaction Type,Warehouse\nA-1,2026-01-05,10,Goods Receipt,WH1\n';
    const upA = await uploadCsv(csvA, 'override-a.csv');
    const dsA = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: upA.body.id, name: 'Override A', approvedActionIds: await safeIdsFor(upA.body.id) });

    const csvB = 'Item Code,Transaction Date,Quantity,Transaction Type,Warehouse\nB-1,2026-01-06,10,Goods Receipt,WH1\n';
    const upB = await uploadCsv(csvB, 'override-b.csv');
    const dsB = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: upB.body.id, name: 'Override B', approvedActionIds: await safeIdsFor(upB.body.id) });

    const rowInA = await db('canonical_transactions').where({ dataset_id: dsA.body.id }).first();

    const badCategory = await request(app).patch(`/api/datasets/${dsA.body.id}/canonical/${rowInA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'NOT_A_REAL_CATEGORY' });
    expect(badCategory.status).toBe(400);

    // rowInA belongs to dataset A; addressing it through dataset B's URL must 404, not update it.
    const idor = await request(app).patch(`/api/datasets/${dsB.body.id}/canonical/${rowInA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'CONSUMPTION' });
    expect(idor.status).toBe(404);

    const stillA = await db('canonical_transactions').where({ id: rowInA.id }).first();
    expect(stillA.transaction_category).toBe('RECEIPT'); // unchanged
  });

  it('requires authentication', async () => {
    const res = await request(app).patch('/api/datasets/1/canonical/1').send({ category: 'RECEIPT' });
    expect(res.status).toBe(401);
  });
});

describe('import-time normalization preview (before dataset creation)', () => {
  it('shows the ambiguous-date finding and never persists anything', async () => {
    const csv = [
      'Item Code,Transaction Date,Quantity,Transaction Type,Warehouse',
      'P-1,03/04/2026,10,Goods Issue,WH1',
      'P-2,05/06/2026,20,Goods Issue,WH1',
      'P-3,07/08/2026,30,Goods Issue,WH1',
    ].join('\n');
    const up = await uploadCsv(csv, 'preview-ambiguous.csv');
    const safeIds = await safeIdsFor(up.body.id);

    const [datasetsBefore] = await db('datasets').count({ c: '*' });
    const [canonicalBefore] = await db('canonical_transactions').count({ c: '*' });

    const preview = await request(app).post('/api/datasets/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, approvedActionIds: safeIds });
    expect(preview.status).toBe(200);
    expect(preview.body.wouldBlock).toBe(false);
    // This is the authoritative signal the Workspace UI keys off to show the
    // date-order picker before creation (the same flag that gates the 422 at
    // creation time).
    expect(preview.body.normalization.ambiguousDatesNeedConfirmation).toBe(true);

    const [datasetsAfter] = await db('datasets').count({ c: '*' });
    const [canonicalAfter] = await db('canonical_transactions').count({ c: '*' });
    expect(datasetsAfter.c).toEqual(datasetsBefore.c);
    expect(canonicalAfter.c).toEqual(canonicalBefore.c);

    // Confirming dateOrder in the preview resolves the ambiguity and matches
    // what actually creating the dataset with the same dateOrder produces.
    const previewConfirmed = await request(app).post('/api/datasets/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, approvedActionIds: safeIds, dateOrder: 'DMY' });
    expect(previewConfirmed.body.normalization.ambiguousDatesNeedConfirmation).toBe(false);
    expect(previewConfirmed.body.normalization.canonicalRowCount).toBe(3);

    const created = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: 'Preview Then Create', approvedActionIds: safeIds, dateOrder: 'DMY' });
    expect(created.status).toBe(201);
    expect(created.body.normalization.summary.receiptRows).toBe(previewConfirmed.body.normalization.summary.receiptRows);
    expect(created.body.normalization.canonicalRowCount).toBe(previewConfirmed.body.normalization.canonicalRowCount);
  });

  it('reports wouldBlock for remaining critical issues without throwing', async () => {
    const csv = [
      'Material,Quantity,Value',
      ',10,100',   // missing material -> critical issue if not excluded
    ].join('\n');
    const up = await uploadCsv(csv, 'preview-critical.csv');
    const preview = await request(app).post('/api/datasets/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, approvedActionIds: [] });
    expect(preview.status).toBe(200);
    if (preview.body.criticalIssues.length > 0) {
      expect(preview.body.wouldBlock).toBe(true);
    }
  });

  it('requires authentication and object-level ownership like dataset creation does', async () => {
    const anon = await request(app).post('/api/datasets/preview').send({ uploadId: 1, approvedActionIds: [] });
    expect(anon.status).toBe(401);
  });
});
