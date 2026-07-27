import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@kynox/shared-types';
import { config } from '../config';

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

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
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
