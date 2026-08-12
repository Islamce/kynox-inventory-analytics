import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kynox-tenant-'));
process.env.DB_CLIENT = 'better-sqlite3';
process.env.DB_FILE = path.join(tmpDir, 'tenant.sqlite');
process.env.JWT_SECRET = 'tenant-isolation-test-secret';
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.EXPORT_DIR = path.join(tmpDir, 'exports');
process.env.AI_PROVIDER = 'none';

const { createApp } = await import('./app');
const { db, insertGetId } = await import('./db');

const app = createApp();
let tenantAUserId = 0;
let tenantBUserId = 0;
let tenantAToken = '';
let tenantBToken = '';
let tenantBDatasetId = 0;
let tenantBUploadId = 0;

async function createTenantUser(tenantId: string, email: string, role = 'system_admin'): Promise<number> {
  await db('tenants').insert({ id: tenantId, code: tenantId, name: tenantId, status: 'active' });
  const userId = await insertGetId(db, 'users', {
    email,
    name: email,
    password_hash: bcrypt.hashSync('tenant-test-password', 10),
    role,
    active: true,
  });
  await db('tenant_memberships').insert({
    tenant_id: tenantId,
    user_id: userId,
    role,
    active: true,
    is_default: true,
  });
  return userId;
}

async function login(email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: 'tenant-test-password' });
  expect(response.status).toBe(200);
  return response.body.token;
}

beforeAll(async () => {
  await db.migrate.latest();
  tenantAUserId = await createTenantUser('tenant-a', 'admin-a@kynox.test');
  tenantBUserId = await createTenantUser('tenant-b', 'admin-b@kynox.test');
  tenantAToken = await login('admin-a@kynox.test');
  tenantBToken = await login('admin-b@kynox.test');

  tenantBUploadId = await insertGetId(db, 'uploads', {
    tenant_id: 'tenant-b',
    user_id: tenantBUserId,
    stored_name: 'tenant-b.csv',
    original_name: 'tenant-b.csv',
    size_bytes: 1,
    mime: 'text/csv',
    status: 'uploaded',
  });
  tenantBDatasetId = await insertGetId(db, 'datasets', {
    tenant_id: 'tenant-b',
    name: 'Tenant B Dataset',
    version: 1,
    kind: 'stock',
    status: 'ready',
    row_count: 0,
    created_by: tenantBUserId,
  });
  await db('audit_log').insert({
    tenant_id: 'tenant-b', user_id: tenantBUserId, action: 'tenant_b_only', result: 'success',
  });
});

afterAll(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('tenant-aware authentication', () => {
  it('resolves user, tenant, membership role and membership id server-side', async () => {
    const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tenantAToken}`);
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: tenantAUserId, tenantId: 'tenant-a', role: 'system_admin' });
    expect(response.body.user.membershipId).toEqual(expect.any(Number));
  });

  it('rejects a forged tenant claim when the user is not a member', async () => {
    const forged = jwt.sign({ sub: tenantAUserId, tenant: 'tenant-b' }, process.env.JWT_SECRET!);
    const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(response.status).toBe(401);
  });

  it('fails closed when membership context is missing', async () => {
    await db('users').insert({
      email: 'no-membership@kynox.test', name: 'No Membership',
      password_hash: bcrypt.hashSync('tenant-test-password', 10), role: 'read_only', active: true,
    });
    const response = await request(app).post('/api/auth/login')
      .send({ email: 'no-membership@kynox.test', password: 'tenant-test-password' });
    expect(response.status).toBe(401);
  });

  it('fails closed after membership or tenant deactivation', async () => {
    await db('tenant_memberships').where({ tenant_id: 'tenant-a', user_id: tenantAUserId }).update({ active: false });
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tenantAToken}`)).status).toBe(401);
    await db('tenant_memberships').where({ tenant_id: 'tenant-a', user_id: tenantAUserId }).update({ active: true });

    await db('tenants').where({ id: 'tenant-a' }).update({ status: 'inactive' });
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tenantAToken}`)).status).toBe(401);
    await db('tenants').where({ id: 'tenant-a' }).update({ status: 'active' });
  });
});

describe('cross-tenant object isolation', () => {
  it('does not enumerate or reveal a foreign dataset', async () => {
    const list = await request(app).get('/api/datasets').set('Authorization', `Bearer ${tenantAToken}`);
    expect(list.status).toBe(200);
    expect(list.body.datasets.some((dataset: { id: number }) => dataset.id === tenantBDatasetId)).toBe(false);

    const read = await request(app).get(`/api/datasets/${tenantBDatasetId}`).set('Authorization', `Bearer ${tenantAToken}`);
    const missing = await request(app).get('/api/datasets/999999').set('Authorization', `Bearer ${tenantAToken}`);
    expect(read.status).toBe(404);
    expect(read.body).toEqual(missing.body);
  });

  it('cannot mutate or delete a foreign dataset', async () => {
    const patchResponse = await request(app)
      .patch(`/api/datasets/${tenantBDatasetId}/canonical/1`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ category: 'ISSUE' });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await request(app)
      .delete(`/api/datasets/${tenantBDatasetId}`)
      .set('Authorization', `Bearer ${tenantAToken}`);
    expect(deleteResponse.status).toBe(404);
    expect(await db('datasets').where({ id: tenantBDatasetId, tenant_id: 'tenant-b' }).first()).toBeTruthy();
  });

  it('cannot access a foreign upload or mapping surface', async () => {
    const preview = await request(app)
      .get(`/api/uploads/${tenantBUploadId}/preview`)
      .set('Authorization', `Bearer ${tenantAToken}`);
    expect(preview.status).toBe(404);

    const mapping = await request(app)
      .put(`/api/uploads/${tenantBUploadId}/mapping`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ mapping: [] });
    expect(mapping.status).toBe(404);
  });

  it('cannot export or invoke AI analysis on a foreign dataset', async () => {
    const exportResponse = await request(app)
      .get(`/api/exports/dataset/${tenantBDatasetId}`)
      .set('Authorization', `Bearer ${tenantAToken}`);
    expect(exportResponse.status).toBe(404);

    const aiResponse = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ question: 'Analyze this foreign dataset', stockDatasetId: tenantBDatasetId });
    expect(aiResponse.status).toBe(404);
  });

  it('scopes system-admin user and audit access to its authorized tenant', async () => {
    const users = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${tenantAToken}`);
    expect(users.status).toBe(200);
    expect(users.body.users.some((user: { id: number }) => user.id === tenantBUserId)).toBe(false);

    const audit = await request(app).get('/api/admin/audit').set('Authorization', `Bearer ${tenantAToken}`);
    expect(audit.status).toBe(200);
    expect(audit.body.entries.some((entry: { action: string }) => entry.action === 'tenant_b_only')).toBe(false);
  });

  it('preserves access for the owning tenant', async () => {
    const response = await request(app).get(`/api/datasets/${tenantBDatasetId}`)
      .set('Authorization', `Bearer ${tenantBToken}`);
    expect(response.status).toBe(200);
  });
});
