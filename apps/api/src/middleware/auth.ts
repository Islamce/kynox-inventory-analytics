import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@kynox/shared-types';
import { config } from '../config';
import { db, insertGetId } from '../db';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn } as jwt.SignOptions,
  );
}

const GUEST_SESSION_HEADER = 'x-guest-session';
const GUEST_SESSION_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function guestEmailFor(sessionId: string): string {
  return `guest-${sessionId.toLowerCase()}@anonymous.local`;
}

/**
 * Resolves the persistent `users` row backing an anonymous demo session,
 * creating it on first sight. A real row (not an in-memory identity) is used
 * so every existing owner-scoped query (`uploads.user_id`, `datasets.created_by`)
 * and the audit trail work for guests with zero additional code — the row
 * just never gets a usable password and is never reachable via /api/auth/login.
 */
async function resolveGuestUser(sessionId: string): Promise<AuthUser> {
  const email = guestEmailFor(sessionId);
  const existing = await db('users').where({ email }).first();
  if (existing) return { id: existing.id, email: existing.email, name: existing.name, role: 'guest' };

  try {
    const id = await insertGetId(db, 'users', {
      email,
      name: 'Guest',
      // Random, never communicated anywhere — this identity is only ever
      // reached via X-Guest-Session, never via POST /api/auth/login.
      password_hash: bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 4),
      role: 'guest',
      active: true,
    });
    return { id, email, name: 'Guest', role: 'guest' };
  } catch {
    // Lost the create race against a concurrent request for the same brand-new
    // session id; the row now exists, so just read it back.
    const row = await db('users').where({ email }).first();
    if (row) return { id: row.id, email: row.email, name: row.name, role: 'guest' };
    throw new Error('Failed to resolve guest identity');
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    if (config.publicDemoMode && !header) {
      const sessionId = req.headers[GUEST_SESSION_HEADER];
      if (typeof sessionId !== 'string' || !GUEST_SESSION_FORMAT.test(sessionId)) {
        res.status(400).json({ error: `Missing or invalid ${GUEST_SESSION_HEADER} header` });
        return;
      }
      resolveGuestUser(sessionId).then((user) => {
        req.user = user;
        next();
      }).catch(() => res.status(500).json({ error: 'Could not start a guest session' }));
      return;
    }
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as jwt.JwtPayload;
    req.user = {
      id: Number(payload.sub),
      email: String(payload.email),
      name: String(payload.name),
      role: payload.role as Role,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const granted = ROLE_PERMISSIONS[user.role] ?? [];
    const missing = permissions.filter((p) => !granted.includes(p));
    if (missing.length > 0) {
      res.status(403).json({ error: `Missing permission: ${missing.join(', ')}` });
      return;
    }
    next();
  };
}
