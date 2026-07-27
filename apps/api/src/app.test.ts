/**
 * End-to-end API integration test on a throwaway SQLite database:
 * login -> upload MB52 -> detection -> mapping review -> validation ->
 * cleansing approval -> dataset -> analytics -> AI status -> export -> audit.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import request from 'supertest';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kynox-test-'));
// Honour an externally configured database (CI runs this suite against
// PostgreSQL); default to a throwaway SQLite file otherwise.
if (!process.env.DB_CLIENT || process.env.DB_CLIENT === 'better-sqlite3') {
  process.env.DB_CLIENT = 'better-sqlite3';
  process.env.DB_FILE = path.join(tmpDir, 'test.sqlite');
}
process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.EXPORT_DIR = path.join(tmpDir, 'exports');
process.env.AI_PROVIDER = 'none';

// Imports must come after env setup so config picks the test database.
const { createApp } = await import('./app');
const { db } = await import('./db');

const app = createApp();
let token = '';
let viewerToken = '';
let uploadId = 0;
let stockDatasetId = 0;
let movementsDatasetId = 0;

const MB52_CSV = [
  'Material,Material Description,Plant,Storage Location,Unrestricted,Value,Maximum Stock,Safety Stock,Reorder Point,Last Movement',
  'MAT-001,Hex Bolt M8,P100,0001,120,2400,100,20,40,2026-06-20',
  'MAT-002,Bearing 6204,P100,0001,15,4500,50,10,20,2025-01-10',
  'MAT-003,Gasket DN50,P100,0002,0,0,30,5,10,2024-05-01',
  'MAT-004,Steel Plate 3mm,P200,0001,300,15000,200,50,80,2026-07-01',
  'MAT-004,Steel Plate 3mm,P200,0001,300,15000,200,50,80,2026-07-01',
  'MAT-005,Hydraulic Oil 46,P200,0003,8,960,60,25,35,2026-05-15',
].join('\n');

const MB51_CSV = [
  'Material,Movement Type,Posting Date,Qty in unit of entry,Amount in Local Currency,Material Document',
  ...Array.from({ length: 12 }, (_, m) => {
    const month = String(m + 1).padStart(2, '0');
    return [
      `MAT-001,201,2025-${month}-10,-10,-200,50000${m}1`,
      `MAT-004,261,2025-${month}-15,-25,-1250,50000${m}2`,
      `MAT-005,201,2025-${month}-20,-2,-240,50000${m}3`,
      `MAT-001,101,2025-${month}-05,12,240,49000${m}1`,
    ].join('\n');
  }),
].join('\n');

beforeAll(async () => {
  await db.migrate.latest();
  await db('users').insert({
    email: 'test-admin@kynox.io',
    name: 'Test Admin',
    password_hash: bcrypt.hashSync('integration-test-password', 10),
    role: 'system_admin',
    active: true,
  });
  await db('users').insert({
    email: 'viewer@kynox.io',
    name: 'Read Only',
    password_hash: bcrypt.hashSync('viewer-test-password', 10),
    role: 'read_only',
    active: true,
  });
  // Default config used by analytics
  for (const [key, value] of Object.entries({
    non_moving_days: 365, slow_moving_days: 180, coverage_target_days: 90, service_level: 0.95,
  })) {
    await db('config').insert({ key, value: JSON.stringify(value) });
  }
});

afterAll(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('health endpoints', () => {
  it('serves health, version and readiness without auth or sensitive data', async () => {
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(JSON.stringify(health.body)).not.toContain('secret');
    const ready = await request(app).get('/api/readiness');
    expect(ready.body.status).toBe('ready');
    const version = await request(app).get('/api/version');
    expect(version.body.version).toBeTruthy();
  });
});

describe('authentication', () => {
  it('rejects bad credentials and audits the failure', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'test-admin@kynox.io', password: 'wrong-password' });
    expect(res.status).toBe(401);
    const auditRow = await db('audit_log').where({ action: 'login_failed' }).first();
    expect(auditRow).toBeTruthy();
  });

  it('logs in with valid credentials', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'test-admin@kynox.io', password: 'integration-test-password' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe('system_admin');
    token = res.body.token;

    const viewer = await request(app).post('/api/auth/login')
      .send({ email: 'viewer@kynox.io', password: 'viewer-test-password' });
    viewerToken = viewer.body.token;
  });

  it('blocks unauthenticated API access', async () => {
    const res = await request(app).get('/api/datasets');
    expect(res.status).toBe(401);
  });
});

describe('RBAC', () => {
  it('denies upload to read-only users', async () => {
    const res = await request(app).post('/api/uploads')
      .set('Authorization', `Bearer ${viewerToken}`)
      .attach('file', Buffer.from(MB52_CSV), { filename: 'mb52.csv', contentType: 'text/csv' });
    expect(res.status).toBe(403);
  });

  it('denies user management to read-only users', async () => {
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });
});

describe('data pipeline: MB52 stock', () => {
  it('uploads and auto-detects MB52 with confidence and mapping', async () => {
    const res = await request(app).post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(MB52_CSV), { filename: 'mb52-export.csv', contentType: 'text/csv' });
    expect(res.status).toBe(201);
    uploadId = res.body.id;
    expect(res.body.detection.reportType).toBe('MB52');
    expect(res.body.detection.confidence).toBeGreaterThan(0.5);
    const materialMapping = res.body.mapping.find((m: { canonicalField: string }) => m.canonicalField === 'material');
    expect(materialMapping.sourceColumn).toBe('Material');
  });

  it('rejects disallowed file types', async () => {
    const res = await request(app).post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('not a spreadsheet'), { filename: 'evil.exe', contentType: 'application/octet-stream' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('previews with column profiles', async () => {
    const res = await request(app).get(`/api/uploads/${uploadId}/preview`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.rowCount).toBe(6);
    const qtyProfile = res.body.columnProfiles.find((c: { column: string }) => c.column === 'Unrestricted');
    expect(qtyProfile.inferredType).toBe('number');
  });

  it('validates and reports the duplicate row with cleansing proposals', async () => {
    const res = await request(app).post(`/api/uploads/${uploadId}/validate`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const dup = res.body.issues.find((i: { ruleId: string }) => i.ruleId === 'duplicate_rows');
    expect(dup).toBeTruthy();
    expect(res.body.scores.overall).toBeGreaterThan(0);
    expect(res.body.proposals.length).toBeGreaterThan(0);
  });

  it('creates a versioned dataset applying approved cleansing', async () => {
    const validation = await request(app).post(`/api/uploads/${uploadId}/validate`)
      .set('Authorization', `Bearer ${token}`);
    const safeIds = validation.body.proposals
      .filter((p: { safe: boolean }) => p.safe)
      .map((p: { id: string }) => p.id);
    const res = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        uploadId,
        name: 'July Stock',
        approvedActionIds: safeIds,
        periodStart: '2026-07-01',
        periodEnd: '2026-07-19',
      });
    expect(res.status).toBe(201);
    stockDatasetId = res.body.id;
    expect(res.body.rowCount).toBe(5); // duplicate removed
    expect(res.body.qualityScores.overall).toBeGreaterThan(50);
  });
});

describe('data pipeline: MB51 movements', () => {
  it('uploads, detects and creates the movements dataset', async () => {
    const up = await request(app).post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(MB51_CSV), { filename: 'mb51-export.csv', contentType: 'text/csv' });
    expect(up.status).toBe(201);
    expect(up.body.detection.reportType).toBe('MB51');
    const validation = await request(app).post(`/api/uploads/${up.body.id}/validate`)
      .set('Authorization', `Bearer ${token}`);
    const safeIds = validation.body.proposals
      .filter((p: { safe: boolean }) => p.safe)
      .map((p: { id: string }) => p.id);
    const res = await request(app).post('/api/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ uploadId: up.body.id, name: '2025 Movements', approvedActionIds: safeIds, periodStart: '2025-01-01', periodEnd: '2025-12-31' });
    expect(res.status).toBe(201);
    movementsDatasetId = res.body.id;
    expect(res.body.rowCount).toBe(48);
  });
});

describe('analytics', () => {
  it('computes inventory position', async () => {
    const res = await request(app).get(`/api/analytics/position/${stockDatasetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totals.materials).toBe(5);
    expect(res.body.totals.value).toBeCloseTo(2400 + 4500 + 0 + 15000 + 960, 1);
  });

  it('computes aging with buckets', async () => {
    const res = await request(app).get(`/api/analytics/aging/${stockDatasetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const old = res.body.results.find((r: { material: string }) => r.material === 'MAT-003');
    expect(old.bucket).toBe('> 365 days');
  });

  it('classifies ABC by stock value', async () => {
    const res = await request(app).get(`/api/analytics/abc/${stockDatasetId}?metric=stock_value`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const top = res.body.results[0];
    expect(top.material).toBe('MAT-004');
    expect(top.abcClass).toBe('A');
  });

  it('classifies XYZ from movements', async () => {
    const res = await request(app).get(`/api/analytics/xyz/${movementsDatasetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const m1 = res.body.results.find((r: { material: string }) => r.material === 'MAT-001');
    expect(m1.xyzClass).toBe('X'); // perfectly stable 10/month
  });

  it('builds the ABC-XYZ matrix', async () => {
    const res = await request(app).get(`/api/analytics/matrix/${stockDatasetId}/${movementsDatasetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.cells).toHaveLength(9);
  });

  it('detects excess above max stock', async () => {
    const res = await request(app).get(`/api/analytics/excess/${stockDatasetId}?method=above_max_stock`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const mats = res.body.results.map((r: { material: string }) => r.material);
    expect(mats).toContain('MAT-001'); // 120 > max 100
    expect(mats).toContain('MAT-004'); // 300 > max 200
  });

  it('flags shortage risks', async () => {
    const res = await request(app).get(`/api/analytics/shortage/${stockDatasetId}?movementsDatasetId=${movementsDatasetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const mats = res.body.results.map((r: { material: string }) => r.material);
    expect(mats).toContain('MAT-003'); // zero stock below safety stock 5
    expect(mats).toContain('MAT-005'); // 8 below safety stock 25
  });

  it('computes consumption analytics with monthly series', async () => {
    const res = await request(app).get(`/api/analytics/consumption/${movementsDatasetId}?material=MAT-001`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(12);
    expect(res.body.stats.avgPerPeriod).toBe(10);
  });

  it('recommends a forecast method via back-test', async () => {
    const res = await request(app).get(`/api/analytics/forecast/${movementsDatasetId}?material=MAT-001`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.insufficientData).toBe(false);
    expect(res.body.best).toBeTruthy();
    expect(res.body.forecast.forecast.length).toBeGreaterThan(0);
  });

  it('proposes safety stock and reorder point with formulas', async () => {
    const res = await request(app)
      .get(`/api/analytics/planning/${stockDatasetId}/${movementsDatasetId}?material=MAT-001`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // MAT-001 has no lead time in MB52 -> proposal must refuse, not guess
    expect(res.body.insufficientData).toBe(true);
    expect(res.body.note).toContain('lead time');
  });

  it('serves the material 360 view', async () => {
    const res = await request(app)
      .get(`/api/analytics/material360/${stockDatasetId}?material=MAT-004&movementsDatasetId=${movementsDatasetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stock.material).toBe('MAT-004');
    expect(res.body.abc.abcClass).toBe('A');
    expect(res.body.consumption).toBeTruthy();
  });

  it('serves the executive dashboard', async () => {
    const res = await request(app)
      .get(`/api/analytics/dashboard/${stockDatasetId}?movementsDatasetId=${movementsDatasetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.kpis.totalValue).toBeGreaterThan(0);
    expect(res.body.kpis.healthScore).toBeGreaterThan(0);
    expect(res.body.aging.length).toBeGreaterThan(0);
  });

  it('rejects analytics on the wrong dataset kind', async () => {
    const res = await request(app).get(`/api/analytics/position/${movementsDatasetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('AI governance', () => {
  it('reports unconfigured AI status honestly', async () => {
    const res = await request(app).get('/api/ai/status').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });

  it('returns 503 (never fake output) when no provider is configured', async () => {
    const res = await request(app).post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'Which materials create the highest working-capital risk?', stockDatasetId });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('not configured');
  });
});

describe('exports', () => {
  it('exports the dataset as XLSX', async () => {
    const res = await request(app).get(`/api/exports/dataset/${stockDatasetId}`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect((res.body as Buffer).length).toBeGreaterThan(500);
  });

  it('exports the management PDF report', async () => {
    const res = await request(app)
      .get(`/api/exports/report/${stockDatasetId}?movementsDatasetId=${movementsDatasetId}`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('pdf');
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('administration and audit', () => {
  it('manages users and audits role changes', async () => {
    const created = await request(app).post('/api/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'planner@kynox.io', name: 'Planner', password: 'planner-password-1', role: 'material_planner' });
    expect(created.status).toBe(201);
    const patched = await request(app).patch(`/api/admin/users/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'inventory_manager' });
    expect(patched.status).toBe(200);
    const auditRow = await db('audit_log').where({ action: 'role_changed' }).first();
    expect(auditRow).toBeTruthy();
  });

  it('updates configuration with audit trail', async () => {
    const res = await request(app).put('/api/admin/config/coverage_target_days')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 120 });
    expect(res.status).toBe(200);
    const auditRow = await db('audit_log').where({ action: 'config_changed' }).orderBy('id', 'desc').first();
    expect(JSON.parse(auditRow.new_value)).toBe(120);
  });

  it('rejects unknown config keys', async () => {
    const res = await request(app).put('/api/admin/config/evil_key')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 'x' });
    expect(res.status).toBe(400);
  });

  it('serves the audit log with pagination', async () => {
    const res = await request(app).get('/api/admin/audit?page=1&pageSize=10')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThan(0);
    expect(res.body.total).toBeGreaterThan(5);
    const actions = new Set(res.body.entries.map((e: { action: string }) => e.action));
    expect(actions.size).toBeGreaterThan(0);
  });

  it('logs the full pipeline in the audit trail', async () => {
    const actions = (await db('audit_log').select('action')).map((r) => r.action);
    for (const expected of ['login', 'file_uploaded', 'dataset_created', 'cleansing_approved', 'export', 'ai_query']) {
      if (expected === 'ai_query') continue; // AI not configured in tests -> no query logged
      expect(actions).toContain(expected);
    }
  });
});
