import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { z } from 'zod';
import { db, insertGetId } from '../db';
import { config } from '../config';
import { requireAuth, requirePermission } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errors';
import { audit } from '../services/audit';
import { parseWorkbook, sanitizeFilename, validateUploadFile } from '../services/files';
import { mapColumns, applyMapping } from '../services/mapping';
import { detectReportType, kindForReportType } from '../services/detection';
import { runQualityRules, computeQualityScores, proposeCleansing, parseNumber, parseDate } from '@kynox/data-quality';
import type { MappedRow } from '@kynox/data-quality';
import type { ColumnMapping } from '@kynox/shared-types';

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const safe = sanitizeFilename(file.originalname);
    cb(null, `${crypto.randomUUID()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    try {
      validateUploadFile(file.originalname, file.mimetype);
      cb(null, true);
    } catch (err) {
      cb(err as Error);
    }
  },
});

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

/**
 * Loads an upload row, enforcing object-level access: only the uploader or a
 * system administrator may read or modify an upload (IDOR protection —
 * permission checks alone would let any mapper touch other users' files).
 */
async function getUpload(id: number, user: { id: number; role: string }) {
  const row = await db('uploads').where({ id }).first();
  if (!row) throw new HttpError(404, 'Upload not found');
  if (row.user_id !== user.id && user.role !== 'system_admin' && user.role !== 'data_admin') {
    throw new HttpError(403, 'You can only access uploads you created');
  }
  return row;
}

function fileFor(row: { stored_name: string }): string {
  return path.join(config.uploadDir, row.stored_name);
}

// ---- Step 1+2+3: upload, auto-detect, auto-map ------------------------------

uploadsRouter.post('/', requirePermission('upload'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file provided (field name: file)');
  const sourceSystem = typeof req.body.sourceSystem === 'string' ? req.body.sourceSystem.slice(0, 80) : null;

  const sheets = parseWorkbook(req.file.path, 5); // header + sample probe only at this stage
  const fullSheets = parseWorkbook(req.file.path);
  const sheet = fullSheets[0];
  const mapping = mapColumns(sheet.headers);
  const detection = detectReportType(mapping, sheet.name, req.file.originalname);

  const id = await insertGetId(db, 'uploads', {
    user_id: req.user!.id,
    stored_name: req.file.filename,
    original_name: sanitizeFilename(req.file.originalname),
    size_bytes: req.file.size,
    mime: req.file.mimetype,
    sheet_names: JSON.stringify(fullSheets.map((s) => s.name)),
    source_system: sourceSystem,
    status: 'detected',
    detected_type: detection.reportType,
    detection: JSON.stringify(detection),
    mapping: JSON.stringify(mapping),
    headers: JSON.stringify(sheet.headers),
    sheet: sheet.name,
  });

  await audit({
    action: 'file_uploaded', userId: req.user!.id, entityType: 'upload', entityId: id,
    newValue: { name: req.file.originalname, size: req.file.size, detected: detection.reportType },
    sourceIp: req.ip,
  });

  res.status(201).json({
    id,
    originalName: sanitizeFilename(req.file.originalname),
    sizeBytes: req.file.size,
    sheets: fullSheets.map((s) => ({ name: s.name, rows: s.rows.length, headers: s.headers })),
    activeSheet: sheet.name,
    rowCount: sheet.rows.length,
    detection,
    mapping,
    probe: sheets[0]?.rows.slice(0, 5) ?? [],
  });
}));

uploadsRouter.get('/', asyncHandler(async (req, res) => {
  const rows = await db('uploads').where({ user_id: req.user!.id }).orderBy('id', 'desc').limit(50);
  res.json({
    uploads: rows.map((r) => ({
      id: r.id, originalName: r.original_name, sizeBytes: r.size_bytes,
      status: r.status, detectedType: r.detected_type, sheet: r.sheet,
      createdAt: r.created_at,
    })),
  });
}));

// ---- Sheet selection + manual overrides ------------------------------------

const sheetSchema = z.object({ sheet: z.string().min(1).max(128) });

uploadsRouter.put('/:id/sheet', requirePermission('edit_mapping'), asyncHandler(async (req, res) => {
  const row = await getUpload(Number(req.params.id), req.user!);
  const { sheet } = sheetSchema.parse(req.body);
  const sheets = parseWorkbook(fileFor(row));
  const target = sheets.find((s) => s.name === sheet);
  if (!target) throw new HttpError(404, `Sheet '${sheet}' not found in this file`);
  const mapping = mapColumns(target.headers);
  const detection = detectReportType(mapping, target.name, row.original_name);
  await db('uploads').where({ id: row.id }).update({
    sheet: target.name,
    headers: JSON.stringify(target.headers),
    mapping: JSON.stringify(mapping),
    detection: JSON.stringify(detection),
    detected_type: detection.reportType,
  });
  res.json({ sheet: target.name, mapping, detection, rowCount: target.rows.length });
}));

const mappingSchema = z.object({
  mapping: z.array(z.object({
    sourceColumn: z.string(),
    canonicalField: z.string().nullable(),
    confidence: z.number().min(0).max(1).optional(),
    method: z.string().optional(),
  })),
  reportType: z.string().optional(),
});

uploadsRouter.put('/:id/mapping', requirePermission('edit_mapping'), asyncHandler(async (req, res) => {
  const row = await getUpload(Number(req.params.id), req.user!);
  const body = mappingSchema.parse(req.body);
  const prev: ColumnMapping[] = JSON.parse(row.mapping ?? '[]');
  const prevByColumn = new Map(prev.map((m) => [m.sourceColumn, m]));
  // The client always resubmits the full mapping when confirming (even columns
  // it never touched). Only columns whose canonical field actually changed are
  // "user" mappings — everything else keeps its original detection provenance
  // (sap_technical/exact/synonym/fuzzy), which downstream logic (e.g. source
  // system classification) relies on.
  const mapping: ColumnMapping[] = body.mapping.map((m) => {
    const before = prevByColumn.get(m.sourceColumn);
    const field = (m.canonicalField as ColumnMapping['canonicalField']) ?? null;
    if (before && before.canonicalField === field) return before;
    return { sourceColumn: m.sourceColumn, canonicalField: field, confidence: field ? 1 : 0, method: 'user' };
  });
  const detection = body.reportType
    ? { ...JSON.parse(row.detection ?? '{}'), reportType: body.reportType, confidence: 1, reasons: ['Manually selected by user'] }
    : detectReportType(mapping, row.sheet ?? '', row.original_name);
  await db('uploads').where({ id: row.id }).update({
    mapping: JSON.stringify(mapping),
    detection: JSON.stringify(detection),
    detected_type: detection.reportType,
    status: 'mapped',
  });
  await audit({
    action: 'mapping_changed', userId: req.user!.id, entityType: 'upload', entityId: row.id,
    prevValue: prev, newValue: mapping, sourceIp: req.ip,
  });
  res.json({ mapping, detection });
}));

// ---- Step 4: preview --------------------------------------------------------

uploadsRouter.get('/:id/preview', asyncHandler(async (req, res) => {
  const row = await getUpload(Number(req.params.id), req.user!);
  const sheets = parseWorkbook(fileFor(row));
  const sheet = sheets.find((s) => s.name === row.sheet) ?? sheets[0];
  const sample = sheet.rows.slice(0, 50);

  const columnProfiles = sheet.headers.map((h) => {
    const values = sheet.rows.map((r) => r[h]);
    const nonNull = values.filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    const numeric = nonNull.filter((v) => parseNumber(v).value !== null);
    const dates = nonNull.filter((v) => parseDate(v).value !== null);
    const uniques = new Set(nonNull.map((v) => String(v))).size;
    let inferredType: string = 'text';
    if (nonNull.length > 0 && numeric.length / nonNull.length > 0.9) inferredType = 'number';
    else if (nonNull.length > 0 && dates.length / nonNull.length > 0.9) inferredType = 'date';
    return {
      column: h,
      inferredType,
      nullPct: Math.round(((values.length - nonNull.length) / Math.max(1, values.length)) * 1000) / 10,
      uniqueValues: uniques,
    };
  });

  res.json({
    sheet: sheet.name,
    rowCount: sheet.rows.length,
    headers: sheet.headers,
    sample,
    columnProfiles,
    mapping: JSON.parse(row.mapping ?? '[]'),
    detection: JSON.parse(row.detection ?? 'null'),
  });
}));

// ---- Step 5+6: validate and propose cleansing -------------------------------

uploadsRouter.post('/:id/validate', requirePermission('run_analysis'), asyncHandler(async (req, res) => {
  const row = await getUpload(Number(req.params.id), req.user!);
  const sheets = parseWorkbook(fileFor(row));
  const sheet = sheets.find((s) => s.name === row.sheet) ?? sheets[0];
  const mapping: ColumnMapping[] = JSON.parse(row.mapping ?? '[]');
  const kind = kindForReportType(row.detected_type ?? 'UNKNOWN');
  const mapped = applyMapping(sheet.rows, mapping) as MappedRow[];

  const issues = runQualityRules(kind, mapped);
  const scores = computeQualityScores(kind, mapped, issues);
  const proposals = proposeCleansing(kind, mapped, issues);
  const criticalCount = issues.filter((i) => i.severity === 'critical').length;

  res.json({
    kind,
    rowCount: mapped.length,
    issues,
    scores,
    proposals,
    blocking: criticalCount > 0
      ? 'Critical issues must be resolved (or affected rows excluded via cleansing) before the dataset can be finalised.'
      : null,
  });
}));
