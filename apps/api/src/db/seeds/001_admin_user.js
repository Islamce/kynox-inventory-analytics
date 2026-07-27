const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Seeds the initial administrator account and default configuration.
 * The admin password comes from ADMIN_INITIAL_PASSWORD; when unset a random
 * one is generated and printed ONCE so no default credential ever ships.
 */

/** @param {import('knex').Knex} knex */
exports.seed = async function seed(knex) {
  const existing = await knex('users').where({ email: process.env.ADMIN_EMAIL || 'admin@kynox.io' }).first();
  if (!existing) {
    const password = process.env.ADMIN_INITIAL_PASSWORD || crypto.randomBytes(12).toString('base64url');
    await knex('users').insert({
      email: process.env.ADMIN_EMAIL || 'admin@kynox.io',
      name: 'System Administrator',
      password_hash: bcrypt.hashSync(password, 12),
      role: 'system_admin',
      active: true,
    });
    if (!process.env.ADMIN_INITIAL_PASSWORD) {
      // eslint-disable-next-line no-console
      console.log(`\n>>> Generated admin password for ${process.env.ADMIN_EMAIL || 'admin@kynox.io'}: ${password}\n>>> Store it now; it will not be shown again.\n`);
    }
  }

  const defaults = {
    currency: 'USD',
    fiscal_year_start_month: 1,
    aging_buckets: [
      { label: '0-30 days', minDays: 0, maxDays: 30 },
      { label: '31-60 days', minDays: 31, maxDays: 60 },
      { label: '61-90 days', minDays: 61, maxDays: 90 },
      { label: '91-180 days', minDays: 91, maxDays: 180 },
      { label: '181-365 days', minDays: 181, maxDays: 365 },
      { label: '> 365 days', minDays: 366, maxDays: null },
    ],
    abc_thresholds: { aThresholdPct: 80, bThresholdPct: 95 },
    xyz_thresholds: { xMaxCov: 0.5, yMaxCov: 1.0, intermittencyThreshold: 0.4, minPeriods: 4 },
    slow_moving_days: 180,
    non_moving_days: 365,
    slow_turnover_threshold: 1,
    coverage_target_days: 90,
    service_level: 0.95,
    forecast_horizon: 6,
    health_weights: {
      availability: 0.25, excess: 0.2, obsolescence: 0.15,
      aging: 0.15, turnover: 0.15, dataQuality: 0.1,
    },
    ai_feature_enabled: true,
  };

  for (const [key, value] of Object.entries(defaults)) {
    const row = await knex('config').where({ key }).first();
    if (!row) {
      await knex('config').insert({ key, value: JSON.stringify(value) });
    }
  }
};
