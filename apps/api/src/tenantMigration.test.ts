import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import knex, { type Knex } from 'knex';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kynox-tenant-migration-'));
let database: Knex;

const initial = require('./db/migrations/20260719000001_initial_schema.js');
const aiUsage = require('./db/migrations/20260719000002_ai_usage_columns.js');
const canonical = require('./db/migrations/20260722000003_canonical_normalization.js');
const tenant = require('./db/migrations/20260812000004_tenant_foundation.js');

beforeAll(async () => {
  database = knex({
    client: 'better-sqlite3',
    connection: { filename: path.join(tmpDir, 'migration.sqlite') },
    useNullAsDefault: true,
  });
  await initial.up(database);
  await aiUsage.up(database);
  await canonical.up(database);

  await database('users').insert([
    { id: 1, email: 'legacy@kynox.test', name: 'Legacy', password_hash: 'x', role: 'system_admin', active: true },
    { id: 2, email: 'guest@anonymous.local', name: 'Guest', password_hash: 'x', role: 'guest', active: true },
  ]);
  await database('uploads').insert([
    { id: 10, user_id: 1, stored_name: 'a', original_name: 'a', size_bytes: 1, mime: 'text/csv' },
    { id: 11, user_id: 2, stored_name: 'b', original_name: 'b', size_bytes: 1, mime: 'text/csv' },
  ]);
  await database('datasets').insert([
    { id: 20, name: 'Legacy', kind: 'stock', created_by: 1 },
    { id: 21, name: 'Demo', kind: 'movements', created_by: 2 },
  ]);
  await database('stock_items').insert({ dataset_id: 20, material: 'A', quantity: 1, value: 1 });
  await database('movements').insert({ dataset_id: 21, material: 'B', movement_qty: 1, posting_date: '2026-08-12' });
  await database('canonical_transactions').insert({
    dataset_id: 21, source_row_number: 1, original_source_record: '{}',
    material_id: 'B', transaction_date: '2026-08-12', transaction_category: 'ISSUE',
    transaction_direction: 'OUT', parsed_quantity: 1, signed_quantity: -1,
  });
  await database('audit_log').insert({ user_id: 1, action: 'before_migration' });
  await database('ai_logs').insert({ user_id: 2, dataset_id: 21, question: 'q' });
  await database('exports').insert({ user_id: 1, dataset_id: 20, export_type: 'xlsx', filename: 'x' });
});

afterAll(async () => {
  await database.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('tenant migration integrity and rollback rehearsal', () => {
  it('backfills every legacy row without changing IDs or row counts', async () => {
    const tables = [
      'users', 'uploads', 'datasets', 'stock_items', 'movements',
      'canonical_transactions', 'audit_log', 'ai_logs', 'exports',
    ];
    const before = Object.fromEntries(await Promise.all(tables.map(async (tableName) => {
      const [{ count }] = await database(tableName).count({ count: '*' });
      return [tableName, Number(count)];
    })));

    await tenant.up(database);

    for (const tableName of tables) {
      const [{ count }] = await database(tableName).count({ count: '*' });
      expect(Number(count), tableName).toBe(before[tableName]);
    }
    expect(await database('uploads').where({ id: 10 }).first('tenant_id')).toMatchObject({ tenant_id: 'legacy-default' });
    expect(await database('uploads').where({ id: 11 }).first('tenant_id')).toMatchObject({ tenant_id: 'public-demo' });
    expect(await database('datasets').where({ id: 20 }).first('tenant_id')).toMatchObject({ tenant_id: 'legacy-default' });
    expect(await database('datasets').where({ id: 21 }).first('tenant_id')).toMatchObject({ tenant_id: 'public-demo' });

    for (const [tableName, datasetId] of [['stock_items', 20], ['movements', 21], ['canonical_transactions', 21]] as const) {
      const child = await database(tableName).where({ dataset_id: datasetId }).first('tenant_id');
      const parent = await database('datasets').where({ id: datasetId }).first('tenant_id');
      expect(child.tenant_id, tableName).toBe(parent.tenant_id);
    }
    expect(await database('tenant_memberships').where({ user_id: 1 }).first('tenant_id')).toMatchObject({ tenant_id: 'legacy-default' });
    expect(await database('tenant_memberships').where({ user_id: 2 }).first('tenant_id')).toMatchObject({ tenant_id: 'public-demo' });
  });

  it('rolls the tenant layer back on the rehearsal copy without deleting legacy data', async () => {
    await tenant.down(database);
    expect(await database.schema.hasTable('tenants')).toBe(false);
    expect(await database.schema.hasTable('tenant_memberships')).toBe(false);
    expect(await database.schema.hasColumn('datasets', 'tenant_id')).toBe(false);
    expect(Number((await database('datasets').count({ count: '*' }))[0].count)).toBe(2);
    expect(Number((await database('uploads').count({ count: '*' }))[0].count)).toBe(2);
  });
});
