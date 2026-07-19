import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';
import { closeDb } from './db';

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'Kynox Supply Chain Intelligence API started');
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
