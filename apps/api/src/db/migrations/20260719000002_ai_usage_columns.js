/** Adds provider-reported token usage to AI logs (cost monitoring / limits). */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable('ai_logs', (t) => {
    t.integer('input_tokens').nullable();
    t.integer('output_tokens').nullable();
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('ai_logs', (t) => {
    t.dropColumn('input_tokens');
    t.dropColumn('output_tokens');
  });
};
