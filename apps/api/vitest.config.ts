import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The integration suites share one database when DB_CLIENT points at a
    // real server (Postgres/MySQL in CI), so test files must run sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
