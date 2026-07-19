import { Router } from 'express';
import path from 'path';
import { z } from 'zod';
import { db } from '../db';
import { config } from '../config';
import { requireAuth, requirePermission } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errors';
import { audit } from '../services/audit';
import { parseWorkbook } from '../services/files';
import { applyMapping } from '../services/mapping';
import { kindForReportType } from '../services/detection';
import {
  runQualityRules, computeQualityScores, proposeCleansing, applyCleansing,
  parseNumber, parseDate, normalizeText,
} from '@kynox/data-quality';
import type { MappedRow } from '@kynox/data-quality';
import type { ColumnMapping } from '@kynox/shared-types';

export const datasetsRouter = Router();
datasetsRouter.use(requireAuth);

const num = (v: unknown): number | null => parseNumber(v).value;
const dt = (v: unknown): string | null => parseDate(v).value;
const txt = (v: unknown): string | null => {
  const t = normalizeText(v);
  return t === '' ? null : t.slice(0, 255);
};

/** Maps a cleansed canonical row into the columns of the target table. */
function toTableRow(kind: string, datasetId: number, r: MappedRow): Record<string, unknown> {
  const base = {
    dataset_id: datasetId,
    material: txt(r.material) ?? '',
  };
  switch (kind) {
    case 'stock':
      return {
        ...base,
        material_description: txt(r.material_description),
        material_type: txt(r.material_type),
        material_group: txt(r.material_group),
        base_unit: txt(r.base_unit),
        plant: txt(r.plant),
        storage_location: txt(r.storage_location),
        warehouse: txt(r.warehouse),
        batch: txt(r.batch),
        valuation_class: txt(r.valuation_class),
        currency: txt(r.currency),
        quantity: num(r.quantity) ?? num(r.unrestricted_qty) ?? 0,
        value: num(r.value) ?? 0,
        unrestricted_qty: num(r.unrestricted_qty),
        blocked_qty: num(r.blocked_qty),
        quality_qty: num(r.quality_qty),
        in_transit_qty: num(r.in_transit_qty),
        reserved_qty: num(r.reserved_qty),
        safety_stock: num(r.safety_stock),
        reorder_point: num(r.reorder_point),
        min_stock: num(r.min_stock),
        max_stock: num(r.max_stock),
        lead_time_days: num(r.lead_time_days),
        standard_price: num(r.standard_price),
        moving_avg_price: num(r.moving_avg_price),
        last_receipt_date: dt(r.last_receipt_date),
        last_issue_date: dt(r.last_issue_date),
        last_movement_date: dt(r.last_movement_date),
      };
    case 'movements':
      return {
        ...base,
        material_description: txt(r.material_description),
        plant: txt(r.plant),
        storage_location: txt(r.storage_location),
        movement_type: txt(r.movement_type)?.slice(0, 10) ?? null,
        movement_qty: num(r.movement_qty) ?? num(r.consumption_qty) ?? num(r.demand_qty) ?? num(r.quantity) ?? 0,
        movement_value: num(r.movement_value),
        posting_date: dt(r.posting_date) ?? dt(r.document_date),
        document_number: txt(r.document_number),
        cost_center: txt(r.cost_center),
        vendor: txt(r.vendor),
        customer: txt(r.customer),
        requester: txt(r.requester),
        purchase_order: txt(r.purchase_order),
        reservation: txt(r.reservation),
        batch: txt(r.batch),
      };
    case 'material_master':
      return {
        ...base,
        material_description: txt(r.material_description),
        material_type: txt(r.material_type),
        material_group: txt(r.material_group),
        base_unit: txt(r.base_unit),
        plant: txt(r.plant),
        standard_price: num(r.standard_price),
        moving_avg_price: num(r.moving_avg_price),
        currency: txt(r.currency),
        safety_stock: num(r.safety_stock),
        reorder_point: num(r.reorder_point),
        min_stock: num(r.min_stock),
        max_stock: num(r.max_stock),
        lead_time_days: num(r.lead_time_days),
        mrp_controller: txt(r.mrp_controller),
        valuation_class: txt(r.valuation_class),
      };
    case 'physical_inventory':
      return {
        ...base,
        plant: txt(r.plant),
        storage_location: txt(r.storage_location),
        batch: txt(r.batch),
        book_qty: num(r.book_qty) ?? 0,
        counted_qty: num(r.counted_qty) ?? 0,
        count_difference: num(r.count_difference),
        value: num(r.value),
        posting_date: dt(r.posting_date),
        document_number: txt(r.document_number),
        requester: txt(r.requester),
      };
    default:
      throw new HttpError(400, `Unsupported dataset kind '${kind}'`);
  }
}

const TABLE_FOR_KIND: Record<string, string> = {
  stock: 'stock_items',
  movements: 'movements',
  material_master: 'material_master',
  physical_inventory: 'physical_inventory',
};

// ---- Step 7: create versioned dataset from an upload ------------------------

const createSchema = z.object({
  uploadId: z.number().int().positive(),
  name: z.string().min(1).max(255),
  approvedActionIds: z.array(z.string()).default([]),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  company: z.string().max(120).optional(),
  plantTag: z.string().max(120).optional(),
});

datasetsRouter.post('/', requirePermission('approve_cleansing'), asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  const uploadRow = await db('uploads').where({ id: body.uploadId }).first();
  if (!uploadRow) throw new HttpError(404, 'Upload not found');

  const sheets = parseWorkbook(path.join(config.uploadDir, uploadRow.stored_name));
  const sheet = sheets.find((s) => s.name === uploadRow.sheet) ?? sheets[0];
  const mapping: ColumnMapping[] = JSON.parse(uploadRow.mapping ?? '[]');
  const kind = kindForReportType(uploadRow.detected_type ?? 'UNKNOWN');

  if (!mapping.some((m) => m.canonicalField === 'material')) {
    throw new HttpError(400, 'The mapping must include a material column before a dataset can be created.');
  }

  const mapped = applyMapping(sheet.rows, mapping) as MappedRow[];
  const issues = runQualityRules(kind, mapped);
  const proposals = proposeCleansing(kind, mapped, issues);
  const approved = proposals.filter((p) => body.approvedActionIds.includes(p.id));
  const { rows: cleaned, log, excludedRows } = applyCleansing(mapped, approved);

  // Critical issues block finalisation unless the cleansing excluded the affected rows.
  const postIssues = runQualityRules(kind, cleaned);
  const remainingCritical = postIssues.filter((i) => i.severity === 'critical');
  if (remainingCritical.length > 0) {
    throw new HttpError(422,
      `Critical data issues remain after cleansing: ${remainingCritical.map((i) => i.title).join('; ')}. `
      + 'Approve the exclusion actions or fix the source file.');
  }
  const scores = computeQualityScores(kind, cleaned, postIssues);

  // Versioning: next version for datasets with the same name.
  const prev = await db('datasets').where({ name: body.name }).orderBy('version', 'desc').first();
  const version = prev ? prev.version + 1 : 1;

  const datasetId = await db.transaction(async (trx) => {
    const [id] = await trx('datasets').insert({
      name: body.name,
      version,
      kind,
      status: 'ready',
      period_start: body.periodStart ?? null,
      period_end: body.periodEnd ?? null,
      source_upload_ids: JSON.stringify([uploadRow.id]),
      mapping: JSON.stringify(mapping),
      cleansing_log: JSON.stringify(log),
      approved_actions: JSON.stringify(approved),
      quality_issues: JSON.stringify(postIssues),
      quality_scores: JSON.stringify(scores),
      row_count: cleaned.length,
      company: body.company ?? null,
      plant_tag: body.plantTag ?? null,
      created_by: req.user!.id,
    });

    const table = TABLE_FOR_KIND[kind];
    const tableRows = cleaned.map((r) => toTableRow(kind, id, r))
      .filter((r) => r.material !== '')
      // movements require a posting date; rows without one cannot join time-based analyses
      .filter((r) => kind !== 'movements' || r.posting_date !== null);
    const chunkSize = 200;
    for (let i = 0; i < tableRows.length; i += chunkSize) {
      await trx(table).insert(tableRows.slice(i, i + chunkSize));
    }
    return id;
  });

  await audit({
    action: 'dataset_created', userId: req.user!.id, entityType: 'dataset', entityId: datasetId,
    newValue: { name: body.name, version, kind, rows: cleaned.length, approvedActions: approved.map((a) => a.id) },
    sourceIp: req.ip,
  });
  await audit({
    action: 'cleansing_approved', userId: req.user!.id, entityType: 'dataset', entityId: datasetId,
    newValue: { log, excludedRowCount: excludedRows.length }, sourceIp: req.ip,
  });

  res.status(201).json({
    id: datasetId,
    version,
    kind,
    rowCount: cleaned.length,
    excludedRows: excludedRows.length,
    cleansingLog: log,
    qualityScores: scores,
  });
}));

// ---- Listing / detail / delete ---------------------------------------------

datasetsRouter.get('/', requirePermission('view_dataset'), asyncHandler(async (_req, res) => {
  const rows = await db('datasets')
    .leftJoin('users', 'datasets.created_by', 'users.id')
    .select('datasets.*', 'users.name as created_by_name')
    .orderBy('datasets.id', 'desc');
  res.json({
    datasets: rows.map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      kind: r.kind,
      status: r.status,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      rowCount: r.row_count,
      qualityScore: r.quality_scores ? JSON.parse(r.quality_scores).overall : null,
      createdBy: r.created_by_name,
      createdAt: r.created_at,
    })),
  });
}));

datasetsRouter.get('/:id', requirePermission('view_dataset'), asyncHandler(async (req, res) => {
  const r = await db('datasets').where({ id: Number(req.params.id) }).first();
  if (!r) throw new HttpError(404, 'Dataset not found');
  res.json({
    dataset: {
      id: r.id,
      name: r.name,
      version: r.version,
      kind: r.kind,
      status: r.status,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      rowCount: r.row_count,
      mapping: JSON.parse(r.mapping ?? '[]'),
      cleansingLog: JSON.parse(r.cleansing_log ?? '[]'),
      qualityIssues: JSON.parse(r.quality_issues ?? '[]'),
      qualityScores: JSON.parse(r.quality_scores ?? 'null'),
      company: r.company,
      plantTag: r.plant_tag,
      createdAt: r.created_at,
    },
  });
}));

datasetsRouter.get('/:id/rows', requirePermission('view_dataset'), asyncHandler(async (req, res) => {
  const r = await db('datasets').where({ id: Number(req.params.id) }).first();
  if (!r) throw new HttpError(404, 'Dataset not found');
  const table = TABLE_FOR_KIND[r.kind];
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));
  const material = typeof req.query.material === 'string' ? req.query.material : undefined;

  let query = db(table).where({ dataset_id: r.id });
  if (material) query = query.where('material', 'like', `%${material}%`);
  const rows = await query.clone().orderBy('id').limit(pageSize).offset((page - 1) * pageSize);
  const [{ count }] = await query.clone().count({ count: '*' });
  res.json({ rows, page, pageSize, total: Number(count) });
}));

datasetsRouter.delete('/:id', requirePermission('delete_dataset'), asyncHandler(async (req, res) => {
  const r = await db('datasets').where({ id: Number(req.params.id) }).first();
  if (!r) throw new HttpError(404, 'Dataset not found');
  await db.transaction(async (trx) => {
    await trx(TABLE_FOR_KIND[r.kind]).where({ dataset_id: r.id }).delete();
    await trx('datasets').where({ id: r.id }).delete();
  });
  await audit({
    action: 'dataset_deleted', userId: req.user!.id, entityType: 'dataset', entityId: r.id,
    prevValue: { name: r.name, version: r.version, rows: r.row_count }, sourceIp: req.ip,
  });
  res.json({ ok: true });
}));
