/**
 * PM2 process configuration for the Kynox Supply Chain Intelligence platform.
 *
 * One Node process serves both the API and the built SPA (as designed).
 * No secrets live in this file — everything sensitive comes from the shared
 * .env file loaded by the application itself (dotenv), so the same config
 * works for staging and production by pointing DEPLOY_ROOT elsewhere.
 *
 * Usage (staging):
 *   DEPLOY_ROOT=/home/<user>/domains/staging-analytics.kynox.io \
 *     pm2 start ecosystem.config.cjs --only kynox-analytics-staging
 */

const path = require('path');

// Resolved at pm2 start time; defaults keep local rehearsals working.
const DEPLOY_ROOT = process.env.DEPLOY_ROOT || path.resolve(__dirname, '..');
const SHARED = path.join(DEPLOY_ROOT, 'shared');

module.exports = {
  apps: [
    {
      name: 'kynox-analytics-staging',
      cwd: path.join(DEPLOY_ROOT, 'current'),
      script: 'apps/api/dist/server.js',

      // Single instance: the app keeps in-process state only for cleanup
      // timers, but clustering has not been load-tested — do not enable
      // cluster mode without proving upload handling under it.
      instances: 1,
      exec_mode: 'fork',

      // Restart policy
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,
      max_memory_restart: '512M',

      // Graceful shutdown: SIGINT, then 15s before SIGKILL — matches the
      // app's own 10s shutdown guard.
      kill_timeout: 15000,

      // Timestamped logs in the shared logs directory (survives releases).
      time: true,
      out_file: path.join(SHARED, 'logs', 'app.out.log'),
      error_file: path.join(SHARED, 'logs', 'app.err.log'),
      merge_logs: true,

      env: {
        NODE_ENV: 'production',
        // Everything else (ports, DB, JWT, AI) comes from shared/.env via dotenv.
      },
    },
  ],
};
