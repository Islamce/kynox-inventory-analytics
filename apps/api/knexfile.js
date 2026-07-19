/**
 * Knex configuration. The database client is selected purely by environment
 * variables so the same code runs on SQLite (local dev), MySQL (Hostinger
 * shared) or PostgreSQL (preferred, Hostinger VPS).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true });

const path = require('path');

const client = process.env.DB_CLIENT || 'better-sqlite3';

const connections = {
  'better-sqlite3': {
    client: 'better-sqlite3',
    connection: {
      filename: process.env.DB_FILE || path.resolve(__dirname, '../../database/kynox.sqlite'),
    },
    useNullAsDefault: true,
  },
  pg: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    },
    pool: { min: 2, max: 10 },
  },
  mysql2: {
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    },
    pool: { min: 2, max: 10 },
  },
};

const base = connections[client];
if (!base) {
  throw new Error(`Unsupported DB_CLIENT '${client}'. Use better-sqlite3, pg or mysql2.`);
}

module.exports = {
  ...base,
  migrations: {
    directory: path.resolve(__dirname, 'src/db/migrations'),
    loadExtensions: ['.js', '.cjs', '.ts'],
  },
  seeds: {
    directory: path.resolve(__dirname, 'src/db/seeds'),
    loadExtensions: ['.js', '.cjs', '.ts'],
  },
};
