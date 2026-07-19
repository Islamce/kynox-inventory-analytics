import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { db } from './db';
import { errorHandler } from './middleware/errors';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { uploadsRouter } from './routes/uploads';
import { datasetsRouter } from './routes/datasets';
import { analyticsRouter } from './routes/analytics';
import { aiRouter } from './routes/ai';
import { exportsRouter } from './routes/exports';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Hostinger/LiteSpeed reverse proxy

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin.split(','), credentials: false }));
  app.use(express.json({ limit: '2mb' }));

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
    res.json({ name: 'kynox-supply-chain-intelligence', version: config.version });
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

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}
