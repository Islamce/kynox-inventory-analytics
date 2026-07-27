import { Router } from 'express';
import path from 'path';
import { z } from 'zod';
import { db, insertGetId } from '../db';
import { config } from '../config';
import { requireAuth, requirePermission } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errors';
import { audit } from '../services/audit';
import { parseWorkbook } from '../services/files';
import { applyMapping } from '../services/mapping';
import { kindForReportType } from '../services/detection';
import { buildNormalization, classifySource, NORMALIZATION_VERSION } from '../services/normalization';
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
  // Phase 2: user-confirmed day/month order, resolving genuinely ambiguous
  // date columns so the import can proceed. Omitted for unambiguous files
  // (e.g. SAP ISO dates), which never require confirmation.
  dateOrder: z.enum(['DMY', 'MDY']).optional(),
});

datasetsRouter.post('/', requirePermission('approve_cleansing'), asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  const uploadRow = await db('uploads').where({ id: body.uploadId }).first();
  if (!uploadRow) throw new HttpError(404, 'Upload not found');
  // Object-level access: only the uploader or an admin may turn an upload into a dataset.
  if (uploadRow.user_id !== req.user!.id && req.user!.role !== 'system_admin' && req.user!.role !== 'data_admin') {
    throw new HttpError(403, 'You can only create datasets from uploads you created');
  }

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

  // Phase 2: source-independent canonical normalization. Additive — it produces
  // canonical_transactions rows + dataset-level metadata for movements datasets
  // without altering the existing per-kind persistence below. Pure/in-memory so
  // it can be persisted inside the dataset-creation transaction for atomicity.
  const hasSapTechnicalColumn = mapping.some((m) => m.method === 'sap_technical');
  const { sourceSystem, sourceReportType } = classifySource(uploadRow.detected_type, uploadRow.source_system, hasSapTechnicalColumn);
  const normalization = buildNormalization({
    kind,
    rows: cleaned,
    sourceSystem,
    sourceReportType,
    sourceFileName: uploadRow.original_name,
    sheetName: sheet.name ?? null,
    dateOrder: body.dateOrder,
    dateOrderUserConfirmed: !!body.dateOrder,
    // Raw (pre-cleansing) dates so ambiguity is judged before the "normalize
    // dates" cleansing action rewrites the values to ISO.
    rawDateValues: mapped.map((r) => r.posting_date ?? r.document_date ?? null),
  });

  // Ambiguous date columns block activation until the user confirms the order.
  // Unambiguous files (e.g. SAP ISO dates) never trigger this.
  if (normalization.ambiguousDatesNeedConfirmation) {
    throw new HttpError(422,
      'The transaction date column is ambiguous: both DD/MM/YYYY and MM/DD/YYYY are possible. '
      + 'Re-submit with "dateOrder" set to "DMY" or "MDY" to confirm the intended date format.');
  }

  // Versioning: next version for datasets with the same name.
  const prev = await db('datasets').where({ name: body.name }).orderBy('version', 'desc').first();
  const version = prev ? prev.version + 1 : 1;

  const datasetId = await db.transaction(async (trx) => {
    const id = await insertGetId(trx, 'datasets', {
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
      // Phase 2: dataset-level normalization metadata (additive nullable cols).
      source_system: sourceSystem,
      source_report_type: sourceReportType,
      normalization_status: kind === 'movements' ? 'normalized' : 'not_applicable',
      normalization_version: NORMALIZATION_VERSION,
      detected_date_format: normalization.summary.dateFormat,
      selected_date_format: body.dateOrder ?? null,
      date_format_confidence: normalization.summary.dateFormatConfidence,
      date_format_user_confirmed: !!body.dateOrder,
      total_source_rows: normalization.summary.totalSourceRows,
      normalized_rows: normalization.summary.normalizedRows,
      rejected_rows: normalization.summary.rejectedRows,
      warning_rows: normalization.summary.warningRows,
      unknown_transaction_rows: normalization.summary.unknownTransactionRows,
      normalization_summary: JSON.stringify(normalization.summary),
      normalization_findings: JSON.stringify(normalization.findings),
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

    // Phase 2: persist canonical transactions in the SAME transaction. If this
    // fails the dataset and its per-kind rows roll back together — no partially
    // active dataset. Chunked to stay within driver parameter limits.
    if (normalization.canonicalRows.length > 0) {
      const canonicalRows = normalization.canonicalRows.map((cr) => ({
        ...cr, dataset_id: id, organization_id: body.company ?? null,
      }));
      for (let i = 0; i < canonicalRows.length; i += chunkSize) {
        await trx('canonical_transactions').insert(canonicalRows.slice(i, i + chunkSize));
      }
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
    sourceSystem,
    sourceReportType,
    normalization: {
      summary: normalization.summary,
      canonicalRowCount: normalization.canonicalRows.length,
      findingCount: normalization.findings.length,
    },
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

// ---- Phase 2: canonical normalization read APIs (for a future import UI) ----

/** Dataset-level normalization metadata, summary and findings. */
datasetsRouter.get('/:id/normalization', requirePermission('view_dataset'), asyncHandler(async (req, res) => {
  const r = await db('datasets').where({ id: Number(req.params.id) }).first();
  if (!r) throw new HttpError(404, 'Dataset not found');
  res.json({
    datasetId: r.id,
    kind: r.kind,
    sourceSystem: r.source_system ?? null,
    sourceReportType: r.source_report_type ?? null,
    normalizationStatus: r.normalization_status ?? null,
    normalizationVersion: r.normalization_version ?? null,
    dateFormat: {
      detected: r.detected_date_format ?? null,
      selected: r.selected_date_format ?? null,
      confidence: r.date_format_confidence ?? null,
      userConfirmed: !!r.date_format_user_confirmed,
    },
    counts: {
      totalSourceRows: r.total_source_rows ?? null,
      normalizedRows: r.normalized_rows ?? null,
      rejectedRows: r.rejected_rows ?? null,
      warningRows: r.warning_rows ?? null,
      unknownTransactionRows: r.unknown_transaction_rows ?? null,
    },
    summary: r.normalization_summary ? JSON.parse(r.normalization_summary) : null,
    findings: r.normalization_findings ? JSON.parse(r.normalization_findings) : [],
  });
}));

/** Paginated canonical transactions with optional material/category/direction filters. */
datasetsRouter.get('/:id/canonical', requirePermission('view_dataset'), asyncHandler(async (req, res) => {
  const r = await db('datasets').where({ id: Number(req.params.id) }).first();
  if (!r) throw new HttpError(404, 'Dataset not found');
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));
  const material = typeof req.query.material === 'string' ? req.query.material : undefined;
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const direction = typeof req.query.direction === 'string' ? req.query.direction : undefined;

  let query = db('canonical_transactions').where({ dataset_id: r.id });
  if (material) query = query.where('material_id', 'like', `%${material}%`);
  if (category) query = query.where('transaction_category', category);
  if (direction) query = query.where('transaction_direction', direction);

  const rows = await query.clone()
    .select(
      'id', 'source_row_number', 'material_id', 'material_description', 'transaction_date',
      'raw_quantity', 'signed_quantity', 'absolute_quantity', 'receipt_quantity', 'consumption_quantity',
      'unit_of_measure', 'transaction_direction', 'transaction_category', 'transaction_type_code',
      'classification_source', 'classification_confidence', 'sign_conflict', 'direction_conflict',
      'warehouse_name', 'location_name', 'plant_id', 'currency', 'transaction_value',
    )
    .orderBy('source_row_number').limit(pageSize).offset((page - 1) * pageSize);
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
