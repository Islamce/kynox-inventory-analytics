import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { asyncHandler, HttpError } from '../middleware/errors';
import { audit } from '../services/audit';
import { runCleanup } from '../services/cleanup';
import { logger } from '../logger';

/**
 * External-scheduler maintenance endpoint.
 *
 * Managed hosting (Hostinger) does not guarantee a continuously-running Node
 * process, so retention cleanup cannot rely solely on an in-process timer.
 * This endpoint lets an external scheduler (e.g. a GitHub Actions cron)
 * trigger cleanup over HTTPS. It is:
 *   - token-authenticated (strong MAINTENANCE_TOKEN, constant-time compare),
 *   - disabled entirely when MAINTENANCE_TOKEN is unset,
 *   - rate-limited,
 *   - audited,
 *   - idempotent (deleting already-absent files is a no-op).
 * It never exposes results publicly and requires no user session.
 */
export const maintenanceRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: true, legacyHeaders: false });

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

maintenanceRouter.post('/cleanup', limiter, asyncHandler(async (req, res) => {
  if (!config.maintenanceToken || config.maintenanceToken.length < 16) {
    // Feature disabled unless a strong token is configured.
    throw new HttpError(404, 'Not found');
  }
  const provided = req.get('x-maintenance-token') ?? '';
  if (!timingSafeEqual(provided, config.maintenanceToken)) {
    await audit({ action: 'maintenance_cleanup', result: 'failure', sourceIp: req.ip });
    throw new HttpError(401, 'Invalid maintenance token');
  }
  const result = await runCleanup();
  logger.info({ ...result }, 'External maintenance cleanup executed');
  await audit({ action: 'maintenance_cleanup', result: 'success', newValue: result, sourceIp: req.ip });
  res.json({ ok: true, ...result });
}));
