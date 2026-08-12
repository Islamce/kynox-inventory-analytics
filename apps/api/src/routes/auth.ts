import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { db } from '../db';
import { signToken, requireAuth, resolveUserAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errors';
import { audit } from '../services/audit';

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

export const authRouter = Router();

authRouter.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await db('users').where({ email }).first();

  const fail = async (reason: string) => {
    await audit({ action: 'login_failed', entityType: 'user', entityId: email, sourceIp: req.ip, result: 'failure' });
    throw new HttpError(401, reason);
  };

  if (!user || !user.active) await fail('Invalid credentials');

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await audit({ action: 'login_locked', userId: user.id, sourceIp: req.ip, result: 'failure' });
    throw new HttpError(423, 'Account temporarily locked. Try again later.');
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    const failed = (user.failed_logins ?? 0) + 1;
    const update: Record<string, unknown> = { failed_logins: failed };
    if (failed >= LOCKOUT_THRESHOLD) {
      update.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
      update.failed_logins = 0;
    }
    await db('users').where({ id: user.id }).update(update);
    await fail('Invalid credentials');
  }

  await db('users').where({ id: user.id }).update({ failed_logins: 0, locked_until: null });
  const authUser = await resolveUserAuth({ id: user.id, email: user.email, name: user.name });
  if (!authUser) {
    await fail('No active tenant membership');
    return;
  }
  const token = signToken(authUser);
  await audit({ action: 'login', userId: user.id, tenantId: authUser.tenantId, sourceIp: req.ip });
  res.json({ token, user: authUser });
}));

authRouter.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await audit({ action: 'logout', userId: req.user!.id, tenantId: req.user!.tenantId, sourceIp: req.ip });
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
