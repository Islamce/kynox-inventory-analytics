/**
 * Phase 2 — canonical normalization persistence.
 *
 * Additive and backward compatible:
 *  - New `canonical_transactions` table stores the source-independent
 *    normalized output of the Phase 1 engines, with the exact original row
 *    preserved as JSON for traceability.
 *  - New NULLABLE columns on `datasets` hold dataset-level normalization
 *    metadata (source system, date-format decision, row counts, summary,
 *    findings). Existing datasets and SAP imports are unaffected.
 *
 * Cross-database: uses only portable Knex column types (string/integer/double/
 * date/datetime/boolean/text). JSON is stored in `text` columns exactly like
 * the existing schema (quality_issues, mapping, …).
 */

const DATASET_COLUMNS = [
  ['source_system', (t) => t.string('source_system', 40).nullable()],
  ['source_report_type', (t) => t.string('source_report_type', 40).nullable()],
  ['normalization_status', (t) => t.string('normalization_status', 30).nullable()],
  ['normalization_version', (t) => t.string('normalization_version', 20).nullable()],
  ['import_locale', (t) => t.string('import_locale', 20).nullable()],
  ['detected_date_format', (t) => t.string('detected_date_format', 30).nullable()],
  ['selected_date_format', (t) => t.string('selected_date_format', 30).nullable()],
  ['date_format_confidence', (t) => t.double('date_format_confidence').nullable()],
  ['date_format_user_confirmed', (t) => t.boolean('date_format_user_confirmed').nullable()],
  ['total_source_rows', (t) => t.integer('total_source_rows').nullable()],
  ['normalized_rows', (t) => t.integer('normalized_rows').nullable()],
  ['rejected_rows', (t) => t.integer('rejected_rows').nullable()],
  ['warning_rows', (t) => t.integer('warning_rows').nullable()],
  ['unknown_transaction_rows', (t) => t.integer('unknown_transaction_rows').nullable()],
  ['normalization_summary', (t) => t.text('normalization_summary').nullable()],
  ['normalization_findings', (t) => t.text('normalization_findings').nullable()],
];

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('canonical_transactions', (t) => {
    t.increments('id').primary();
    t.integer('dataset_id').unsigned().notNullable().references('id').inTable('datasets').onDelete('CASCADE');
    t.string('organization_id', 80).nullable();
    t.integer('source_row_number').nullable();
    t.string('transaction_id', 120).nullable();
    t.string('reference_document', 120).nullable();
    t.string('reference_line', 40).nullable();

    t.string('material_id', 80).notNullable();
    t.string('material_description', 255).nullable();
    t.string('material_group', 80).nullable();
    t.string('material_type', 40).nullable();
    t.string('batch_number', 40).nullable();

    t.string('warehouse_id', 40).nullable();
    t.string('warehouse_name', 120).nullable();
    t.string('location_id', 40).nullable();
    t.string('location_name', 120).nullable();
    t.string('plant_id', 40).nullable();
    t.string('site_id', 40).nullable();
    t.string('business_unit', 80).nullable();

    t.date('transaction_date').nullable();
    t.date('posting_date').nullable();
    t.date('document_date').nullable();

    t.string('raw_quantity', 60).nullable();          // preserved as text
    t.double('parsed_quantity').nullable();
    t.double('absolute_quantity').nullable();
    t.double('signed_quantity').nullable();
    t.double('receipt_quantity').nullable();
    t.double('consumption_quantity').nullable();
    t.string('unit_of_measure', 20).nullable();

    t.string('transaction_direction', 12).nullable(); // IN|OUT|NEUTRAL|UNKNOWN
    t.string('transaction_category', 24).nullable();
    t.string('transaction_type_code', 40).nullable();
    t.string('transaction_type_description', 255).nullable();

    t.double('unit_cost').nullable();
    t.double('transaction_value').nullable();
    t.string('currency', 10).nullable();
    t.double('opening_quantity').nullable();
    t.double('closing_quantity').nullable();

    t.string('classification_source', 40).nullable();
    t.double('classification_confidence').nullable();
    t.integer('original_sign').nullable();
    t.integer('normalized_sign').nullable();
    t.boolean('sign_conflict').notNullable().defaultTo(false);
    t.boolean('direction_conflict').notNullable().defaultTo(false);

    t.string('transfer_id', 80).nullable();
    t.string('paired_transaction_id', 80).nullable();
    t.string('reversal_of_transaction_id', 80).nullable();

    t.text('normalization_warnings').nullable();       // JSON string[]
    t.text('original_source_record').nullable();       // JSON of the source row
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());

    t.index(['dataset_id']);
    t.index(['dataset_id', 'material_id']);
    t.index(['dataset_id', 'transaction_date']);
    t.index(['dataset_id', 'transaction_category']);
    t.index(['dataset_id', 'transaction_direction']);
    t.index(['dataset_id', 'source_row_number']);
  });

  await knex.schema.alterTable('datasets', (t) => {
    for (const [, build] of DATASET_COLUMNS) build(t);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('canonical_transactions');
  await knex.schema.alterTable('datasets', (t) => {
    for (const [name] of DATASET_COLUMNS) t.dropColumn(name);
  });
};
