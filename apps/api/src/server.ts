import { createApp } from './app';
import { config, validateProductionConfig } from './config';
import { logger } from './logger';
import { closeDb } from './db';
import { startCleanupSchedule } from './services/cleanup';

// Refuse to start in production with missing/unsafe critical configuration.
const configProblems = validateProductionConfig();
if (configProblems.length > 0) {
  for (const p of configProblems) logger.fatal({ problem: p }, 'Startup validation failed');
  // eslint-disable-next-line no-console
  console.error('Refusing to start. Fix the environment problems above and restart.');
  process.exit(1);
}

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'Kynox Supply Chain Intelligence API started');
});

// Best-effort in-process retention timer. On managed hosting where the process
// may not stay alive, disable it (ENABLE_INPROCESS_CLEANUP=false) and drive
// cleanup from an external scheduler via POST /api/maintenance/cleanup.
if (config.enableInProcessCleanup) {
  startCleanupSchedule();
} else {
  logger.info('In-process cleanup timer disabled; use POST /api/maintenance/cleanup from an external scheduler');
}

// Process-level safety nets: log with full context, then exit so the process
// manager restarts a clean instance (state after an unknown error is untrusted).
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await closeDb();          // drains the Knex connection pool
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
