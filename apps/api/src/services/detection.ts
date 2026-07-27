import type { CanonicalField, ReportDetectionResult, ReportType, ColumnMapping } from '@kynox/shared-types';

/**
 * SAP/ERP report-type detection from the mapped canonical fields, the sheet
 * name and light data heuristics. Produces a confidence score, the fields
 * used, and ranked alternatives — the user can always override.
 */

interface ReportSignature {
  reportType: ReportType;
  /** Fields that must be present. An inner array means "any of these". */
  required: (CanonicalField | CanonicalField[])[];
  /** Fields that raise confidence when present. */
  supporting: CanonicalField[];
  /** Sheet-name fragments that hint at this report. */
  sheetHints: string[];
  /** Canonical dataset kind this report loads into. */
  kind: 'stock' | 'movements' | 'material_master' | 'physical_inventory';
}

export const SIGNATURES: ReportSignature[] = [
  {
    reportType: 'MB52', kind: 'stock',
    required: ['material', ['quantity', 'unrestricted_qty']],
    supporting: ['plant', 'storage_location', 'value', 'unrestricted_qty', 'blocked_qty', 'quality_qty', 'in_transit_qty', 'batch'],
    sheetHints: ['mb52', 'warehouse stock', 'stock list'],
  },
  {
    reportType: 'MB51', kind: 'movements',
    required: ['material', 'movement_qty', 'posting_date'],
    supporting: ['movement_type', 'document_number', 'plant', 'storage_location', 'movement_value', 'cost_center', 'vendor'],
    sheetHints: ['mb51', 'material document', 'movements', 'goods movement'],
  },
  {
    reportType: 'MB5B', kind: 'movements',
    required: ['material', 'posting_date', 'quantity'],
    supporting: ['movement_qty', 'movement_type', 'plant', 'document_number'],
    sheetHints: ['mb5b', 'stock on posting date'],
  },
  {
    reportType: 'MMBE', kind: 'stock',
    required: ['material', ['quantity', 'unrestricted_qty']],
    supporting: ['plant', 'storage_location', 'unrestricted_qty', 'blocked_qty', 'quality_qty'],
    sheetHints: ['mmbe', 'stock overview'],
  },
  {
    reportType: 'MATERIAL_MASTER', kind: 'material_master',
    required: ['material'],
    supporting: ['material_type', 'material_group', 'base_unit', 'standard_price', 'moving_avg_price', 'lead_time_days', 'mrp_controller', 'safety_stock', 'reorder_point', 'valuation_class'],
    sheetHints: ['material master', 'mara', 'marc', 'master data'],
  },
  {
    reportType: 'PHYSICAL_INVENTORY', kind: 'physical_inventory',
    required: ['material', 'book_qty', 'counted_qty'],
    supporting: ['count_difference', 'plant', 'storage_location', 'batch', 'document_number'],
    sheetHints: ['physical inventory', 'cycle count', 'count', 'mi07', 'li21'],
  },
  {
    reportType: 'CONSUMPTION', kind: 'movements',
    required: ['material', 'consumption_qty'],
    supporting: ['posting_date', 'plant', 'cost_center'],
    sheetHints: ['consumption', 'usage', 'mc.9', 'mc9'],
  },
  {
    reportType: 'RESERVATIONS', kind: 'movements',
    required: ['material', 'reservation'],
    supporting: ['movement_qty', 'posting_date', 'cost_center', 'movement_type'],
    sheetHints: ['reservation', 'mb25'],
  },
  {
    reportType: 'PURCHASE_ORDERS', kind: 'movements',
    required: ['material', 'purchase_order'],
    supporting: ['vendor', 'movement_qty', 'posting_date', 'document_date', 'plant'],
    sheetHints: ['purchase order', 'me2m', 'me2n', 'po '],
  },
  {
    reportType: 'MD04', kind: 'movements',
    required: ['material', 'demand_qty'],
    supporting: ['posting_date', 'plant', 'purchase_order', 'reservation'],
    sheetHints: ['md04', 'stock requirements'],
  },
];

export function detectReportType(
  mapping: ColumnMapping[],
  sheetName: string,
  fileName = '',
): ReportDetectionResult {
  const mappedFields = new Set(
    mapping.filter((m) => m.canonicalField !== null).map((m) => m.canonicalField as CanonicalField),
  );
  const hintText = `${sheetName} ${fileName}`.toLowerCase();

  const scored = SIGNATURES.map((sig) => {
    const requiredHit: CanonicalField[] = [];
    let requiredMet = true;
    for (const req of sig.required) {
      const options = Array.isArray(req) ? req : [req];
      const hit = options.find((f) => mappedFields.has(f));
      if (hit) requiredHit.push(hit);
      else requiredMet = false;
    }
    const nameHint = sig.sheetHints.some((h) => hintText.includes(h));
    if (!requiredMet) {
      // A strong name hint with a partial field match still surfaces as a weak candidate.
      const score = nameHint && requiredHit.length > 0 ? 0.3 : 0;
      return { sig, score, fields: requiredHit };
    }
    const supportingHit = sig.supporting.filter((f) => mappedFields.has(f));
    let score = 0.5 + 0.35 * (sig.supporting.length === 0 ? 0 : supportingHit.length / sig.supporting.length);
    if (nameHint) score += 0.15;
    return { sig, score: Math.min(1, score), fields: [...requiredHit, ...supportingHit] };
  }).filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      reportType: 'UNKNOWN',
      confidence: 0,
      matchedFields: [...mappedFields],
      alternatives: [],
      reasons: ['No known report signature matched the mapped columns. Select the report type manually.'],
    };
  }

  const best = scored[0];
  return {
    reportType: best.sig.reportType,
    confidence: Math.round(best.score * 100) / 100,
    matchedFields: best.fields,
    alternatives: scored.slice(1, 4).map((s) => ({
      reportType: s.sig.reportType,
      confidence: Math.round(s.score * 100) / 100,
    })),
    reasons: [
      `Required fields present: ${best.sig.required.map((r) => (Array.isArray(r) ? r.join('|') : r)).join(', ')}`,
      `Supporting fields present: ${best.sig.supporting.filter((f) => mappedFields.has(f)).join(', ') || 'none'}`,
    ],
  };
}

export function kindForReportType(reportType: ReportType): 'stock' | 'movements' | 'material_master' | 'physical_inventory' {
  const sig = SIGNATURES.find((s) => s.reportType === reportType);
  return sig?.kind ?? 'stock';
}
