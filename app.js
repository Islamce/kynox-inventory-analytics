/**
 * Hostinger Managed Node.js Web App entry point.
 *
 * Hostinger launches ONE Node process from this root file. It simply loads the
 * compiled Express API server, which also serves the built React SPA and the
 * SPA fallback routes (single-process architecture — no separate frontend
 * process, no PM2, no clustering).
 *
 * The server reads its port from process.env.PORT (assigned by Hostinger),
 * performs production startup validation, and connects to MySQL via the
 * environment variables configured in hPanel. Migrations and seeds are NOT run
 * here — they are separate, controlled commands (see docs/HOSTINGER_MIGRATION_AND_SEED.md).
 */
'use strict';

const path = require('path');
const fs = require('fs');

const compiledServer = path.join(__dirname, 'apps', 'api', 'dist', 'server.js');

if (!fs.existsSync(compiledServer)) {
  // Fail loudly and clearly (no secrets) so the hPanel deployment log is actionable.
  // eslint-disable-next-line no-console
  console.error(
    '[startup] Compiled server not found at apps/api/dist/server.js. ' +
    'The build step must run "npm run build" before start. ' +
    'Check the Hostinger build command and deployment logs.',
  );
  process.exit(1);
}

// Delegates to apps/api/dist/server.js, which calls app.listen(process.env.PORT).
require(compiledServer);
