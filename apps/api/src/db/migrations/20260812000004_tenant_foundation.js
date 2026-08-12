/**
 * First-class tenant foundation for existing Inventory Intelligence data.
 *
 * This migration is intentionally additive and deterministic: existing IDs
 * remain stable, business data moves to `legacy-default`, and anonymous demo
 * identities/data move to `public-demo`. It is migration code only; running it
 * against a production database remains a protected deployment action.
 */

const LEGACY_TENANT_ID = 'legacy-default';
const DEMO_TENANT_ID = 'public-demo';

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('tenants', (t) => {
    t.string('id', 64).primary();
    t.string('code', 64).notNullable().unique();
    t.string('name', 255).notNullable();
    t.string('status', 20).notNullable().defaultTo('active');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex('tenants').insert([
    { id: LEGACY_TENANT_ID, code: LEGACY_TENANT_ID, name: 'Legacy Default', status: 'active' },
    { id: DEMO_TENANT_ID, code: DEMO_TENANT_ID, name: 'Public Demo', status: 'active' },
  ]);

  await knex.schema.createTable('tenant_memberships', (t) => {
    t.increments('id').primary();
    t.string('tenant_id', 64).notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('role', 40).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.boolean('is_default').notNullable().defaultTo(true);
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'user_id']);
    t.index(['user_id', 'active']);
  });

  const users = await knex('users').select('id', 'role');
  if (users.length > 0) {
    await knex('tenant_memberships').insert(users.map((user) => ({
      tenant_id: user.role === 'guest' ? DEMO_TENANT_ID : LEGACY_TENANT_ID,
      user_id: user.id,
      role: user.role,
      active: true,
      is_default: true,
    })));
  }

  const directTables = ['uploads', 'datasets', 'audit_log', 'ai_logs', 'exports'];
  const datasetTables = ['stock_items', 'movements', 'material_master', 'physical_inventory', 'canonical_transactions'];

  for (const table of [...directTables, ...datasetTables]) {
    if (await knex.schema.hasTable(table)) {
      await knex.schema.alterTable(table, (t) => {
        t.string('tenant_id', 64).nullable().references('id').inTable('tenants');
        t.index(['tenant_id']);
      });
    }
  }

  await knex('uploads').update({
    tenant_id: knex.raw(`CASE WHEN user_id IN (SELECT id FROM users WHERE role = 'guest') THEN ? ELSE ? END`, [DEMO_TENANT_ID, LEGACY_TENANT_ID]),
  });
  await knex('datasets').update({
    tenant_id: knex.raw(`CASE WHEN created_by IN (SELECT id FROM users WHERE role = 'guest') THEN ? ELSE ? END`, [DEMO_TENANT_ID, LEGACY_TENANT_ID]),
  });

  for (const table of datasetTables) {
    if (await knex.schema.hasTable(table)) {
      await knex(table).update({
        tenant_id: knex.raw(`(SELECT tenant_id FROM datasets WHERE datasets.id = ${table}.dataset_id)`),
      });
    }
  }

  for (const table of ['audit_log', 'ai_logs', 'exports']) {
    await knex(table).update({
      tenant_id: knex.raw(`CASE WHEN user_id IN (SELECT id FROM users WHERE role = 'guest') THEN ? ELSE ? END`, [DEMO_TENANT_ID, LEGACY_TENANT_ID]),
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const tables = [
    'canonical_transactions', 'physical_inventory', 'material_master', 'movements',
    'stock_items', 'exports', 'ai_logs', 'audit_log', 'datasets', 'uploads',
  ];
  for (const table of tables) {
    if (await knex.schema.hasColumn(table, 'tenant_id')) {
      await knex.schema.alterTable(table, (t) => t.dropColumn('tenant_id'));
    }
  }
  await knex.schema.dropTableIfExists('tenant_memberships');
  await knex.schema.dropTableIfExists('tenants');
};

exports.LEGACY_TENANT_ID = LEGACY_TENANT_ID;
exports.DEMO_TENANT_ID = DEMO_TENANT_ID;
