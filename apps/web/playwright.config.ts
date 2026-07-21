import { defineConfig } from '@playwright/test';

/**
 * Playwright smoke configuration. Runs against an already-running instance
 * (CI builds, seeds and starts `node app.js`, then sets E2E_BASE_URL). Two
 * projects exercise desktop and mobile viewports — the mobile project is what
 * catches horizontal-overflow regressions.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4100',
    headless: true,
    trace: 'off',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
});
