import type { Request, Response, NextFunction } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { db } from '../db';
import { asyncHandler, HttpError } from './errors';

/**
 * Object-level access control for the anonymous 'guest' role (PUBLIC_DEMO_MODE).
 *
 * Every other role shares one org-wide view of `datasets` by design (this is
 * an internal enterprise tool, not multi-tenant) — but a guest must only ever
 * see datasets it created itself, never any real business data or another
 * visitor's demo upload.
 *
 * Two complementary checks, because a plain `router.use()` middleware runs
 * BEFORE Express has matched a specific route and populated `req.params` —
 * a blanket `.use()` alone cannot see `:id`/`:stockDatasetId`/etc:
 *  - `guardGuestDatasetParam`, registered per param name via `router.param()`,
 *    which Express *does* invoke once that param is parsed for a matched
 *    route — covers every `:id`/`:stockDatasetId`/`:movementsDatasetId`/
 *    `:datasetId` path segment with zero per-route wiring.
 *  - `guardGuestDatasetQueryParams`, a normal `.use()` middleware, for the
 *    secondary dataset ids several analytics routes accept as a query string
 *    (`?movementsDatasetId=`) — query parsing does not depend on route
 *    matching, so this one is safe to run as a blanket `.use()`.
 * Neither ever fires for non-guest roles.
 */
async function checkGuestOwnsDataset(req: Request, id: number): Promise<void> {
  const row = await db('datasets').where({ id }).first('created_by');
  if (!row || row.created_by !== req.user!.id) {
    throw new HttpError(403, 'Guests can only access datasets created in their own demo session');
  }
}

export function guardGuestDatasetParam(req: Request, _res: Response, next: NextFunction, value: string): void {
  if (req.user?.role !== 'guest') { next(); return; }
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) { next(); return; } // malformed id: let the route's own validation reject it
  checkGuestOwnsDataset(req, id).then(() => next()).catch(next);
}

export const guardGuestDatasetQueryParams = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  if (req.user?.role !== 'guest') { next(); return; }
  const ids = new Set<number>();
  for (const [key, value] of Object.entries(req.query as Record<string, unknown>)) {
    if (!/datasetid$/i.test(key)) continue;
    const n = Number(value);
    if (Number.isInteger(n) && n > 0) ids.add(n);
  }
  for (const id of ids) await checkGuestOwnsDataset(req, id);
  next();
});

/**
 * Rate-limits a specific write action (upload, dataset creation) for guests
 * only — authenticated users are unaffected. Bounds storage/compute abuse on
 * a public, signup-free endpoint independent of how many guest sessions one
 * visitor spins up, since it keys on IP rather than the guest session id.
 *
 * Single-process in-memory store: adequate for one API instance. A
 * multi-instance deployment would need a shared store (e.g. Redis) for this
 * to hold across instances — documented as a scale-up follow-up, not a
 * silent gap, since a single instance is the documented Hostinger topology.
 */
export function guestActionLimiter(limit: number, windowMs: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
    skip: (req) => req.user?.role !== 'guest',
    message: { error: 'Demo usage limit reached for this session — please try again later.' },
  });
}
