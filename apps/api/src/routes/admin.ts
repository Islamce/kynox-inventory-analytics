import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ALL_ROLES } from '@kynox/shared-types';
import { db, insertGetId } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errors';
import { audit } from '../services/audit';

export const adminRouter = Router();
adminRouter.use(requireAuth);

// ---- Users -----------------------------------------------------------------

adminRouter.get('/users', requirePermission('manage_users'), asyncHandler(async (req, res) => {
  const users = await db('tenant_memberships')
    .join('users', 'tenant_memberships.user_id', 'users.id')
    .where('tenant_memberships.tenant_id', req.user!.tenantId)
    .select('users.id', 'users.email', 'users.name', 'tenant_memberships.role', 'tenant_memberships.active', 'users.created_at')
    .orderBy('users.id');
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
  const id = await db.transaction(async (trx) => {
    const userId = await insertGetId(trx, 'users', {
      email: body.email,
      name: body.name,
      password_hash: bcrypt.hashSync(body.password, 12),
      role: body.role,
      active: true,
    });
    await trx('tenant_memberships').insert({
      tenant_id: req.user!.tenantId,
      user_id: userId,
      role: body.role,
      active: true,
      is_default: true,
    });
    return userId;
  });
  await audit({
    action: 'user_created', userId: req.user!.id, tenantId: req.user!.tenantId, entityType: 'user', entityId: id,
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
  const user = await db('tenant_memberships')
    .join('users', 'tenant_memberships.user_id', 'users.id')
    .where({ 'tenant_memberships.tenant_id': req.user!.tenantId, 'users.id': id })
    .select('users.*', 'tenant_memberships.role as membership_role', 'tenant_memberships.active as membership_active')
    .first();
  if (!user) throw new HttpError(404, 'User not found');
  if (user.id === req.user!.id && body.active === false) {
    throw new HttpError(400, 'You cannot deactivate your own account');
  }
  const update: Record<string, unknown> = {};
  if (body.name) update.name = body.name;
  if (body.password) update.password_hash = bcrypt.hashSync(body.password, 12);
  if (Object.keys(update).length === 0 && body.role === undefined && body.active === undefined) {
    throw new HttpError(400, 'Nothing to update');
  }
  await db.transaction(async (trx) => {
    if (Object.keys(update).length > 0) await trx('users').where({ id }).update(update);
    if (body.role !== undefined || body.active !== undefined) {
      const membershipUpdate: Record<string, unknown> = {};
      if (body.role !== undefined) membershipUpdate.role = body.role;
      if (body.active !== undefined) membershipUpdate.active = body.active;
      await trx('tenant_memberships')
        .where({ tenant_id: req.user!.tenantId, user_id: id })
        .update(membershipUpdate);
    }
  });
  await audit({
    action: body.role && body.role !== user.membership_role ? 'role_changed' : 'user_updated',
    userId: req.user!.id, tenantId: req.user!.tenantId, entityType: 'user', entityId: id,
    prevValue: { role: user.membership_role, active: !!user.membership_active },
    newValue: { role: body.role ?? user.membership_role, active: body.active ?? !!user.membership_active },
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

// Pre-existing gap closed here: this previously had no explicit permission
// check (any authenticated role could read it), which mattered little when
// every caller was a real employee but becomes a real exposure once
// PUBLIC_DEMO_MODE lets anonymous 'guest' identities authenticate at all.
adminRouter.get('/config', requirePermission('change_config'), asyncHandler(async (_req, res) => {
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
    action: 'config_changed', userId: req.user!.id, tenantId: req.user!.tenantId, entityType: 'config', entityId: key,
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
  query = query.where('audit_log.tenant_id', req.user!.tenantId);
  if (action) query = query.where('audit_log.action', action);

  const rows = await query.limit(pageSize).offset((page - 1) * pageSize);
  const [{ count }] = await db('audit_log').where({ tenant_id: req.user!.tenantId }).count({ count: '*' });
  res.json({ entries: rows, page, pageSize, total: Number(count) });
}));
