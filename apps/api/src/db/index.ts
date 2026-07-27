import knex, { Knex } from 'knex';

// knexfile is plain CommonJS so the knex CLI can load it without ts-node.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const knexConfig = require('../../knexfile.js') as Knex.Config;

export const db: Knex = knex(knexConfig);

/**
 * Cross-database insert returning the new primary key.
 * PostgreSQL and SQLite honour `returning` and yield [{ id }]; MySQL ignores
 * it and yields [insertId] — both shapes are normalised here.
 */
export async function insertGetId(
  qb: Knex | Knex.Transaction,
  table: string,
  row: Record<string, unknown>,
): Promise<number> {
  const res = await qb(table).insert(row, ['id']);
  const first = (res as unknown[])[0];
  if (typeof first === 'object' && first !== null) return Number((first as { id: number }).id);
  return Number(first);
}

export async function closeDb(): Promise<void> {
  await db.destroy();
}
