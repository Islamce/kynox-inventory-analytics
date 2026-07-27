import express from 'express';
import path from 'path';
import fs from 'fs';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { db } from './db';
import { errorHandler } from './middleware/errors';
import { correlationMiddleware } from './middleware/correlation';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { uploadsRouter } from './routes/uploads';
import { datasetsRouter } from './routes/datasets';
import { analyticsRouter } from './routes/analytics';
import { aiRouter } from './routes/ai';
import { exportsRouter } from './routes/exports';
import { maintenanceRouter } from './routes/maintenance';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Hostinger/LiteSpeed reverse proxy

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin.split(','), credentials: false }));
  app.use(express.json({ limit: '2mb' }));
  app.use(correlationMiddleware);

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', apiLimiter);

  // Health endpoints expose no sensitive information.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/api/version', (_req, res) => {
    // Release SHA is injected at deploy time (RELEASE_SHA); environment name is
    // APP_ENV. Neither exposes secrets or internal paths.
    res.json({
      name: 'kynox-supply-chain-intelligence',
      version: config.version,
      releaseSha: process.env.RELEASE_SHA || null,
      environment: process.env.APP_ENV || config.env,
    });
  });
  app.get('/api/readiness', async (_req, res) => {
    try {
      await db.raw('select 1');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not-ready' });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api/datasets', datasetsRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/exports', exportsRouter);
  app.use('/api/maintenance', maintenanceRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // In production the API serves the built frontend so a single Node process
  // runs the whole application behind the Hostinger reverse proxy.
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
