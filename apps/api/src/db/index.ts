import knex, { Knex } from 'knex';

// knexfile is plain CommonJS so the knex CLI can load it without ts-node.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const knexConfig = require('../../knexfile.js') as Knex.Config;

export const db: Knex = knex(knexConfig);

export async function closeDb(): Promise<void> {
  await db.destroy();
}
