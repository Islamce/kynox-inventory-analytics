import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ALL_ROLES } from '@kynox/shared-types';
import { db } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errors';
import { audit } from '../services/audit';

export const adminRouter = Router();
adminRouter.use(requireAuth);

// ---- Users -----------------------------------------------------------------

adminRouter.get('/users', requirePermission('manage_users'), asyncHandler(async (_req, res) => {
  const users = await db('users').select('id', 'email', 'name', 'role', 'active', 'created_at').orderBy('id');
  res.json({ users });
}));

const createUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(255),
  password: z.string().min(10).max(200),
  role: z.enum(ALL_ROLES as [string, ...string[]]),
});

adminRouter.post('/users', requirePermission('manage_users'), asyncHandler(async (req, res) => {
  const body = createUserSchema.parse(req.body);
  const exists = await db('users').where({ email: body.email }).first();
  if (exists) throw new HttpError(409, 'A user with this email already exists');
  const [id] = await db('users').insert({
    email: body.email,
    name: body.name,
    password_hash: bcrypt.hashSync(body.password, 12),
    role: body.role,
    active: true,
  });
  await audit({
    action: 'user_created', userId: req.user!.id, entityType: 'user', entityId: id,
    newValue: { email: body.email, role: body.role }, sourceIp: req.ip,
  });
  res.status(201).json({ id });
}));

const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  role: z.enum(ALL_ROLES as [string, ...string[]]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(10).max(200).optional(),
});

adminRouter.patch('/users/:id', requirePermission('manage_users'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const body = updateUserSchema.parse(req.body);
  const user = await db('users').where({ id }).first();
  if (!user) throw new HttpError(404, 'User not found');
  if (user.id === req.user!.id && body.active === false) {
    throw new HttpError(400, 'You cannot deactivate your own account');
  }
  const update: Record<string, unknown> = {};
  if (body.name) update.name = body.name;
  if (body.role) update.role = body.role;
  if (body.active !== undefined) update.active = body.active;
  if (body.password) update.password_hash = bcrypt.hashSync(body.password, 12);
  if (Object.keys(update).length === 0) throw new HttpError(400, 'Nothing to update');
  await db('users').where({ id }).update(update);
  await audit({
    action: body.role && body.role !== user.role ? 'role_changed' : 'user_updated',
    userId: req.user!.id, entityType: 'user', entityId: id,
    prevValue: { role: user.role, active: !!user.active },
    newValue: { role: body.role ?? user.role, active: body.active ?? !!user.active },
    sourceIp: req.ip,
  });
  res.json({ ok: true });
}));

// ---- Configuration ---------------------------------------------------------

const KNOWN_CONFIG_KEYS = [
  'currency', 'fiscal_year_start_month', 'aging_buckets', 'abc_thresholds',
  'xyz_thresholds', 'slow_moving_days', 'non_moving_days', 'slow_turnover_threshold',
  'coverage_target_days', 'service_level', 'forecast_horizon', 'health_weights',
  'ai_feature_enabled',
] as const;

adminRouter.get('/config', asyncHandler(async (_req, res) => {
  const rows = await db('config').select('key', 'value', 'updated_at');
  const configMap: Record<string, unknown> = {};
  for (const row of rows) configMap[row.key] = JSON.parse(row.value);
  res.json({ config: configMap });
}));

adminRouter.put('/config/:key', requirePermission('change_config'), asyncHandler(async (req, res) => {
  const key = req.params.key;
  if (!KNOWN_CONFIG_KEYS.includes(key as never)) throw new HttpError(400, `Unknown configuration key '${key}'`);
  const value = req.body?.value;
  if (value === undefined) throw new HttpError(400, 'Body must contain { value }');
  const prev = await db('config').where({ key }).first();
  const serialized = JSON.stringify(value);
  if (prev) {
    await db('config').where({ key }).update({ value: serialized, updated_by: req.user!.id, updated_at: db.fn.now() });
  } else {
    await db('config').insert({ key, value: serialized, updated_by: req.user!.id });
  }
  await audit({
    action: 'config_changed', userId: req.user!.id, entityType: 'config', entityId: key,
    prevValue: prev ? JSON.parse(prev.value) : null, newValue: value, sourceIp: req.ip,
  });
  res.json({ ok: true });
}));

// ---- Audit log -------------------------------------------------------------

adminRouter.get('/audit', requirePermission('view_audit'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;

  let query = db('audit_log')
    .leftJoin('users', 'audit_log.user_id', 'users.id')
    .select('audit_log.*', 'users.email as user_email')
    .orderBy('audit_log.id', 'desc');
  if (action) query = query.where('audit_log.action', action);

  const rows = await query.limit(pageSize).offset((page - 1) * pageSize);
  const [{ count }] = await db('audit_log').count({ count: '*' });
  res.json({ entries: rows, page, pageSize, total: Number(count) });
}));
