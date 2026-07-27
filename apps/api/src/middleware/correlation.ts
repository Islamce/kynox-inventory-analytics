import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';

declare module 'express-serve-static-core' {
  interface Request {
    correlationId?: string;
  }
}

/**
 * Attaches a correlation ID to every request (honouring an inbound
 * X-Request-Id if it looks safe), echoes it in the response, and emits a
 * structured completion log line.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers['x-request-id'];
  const id = typeof inbound === 'string' && /^[\w\-]{8,64}$/.test(inbound)
    ? inbound
    : crypto.randomUUID();
  req.correlationId = id;
  res.setHeader('X-Request-Id', id);

  const start = Date.now();
  res.on('finish', () => {
    // Health probes are excluded to keep logs readable.
    if (req.path === '/api/health' || req.path === '/api/readiness') return;
    logger.info({
      correlationId: id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
      userId: req.user?.id ?? null,
    }, 'request');
  });
  next();
}
