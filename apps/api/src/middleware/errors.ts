import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AiNotConfiguredError } from '@kynox/ai-engine';
import { logger } from '../logger';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Central error handler. Internal details (stack traces, driver errors,
 * file paths) are logged server-side and never sent to the client.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof AiNotConfiguredError) {
    res.status(503).json({ error: err.message });
    return;
  }
  logger.error({ err, path: req.path }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
}

/** Wraps async route handlers so rejections reach the error handler. */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req as T, res, next).catch(next);
  };
}
