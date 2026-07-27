/** Initial schema for the Kynox Supply Chain Intelligence platform. */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('email', 255).notNullable().unique();
    t.string('name', 255).notNullable();
    t.string('password_hash', 255).notNullable();
    t.string('role', 40).notNullable().defaultTo('read_only');
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('failed_logins').notNullable().defaultTo(0);
    t.datetime('locked_until').nullable();
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('audit_log', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().nullable().references('id').inTable('users');
    t.string('action', 80).notNullable();
    t.string('entity_type', 80).nullable();
    t.string('entity_id', 80).nullable();
    t.text('prev_value').nullable();
    t.text('new_value').nullable();
    t.string('source_ip', 64).nullable();
    t.string('result', 20).notNullable().defaultTo('success');
    t.string('correlation_id', 64).nullable();
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['action', 'created_at']);
    t.index(['user_id']);
  });

  await knex.schema.createTable('uploads', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users');
    t.string('stored_name', 255).notNullable();
    t.string('original_name', 255).notNullable();
    t.integer('size_bytes').notNullable();
    t.string('mime', 128).notNullable();
    t.text('sheet_names').nullable();           // JSON array
    t.string('source_system', 80).nullable();
    t.string('status', 30).notNullable().defaultTo('uploaded'); // uploaded|detected|mapped|failed
    t.string('detected_type', 40).nullable();
    t.text('detection').nullable();             // JSON ReportDetectionResult
    t.text('mapping').nullable();               // JSON ColumnMapping[]
    t.text('headers').nullable();               // JSON string[]
    t.string('sheet', 128).nullable();
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('datasets', (t) => {
    t.increments('id').primary();
    t.string('name', 255).notNullable();
    t.integer('version').notNullable().defaultTo(1);
    t.string('kind', 30).notNullable();         // stock|movements|material_master|physical_inventory
    t.string('status', 20).notNullable().defaultTo('draft'); // draft|validated|ready
    t.date('period_start').nullable();
    t.date('period_end').nullable();
    t.text('source_upload_ids').nullable();     // JSON number[]
    t.text('mapping').nullable();               // JSON applied mapping
    t.text('cleansing_log').nullable();         // JSON string[]
    t.text('approved_actions').nullable();      // JSON CleansingAction[]
    t.text('quality_issues').nullable();        // JSON QualityIssue[]
    t.text('quality_scores').nullable();        // JSON QualityScores
    t.integer('row_count').notNullable().defaultTo(0);
    t.string('company', 120).nullable();
    t.string('plant_tag', 120).nullable();
    t.integer('created_by').unsigned().notNullable().references('id').inTable('users');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['kind', 'status']);
  });

  await knex.schema.createTable('stock_items', (t) => {
    t.increments('id').primary();
    t.integer('dataset_id').unsigned().notNullable().references('id').inTable('datasets').onDelete('CASCADE');
    t.string('material', 80).notNullable();
    t.string('material_description', 255).nullable();
    t.string('material_type', 40).nullable();
    t.string('material_group', 80).nullable();
    t.string('base_unit', 20).nullable();
    t.string('plant', 40).nullable();
    t.string('storage_location', 40).nullable();
    t.string('warehouse', 40).nullable();
    t.string('batch', 40).nullable();
    t.string('valuation_class', 40).nullable();
    t.string('currency', 10).nullable();
    t.double('quantity').notNullable().defaultTo(0);
    t.double('value').notNullable().defaultTo(0);
    t.double('unrestricted_qty').nullable();
    t.double('blocked_qty').nullable();
    t.double('quality_qty').nullable();
    t.double('in_transit_qty').nullable();
    t.double('reserved_qty').nullable();
    t.double('safety_stock').nullable();
    t.double('reorder_point').nullable();
    t.double('min_stock').nullable();
    t.double('max_stock').nullable();
    t.double('lead_time_days').nullable();
    t.double('standard_price').nullable();
    t.double('moving_avg_price').nullable();
    t.date('last_receipt_date').nullable();
    t.date('last_issue_date').nullable();
    t.date('last_movement_date').nullable();
    t.index(['dataset_id', 'material']);
    t.index(['dataset_id', 'plant']);
  });

  await knex.schema.createTable('movements', (t) => {
    t.increments('id').primary();
    t.integer('dataset_id').unsigned().notNullable().references('id').inTable('datasets').onDelete('CASCADE');
    t.string('material', 80).notNullable();
    t.string('material_description', 255).nullable();
    t.string('plant', 40).nullable();
    t.string('storage_location', 40).nullable();
    t.string('movement_type', 10).nullable();
    t.double('movement_qty').notNullable().defaultTo(0);
    t.double('movement_value').nullable();
    t.date('posting_date').notNullable();
    t.string('document_number', 40).nullable();
    t.string('cost_center', 40).nullable();
    t.string('vendor', 60).nullable();
    t.string('customer', 60).nullable();
    t.string('requester', 80).nullable();
    t.string('purchase_order', 40).nullable();
    t.string('reservation', 40).nullable();
    t.string('batch', 40).nullable();
    t.index(['dataset_id', 'material']);
    t.index(['dataset_id', 'posting_date']);
    t.index(['dataset_id', 'movement_type']);
  });

  await knex.schema.createTable('material_master', (t) => {
    t.increments('id').primary();
    t.integer('dataset_id').unsigned().notNullable().references('id').inTable('datasets').onDelete('CASCADE');
    t.string('material', 80).notNullable();
    t.string('material_description', 255).nullable();
    t.string('material_type', 40).nullable();
    t.string('material_group', 80).nullable();
    t.string('base_unit', 20).nullable();
    t.string('plant', 40).nullable();
    t.double('standard_price').nullable();
    t.double('moving_avg_price').nullable();
    t.string('currency', 10).nullable();
    t.double('safety_stock').nullable();
    t.double('reorder_point').nullable();
    t.double('min_stock').nullable();
    t.double('max_stock').nullable();
    t.double('lead_time_days').nullable();
    t.string('mrp_controller', 20).nullable();
    t.string('valuation_class', 40).nullable();
    t.index(['dataset_id', 'material']);
  });

  await knex.schema.createTable('physical_inventory', (t) => {
    t.increments('id').primary();
    t.integer('dataset_id').unsigned().notNullable().references('id').inTable('datasets').onDelete('CASCADE');
    t.string('material', 80).notNullable();
    t.string('plant', 40).nullable();
    t.string('storage_location', 40).nullable();
    t.string('batch', 40).nullable();
    t.double('book_qty').notNullable().defaultTo(0);
    t.double('counted_qty').notNullable().defaultTo(0);
    t.double('count_difference').nullable();
    t.double('value').nullable();
    t.date('posting_date').nullable();
    t.string('document_number', 40).nullable();
    t.string('requester', 80).nullable();
    t.index(['dataset_id', 'material']);
  });

  await knex.schema.createTable('config', (t) => {
    t.string('key', 80).primary();
    t.text('value').notNullable();               // JSON
    t.integer('updated_by').unsigned().nullable().references('id').inTable('users');
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('ai_logs', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users');
    t.integer('dataset_id').unsigned().nullable().references('id').inTable('datasets');
    t.text('question').notNullable();
    t.string('provider', 30).nullable();
    t.string('model', 80).nullable();
    t.boolean('governance_passed').nullable();
    t.integer('insight_count').nullable();
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('exports', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users');
    t.integer('dataset_id').unsigned().nullable().references('id').inTable('datasets');
    t.string('export_type', 40).notNullable();
    t.string('filename', 255).notNullable();
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  for (const table of [
    'exports', 'ai_logs', 'config', 'physical_inventory', 'material_master',
    'movements', 'stock_items', 'datasets', 'uploads', 'audit_log', 'users',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
};
