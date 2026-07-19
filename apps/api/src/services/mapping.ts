import type { CanonicalField, ColumnMapping } from '@kynox/shared-types';
import { similarity } from '@kynox/data-quality';

/**
 * Smart column mapping: exact match, synonym match (SAP technical names,
 * SAP business labels, English and Arabic variants), then fuzzy matching.
 * Column positions are never used as a mapping signal.
 */

interface FieldSynonyms {
  field: CanonicalField;
  synonyms: string[];
  sapTechnical: string[];
}

const SYNONYMS: FieldSynonyms[] = [
  { field: 'material', sapTechnical: ['MATNR'], synonyms: ['material', 'material number', 'material code', 'material no', 'item', 'item code', 'item number', 'part number', 'sku', 'رقم المادة', 'المادة', 'الصنف', 'رقم الصنف', 'كود المادة'] },
  { field: 'material_description', sapTechnical: ['MAKTX'], synonyms: ['material description', 'description', 'item description', 'short text', 'material text', 'وصف المادة', 'الوصف', 'اسم الصنف', 'اسم المادة'] },
  { field: 'material_type', sapTechnical: ['MTART'], synonyms: ['material type', 'mat type', 'type', 'نوع المادة'] },
  { field: 'material_group', sapTechnical: ['MATKL'], synonyms: ['material group', 'mat group', 'group', 'commodity', 'مجموعة المواد', 'المجموعة'] },
  { field: 'base_unit', sapTechnical: ['MEINS'], synonyms: ['base unit', 'base unit of measure', 'uom', 'unit', 'unit of measure', 'bun', 'وحدة القياس', 'الوحدة'] },
  { field: 'plant', sapTechnical: ['WERKS'], synonyms: ['plant', 'plnt', 'site', 'facility', 'المصنع', 'الموقع'] },
  { field: 'storage_location', sapTechnical: ['LGORT'], synonyms: ['storage location', 'stor loc', 'sloc', 'stge loc', 'موقع التخزين', 'المخزن'] },
  { field: 'warehouse', sapTechnical: ['LGNUM'], synonyms: ['warehouse', 'warehouse number', 'whse', 'المستودع'] },
  { field: 'bin', sapTechnical: ['LGPLA'], synonyms: ['bin', 'storage bin', 'bin location', 'الرف'] },
  { field: 'batch', sapTechnical: ['CHARG'], synonyms: ['batch', 'batch number', 'lot', 'lot number', 'الدفعة', 'رقم الدفعة'] },
  { field: 'serial_number', sapTechnical: ['SERNR'], synonyms: ['serial number', 'serial', 'الرقم التسلسلي'] },
  { field: 'valuation_class', sapTechnical: ['BKLAS'], synonyms: ['valuation class', 'فئة التقييم'] },
  { field: 'standard_price', sapTechnical: ['STPRS'], synonyms: ['standard price', 'std price', 'السعر القياسي'] },
  { field: 'moving_avg_price', sapTechnical: ['VERPR'], synonyms: ['moving average price', 'moving price', 'map', 'avg price', 'متوسط السعر'] },
  { field: 'currency', sapTechnical: ['WAERS'], synonyms: ['currency', 'crcy', 'curr', 'العملة'] },
  { field: 'quantity', sapTechnical: ['MENGE', 'LABST'], synonyms: ['quantity', 'qty', 'stock', 'stock quantity', 'on hand', 'on-hand qty', 'total stock', 'الكمية', 'الرصيد', 'المخزون'] },
  { field: 'value', sapTechnical: ['DMBTR', 'SALK3'], synonyms: ['value', 'amount', 'stock value', 'total value', 'value in loc.curr', 'amount in lc', 'القيمة', 'المبلغ', 'قيمة المخزون'] },
  { field: 'unrestricted_qty', sapTechnical: ['LABST'], synonyms: ['unrestricted', 'unrestricted stock', 'unrestricted use', 'المتاح', 'الرصيد الحر'] },
  { field: 'blocked_qty', sapTechnical: ['SPEME'], synonyms: ['blocked', 'blocked stock', 'المحجوب'] },
  { field: 'quality_qty', sapTechnical: ['INSME'], synonyms: ['in quality insp', 'quality inspection', 'quality stock', 'quality', 'فحص الجودة'] },
  { field: 'in_transit_qty', sapTechnical: ['UMLME'], synonyms: ['in transit', 'stock in transit', 'transit', 'transfer stock', 'في الطريق'] },
  { field: 'reserved_qty', sapTechnical: ['BDMNG'], synonyms: ['reserved', 'reserved stock', 'reservation qty', 'المحجوز'] },
  { field: 'safety_stock', sapTechnical: ['EISBE'], synonyms: ['safety stock', 'safety', 'مخزون الأمان'] },
  { field: 'reorder_point', sapTechnical: ['MINBE'], synonyms: ['reorder point', 'reorder level', 'rop', 'نقطة إعادة الطلب'] },
  { field: 'min_stock', sapTechnical: [], synonyms: ['minimum stock', 'min stock', 'min', 'الحد الأدنى'] },
  { field: 'max_stock', sapTechnical: ['MABST'], synonyms: ['maximum stock', 'max stock', 'max', 'الحد الأقصى'] },
  { field: 'lead_time_days', sapTechnical: ['PLIFZ'], synonyms: ['lead time', 'planned delivery time', 'delivery time', 'plnd delivery time', 'مدة التوريد'] },
  { field: 'movement_type', sapTechnical: ['BWART'], synonyms: ['movement type', 'mvt', 'mvt type', 'mov type', 'نوع الحركة'] },
  { field: 'movement_qty', sapTechnical: ['MENGE'], synonyms: ['movement quantity', 'qty in unit of entry', 'quantity', 'كمية الحركة'] },
  { field: 'movement_value', sapTechnical: ['DMBTR'], synonyms: ['amount in local currency', 'movement value', 'amount', 'قيمة الحركة'] },
  { field: 'posting_date', sapTechnical: ['BUDAT'], synonyms: ['posting date', 'pstng date', 'post date', 'تاريخ الترحيل', 'تاريخ القيد'] },
  { field: 'document_date', sapTechnical: ['BLDAT'], synonyms: ['document date', 'doc date', 'تاريخ المستند'] },
  { field: 'document_number', sapTechnical: ['MBLNR', 'BELNR'], synonyms: ['material document', 'document number', 'material doc', 'doc number', 'doc no', 'رقم المستند'] },
  { field: 'reservation', sapTechnical: ['RSNUM'], synonyms: ['reservation', 'reservation number', 'رقم الحجز'] },
  { field: 'purchase_order', sapTechnical: ['EBELN'], synonyms: ['purchase order', 'po', 'po number', 'purchasing document', 'أمر الشراء'] },
  { field: 'purchase_requisition', sapTechnical: ['BANFN'], synonyms: ['purchase requisition', 'pr', 'pr number', 'طلب الشراء'] },
  { field: 'production_order', sapTechnical: ['AUFNR'], synonyms: ['production order', 'order', 'order number', 'أمر الإنتاج'] },
  { field: 'wbs_element', sapTechnical: ['PSPNR'], synonyms: ['wbs element', 'wbs', 'project', 'عنصر المشروع'] },
  { field: 'cost_center', sapTechnical: ['KOSTL'], synonyms: ['cost center', 'cost centre', 'مركز التكلفة'] },
  { field: 'vendor', sapTechnical: ['LIFNR'], synonyms: ['vendor', 'supplier', 'vendor number', 'المورد'] },
  { field: 'customer', sapTechnical: ['KUNNR'], synonyms: ['customer', 'customer number', 'العميل'] },
  { field: 'requester', sapTechnical: ['USNAM'], synonyms: ['user name', 'user', 'requester', 'created by', 'counted by', 'اسم المستخدم', 'الطالب'] },
  { field: 'mrp_controller', sapTechnical: ['DISPO'], synonyms: ['mrp controller', 'mrp', 'planner', 'مراقب التخطيط'] },
  { field: 'consumption_qty', sapTechnical: [], synonyms: ['consumption', 'consumption quantity', 'consumed qty', 'usage', 'الاستهلاك'] },
  { field: 'demand_qty', sapTechnical: [], synonyms: ['demand', 'demand quantity', 'requirement', 'requirements qty', 'الطلب'] },
  { field: 'forecast_qty', sapTechnical: [], synonyms: ['forecast', 'forecast quantity', 'التنبؤ'] },
  { field: 'book_qty', sapTechnical: ['BUCHM'], synonyms: ['book quantity', 'book qty', 'book inventory', 'system qty', 'الكمية الدفترية'] },
  { field: 'counted_qty', sapTechnical: ['MENGE'], synonyms: ['counted quantity', 'counted qty', 'count qty', 'physical qty', 'الكمية المعدودة'] },
  { field: 'count_difference', sapTechnical: ['DIFMG'], synonyms: ['difference', 'difference qty', 'variance', 'count difference', 'الفرق'] },
  { field: 'last_receipt_date', sapTechnical: ['LWEDT'], synonyms: ['last receipt', 'last receipt date', 'last gr date', 'آخر استلام'] },
  { field: 'last_issue_date', sapTechnical: [], synonyms: ['last issue', 'last issue date', 'last gi date', 'آخر صرف'] },
  { field: 'last_movement_date', sapTechnical: [], synonyms: ['last movement', 'last movement date', 'last mvt date', 'آخر حركة'] },
];

const normalize = (s: string): string => s.toLowerCase().trim().replace(/[._\-/]+/g, ' ').replace(/\s+/g, ' ');

/**
 * Maps source columns to canonical fields. Each canonical field is assigned
 * at most once (highest-confidence column wins).
 */
export function mapColumns(headers: string[]): ColumnMapping[] {
  interface Candidate { header: string; field: CanonicalField; confidence: number; method: ColumnMapping['method']; }
  const candidates: Candidate[] = [];

  for (const header of headers) {
    const norm = normalize(header);
    if (!norm) continue;
    for (const { field, synonyms, sapTechnical } of SYNONYMS) {
      // SAP technical names match exactly (case-insensitive)
      if (sapTechnical.some((t) => t.toLowerCase() === norm)) {
        candidates.push({ header, field, confidence: 0.98, method: 'sap_technical' });
        continue;
      }
      let best = 0;
      let method: ColumnMapping['method'] = 'fuzzy';
      for (const syn of synonyms) {
        const synNorm = normalize(syn);
        if (synNorm === norm) { best = 1; method = 'exact'; break; }
        const sim = similarity(synNorm, norm);
        if (sim > best) { best = sim; method = sim >= 0.85 ? 'synonym' : 'fuzzy'; }
      }
      if (best >= 0.72) {
        candidates.push({ header, field, confidence: Math.round(best * 100) / 100, method });
      }
    }
  }

  // Greedy assignment: best candidates first, one field per column, one column per field.
  candidates.sort((a, b) => b.confidence - a.confidence);
  const usedHeaders = new Set<string>();
  const usedFields = new Set<CanonicalField>();
  const assigned = new Map<string, Candidate>();
  for (const c of candidates) {
    if (usedHeaders.has(c.header) || usedFields.has(c.field)) continue;
    usedHeaders.add(c.header);
    usedFields.add(c.field);
    assigned.set(c.header, c);
  }

  return headers.map((header) => {
    const c = assigned.get(header);
    return c
      ? { sourceColumn: header, canonicalField: c.field, confidence: c.confidence, method: c.method }
      : { sourceColumn: header, canonicalField: null, confidence: 0, method: 'fuzzy' as const };
  });
}

/** Applies a mapping to raw sheet rows, producing canonical records. */
export function applyMapping(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping[],
): Record<string, unknown>[] {
  const active = mapping.filter((m) => m.canonicalField !== null);
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const m of active) {
      out[m.canonicalField as string] = row[m.sourceColumn];
    }
    return out;
  });
}
