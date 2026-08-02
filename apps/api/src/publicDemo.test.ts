/**
 * PUBLIC_DEMO_MODE — anonymous 'guest' identity, scoped strictly to the
 * uploader's own data, with admin/audit/config/AI still requiring real login.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import request from 'supertest';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kynox-demo-'));
if (!process.env.DB_CLIENT || process.env.DB_CLIENT === 'better-sqlite3') {
  process.env.DB_CLIENT = 'better-sqlite3';
  process.env.DB_FILE = path.join(tmpDir, 'test.sqlite');
}
process.env.JWT_SECRET = 'test-secret-for-public-demo-tests';
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.EXPORT_DIR = path.join(tmpDir, 'exports');
process.env.AI_PROVIDER = 'none';
process.env.PUBLIC_DEMO_MODE = 'true';
process.env.GUEST_DATA_RETENTION_HOURS = '48';

const { createApp } = await import('./app');
const { db } = await import('./db');
const { runCleanup } = await import('./services/cleanup');

const app = createApp();
let adminToken = '';

const STOCK_CSV = [
  'Material,Plant,Unrestricted,Value',
  'DEMO-1,P1,50,500',
].join('\n');

async function uploadAsGuest(sessionId: string, csv = STOCK_CSV, filename = 'demo-stock.csv') {
  return request(app).post('/api/uploads')
    .set('X-Guest-Session', sessionId)
    .attach('file', Buffer.from(csv), { filename, contentType: 'text/csv' });
}
async function createDatasetAsGuest(sessionId: string, uploadId: number, name: string) {
  const validation = await request(app).post(`/api/uploads/${uploadId}/validate`).set('X-Guest-Session', sessionId);
  const safeIds = validation.body.proposals.filter((p: { safe: boolean }) => p.safe).map((p: { id: string }) => p.id);
  return request(app).post('/api/datasets')
    .set('X-Guest-Session', sessionId)
    .send({ uploadId, name, approvedActionIds: safeIds });
}

beforeAll(async () => {
  await db.migrate.latest();
  await db('users').insert({
    email: 'demo-admin@kynox.io', name: 'Demo Admin Tester',
    password_hash: bcrypt.hashSync('public-demo-admin-password', 10),
    role: 'system_admin', active: true,
  });
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'demo-admin@kynox.io', password: 'public-demo-admin-password' });
  adminToken = res.body.token;
});

afterAll(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/config/public', () => {
  it('reports PUBLIC_DEMO_MODE without requiring authentication', async () => {
    const res = await request(app).get('/api/config/public');
    expect(res.status).toBe(200);
    expect(res.body.publicDemoMode).toBe(true);
  });
});

describe('anonymous guest identity', () => {
  it('rejects a request with neither an Authorization header nor a guest session id', async () => {
    const res = await request(app).get('/api/datasets');
    expect(res.status).toBe(400);
  });

  it('rejects a malformed X-Guest-Session value', async () => {
    const res = await request(app).get('/api/datasets').set('X-Guest-Session', 'not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('resolves a real, persistent guest user for a well-formed session id, reused across requests', async () => {
    const sessionId = crypto.randomUUID();
    const first = await request(app).get('/api/auth/me').set('X-Guest-Session', sessionId);
    expect(first.status).toBe(200);
    expect(first.body.user.role).toBe('guest');
    expect(first.body.user.email).toContain(sessionId);

    const second = await request(app).get('/api/auth/me').set('X-Guest-Session', sessionId);
    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id); // same underlying row, not re-created
  });

  it('gives two different guest sessions two different identities', async () => {
    const a = await request(app).get('/api/auth/me').set('X-Guest-Session', crypto.randomUUID());
    const b = await request(app).get('/api/auth/me').set('X-Guest-Session', crypto.randomUUID());
    expect(a.body.user.id).not.toBe(b.body.user.id);
  });
});

describe('guest data isolation', () => {
  it('lets a guest upload and analyze its own data end to end', async () => {
    const sessionId = crypto.randomUUID();
    const up = await uploadAsGuest(sessionId);
    expect(up.status).toBe(201);
    const ds = await createDatasetAsGuest(sessionId, up.body.id, 'Guest Demo Stock');
    expect(ds.status).toBe(201);

    const analysis = await request(app).get(`/api/analytics/position/${ds.body.id}`).set('X-Guest-Session', sessionId);
    expect(analysis.status).toBe(200);
    expect(analysis.body.totals.materials).toBe(1);
  });

  it('never shows one guest session another guest\'s (or a real user\'s) datasets in the list', async () => {
    const sessionA = crypto.randomUUID();
    const sessionB = crypto.randomUUID();
    const upA = await uploadAsGuest(sessionA, STOCK_CSV, 'a.csv');
    const dsA = await createDatasetAsGuest(sessionA, upA.body.id, 'Session A Stock');
    expect(dsA.status).toBe(201);

    const listA = await request(app).get('/api/datasets').set('X-Guest-Session', sessionA);
    expect(listA.body.datasets.some((d: { id: number }) => d.id === dsA.body.id)).toBe(true);

    const listB = await request(app).get('/api/datasets').set('X-Guest-Session', sessionB);
    expect(listB.body.datasets.some((d: { id: number }) => d.id === dsA.body.id)).toBe(false);

    // Even a real, fully-authenticated org user's list is unaffected — the
    // shared org-wide view for real roles is untouched by guest scoping.
    const listAdmin = await request(app).get('/api/datasets').set('Authorization', `Bearer ${adminToken}`);
    expect(listAdmin.body.datasets.some((d: { id: number }) => d.id === dsA.body.id)).toBe(true);
  });

  it('blocks a guest from reading, analyzing or exporting a dataset it does not own (IDOR)', async () => {
    const sessionA = crypto.randomUUID();
    const sessionB = crypto.randomUUID();
    const upA = await uploadAsGuest(sessionA, STOCK_CSV, 'a2.csv');
    const dsA = await createDatasetAsGuest(sessionA, upA.body.id, 'Session A Stock 2');
    expect(dsA.status).toBe(201);

    const getB = await request(app).get(`/api/datasets/${dsA.body.id}`).set('X-Guest-Session', sessionB);
    expect(getB.status).toBe(403);

    const analysisB = await request(app).get(`/api/analytics/position/${dsA.body.id}`).set('X-Guest-Session', sessionB);
    expect(analysisB.status).toBe(403);

    const exportB = await request(app).get(`/api/exports/dataset/${dsA.body.id}`).set('X-Guest-Session', sessionB);
    expect(exportB.status).toBe(403);
  });

  it('blocks a guest from reading another user\'s upload before any dataset exists (IDOR)', async () => {
    const sessionA = crypto.randomUUID();
    const sessionB = crypto.randomUUID();
    const upA = await uploadAsGuest(sessionA, STOCK_CSV, 'a3.csv');
    const previewB = await request(app).post('/api/datasets/preview')
      .set('X-Guest-Session', sessionB)
      .send({ uploadId: upA.body.id, approvedActionIds: [] });
    expect(previewB.status).toBe(403);
  });
});

describe('guest permission scope', () => {
  it('denies admin, user management, audit, config and AI chat even though the guest is "authenticated"', async () => {
    const sessionId = crypto.randomUUID();
    const admin = await request(app).get('/api/admin/users').set('X-Guest-Session', sessionId);
    expect(admin.status).toBe(403);
    const config = await request(app).get('/api/admin/config').set('X-Guest-Session', sessionId);
    expect(config.status).toBe(403);
    const audit = await request(app).get('/api/admin/audit').set('X-Guest-Session', sessionId);
    expect(audit.status).toBe(403);
    const ai = await request(app).post('/api/ai/chat').set('X-Guest-Session', sessionId).send({ message: 'hi' });
    expect(ai.status).toBe(403);
  });

  it('still lets a real system_admin read /api/admin/config (regression for the newly added permission check)', async () => {
    const res = await request(app).get('/api/admin/config').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe('guest data retention cleanup', () => {
  it('purges guest datasets and uploads older than the retention window, but keeps the guest user row (audit trail)', async () => {
    const sessionId = crypto.randomUUID();
    const up = await uploadAsGuest(sessionId, STOCK_CSV, 'old.csv');
    const ds = await createDatasetAsGuest(sessionId, up.body.id, 'Old Guest Dataset');
    expect(ds.status).toBe(201);

    const old = new Date(Date.now() - 72 * 3600_000); // older than the 48h retention window
    await db('datasets').where({ id: ds.body.id }).update({ created_at: old });
    await db('uploads').where({ id: up.body.id }).update({ created_at: old });

    const result = await runCleanup();
    expect(result.guestDatasetsDeleted).toBeGreaterThanOrEqual(1);
    expect(result.guestUploadsDeleted).toBeGreaterThanOrEqual(1);

    const dsRow = await db('datasets').where({ id: ds.body.id }).first();
    expect(dsRow).toBeUndefined();
    const upRow = await db('uploads').where({ id: up.body.id }).first();
    expect(upRow).toBeUndefined();

    const meAfter = await request(app).get('/api/auth/me').set('X-Guest-Session', sessionId);
    expect(meAfter.status).toBe(200); // the guest identity itself survives cleanup
  });
});
