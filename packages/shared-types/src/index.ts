/**
 * Canonical data model and cross-package contracts for the
 * Kynox Supply Chain & Materials Intelligence Platform.
 */

// ---------------------------------------------------------------------------
// Canonical field identifiers
// ---------------------------------------------------------------------------

/** Canonical fields a source column can be mapped to. */
export type CanonicalField =
  | 'material'
  | 'material_description'
  | 'material_type'
  | 'material_group'
  | 'base_unit'
  | 'plant'
  | 'storage_location'
  | 'warehouse'
  | 'bin'
  | 'batch'
  | 'serial_number'
  | 'valuation_class'
  | 'standard_price'
  | 'moving_avg_price'
  | 'currency'
  | 'quantity'
  | 'value'
  | 'unrestricted_qty'
  | 'blocked_qty'
  | 'quality_qty'
  | 'in_transit_qty'
  | 'reserved_qty'
  | 'safety_stock'
  | 'reorder_point'
  | 'min_stock'
  | 'max_stock'
  | 'lead_time_days'
  | 'movement_type'
  | 'movement_qty'
  | 'movement_value'
  | 'posting_date'
  | 'document_date'
  | 'document_number'
  | 'reservation'
  | 'purchase_order'
  | 'purchase_requisition'
  | 'production_order'
  | 'wbs_element'
  | 'cost_center'
  | 'vendor'
  | 'customer'
  | 'requester'
  | 'mrp_controller'
  | 'consumption_qty'
  | 'demand_qty'
  | 'forecast_qty'
  | 'book_qty'
  | 'counted_qty'
  | 'count_difference'
  | 'last_receipt_date'
  | 'last_issue_date'
  | 'last_movement_date';

/** Known SAP / ERP report types the detector recognises. */
export type ReportType =
  | 'MB52'          // warehouse stock list
  | 'MB51'          // material document list (movements)
  | 'MB5B'          // stock on posting date (opening/closing)
  | 'MC9'           // stock analysis
  | 'MD04'          // stock/requirements list
  | 'MMBE'          // stock overview
  | 'MATERIAL_MASTER'
  | 'PURCHASE_ORDERS'
  | 'PURCHASE_REQUISITIONS'
  | 'RESERVATIONS'
  | 'CONSUMPTION'
  | 'PHYSICAL_INVENTORY'
  | 'GOODS_MOVEMENTS'
  | 'UNKNOWN';

export interface ReportDetectionResult {
  reportType: ReportType;
  confidence: number;                 // 0..1
  matchedFields: CanonicalField[];
  alternatives: { reportType: ReportType; confidence: number }[];
  reasons: string[];
}

export interface ColumnMapping {
  sourceColumn: string;
  canonicalField: CanonicalField | null;
  confidence: number;                 // 0..1
  method: 'exact' | 'synonym' | 'sap_technical' | 'fuzzy' | 'user';
}

// ---------------------------------------------------------------------------
// Canonical row shapes (post-mapping)
// ---------------------------------------------------------------------------

export interface StockRow {
  material: string;
  material_description?: string;
  material_type?: string;
  material_group?: string;
  base_unit?: string;
  plant?: string;
  storage_location?: string;
  warehouse?: string;
  batch?: string;
  valuation_class?: string;
  currency?: string;
  quantity: number;
  value: number;
  unrestricted_qty?: number;
  blocked_qty?: number;
  quality_qty?: number;
  in_transit_qty?: number;
  reserved_qty?: number;
  safety_stock?: number;
  reorder_point?: number;
  min_stock?: number;
  max_stock?: number;
  lead_time_days?: number;
  standard_price?: number;
  moving_avg_price?: number;
  last_receipt_date?: string;   // ISO date
  last_issue_date?: string;
  last_movement_date?: string;
}

export interface MovementRow {
  material: string;
  material_description?: string;
  plant?: string;
  storage_location?: string;
  movement_type?: string;
  movement_qty: number;
  movement_value?: number;
  posting_date: string;         // ISO date
  document_number?: string;
  cost_center?: string;
  vendor?: string;
  customer?: string;
  requester?: string;
  purchase_order?: string;
  reservation?: string;
  batch?: string;
}

export interface MaterialMasterRow {
  material: string;
  material_description?: string;
  material_type?: string;
  material_group?: string;
  base_unit?: string;
  plant?: string;
  standard_price?: number;
  moving_avg_price?: number;
  currency?: string;
  safety_stock?: number;
  reorder_point?: number;
  min_stock?: number;
  max_stock?: number;
  lead_time_days?: number;
  mrp_controller?: string;
  valuation_class?: string;
}

export interface PhysicalInventoryRow {
  material: string;
  plant?: string;
  storage_location?: string;
  batch?: string;
  book_qty: number;
  counted_qty: number;
  count_difference?: number;
  value?: number;
  posting_date?: string;
  document_number?: string;
  requester?: string; // counter
}

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface QualityIssue {
  ruleId: string;
  severity: IssueSeverity;
  title: string;
  description: string;          // why it is a problem
  recommendation: string;       // recommended correction
  autoFixSafe: boolean;
  affectedRows: number;
  /** Sample of affected locations: row index (0-based, data rows), column, current value. */
  samples: { row: number; column: string; value: unknown }[];
  businessImpact: string;
}

export interface QualityScores {
  overall: number;              // 0..100
  completeness: number;
  validity: number;
  consistency: number;
  uniqueness: number;
  timeliness: number;
  integrity: number;
}

export interface CleansingAction {
  id: string;
  ruleId: string;
  type:
    | 'trim_whitespace'
    | 'normalize_number'
    | 'normalize_date'
    | 'remove_duplicate_rows'
    | 'drop_empty_rows'
    | 'fill_missing_value'
    | 'flag_only';
  column: string | null;
  description: string;
  affectedRows: number;
  safe: boolean;
}

// ---------------------------------------------------------------------------
// Analytics results
// ---------------------------------------------------------------------------

export type AbcClass = 'A' | 'B' | 'C';
export type XyzClass = 'X' | 'Y' | 'Z';

export interface AbcResult {
  material: string;
  metricValue: number;
  cumulativePct: number;        // 0..100 cumulative share at this material
  abcClass: AbcClass;
}

export interface XyzResult {
  material: string;
  mean: number;
  stdDev: number;
  cov: number | null;           // coefficient of variation; null when mean == 0
  zeroPeriodShare: number;      // 0..1
  intermittent: boolean;
  xyzClass: XyzClass;
  reason: string;
}

export interface AgingBucket {
  label: string;
  minDays: number;
  maxDays: number | null;       // null = open-ended
}

export interface AgingResult {
  material: string;
  ageDays: number | null;       // null = no reference date available
  bucket: string | null;
  quantity: number;
  value: number;
}

export type MovementCategory =
  | 'active'
  | 'slow_moving'
  | 'non_moving'
  | 'no_movement_data';

export interface ExcessResult {
  material: string;
  method: string;
  stockQty: number;
  stockValue: number;
  referenceQty: number;         // the limit used (max stock, coverage target demand, ...)
  excessQty: number;
  excessValue: number;
}

export interface ShortageResult {
  material: string;
  reason: string;
  stockQty: number;
  safetyStock?: number;
  reorderPoint?: number;
  gapQty: number;
  risk: 'critical' | 'high' | 'medium';
}

export interface HealthWeights {
  availability: number;
  excess: number;
  obsolescence: number;
  aging: number;
  turnover: number;
  dataQuality: number;
}

export interface ForecastResult {
  method: string;
  forecast: number[];
  fitted: (number | null)[];
  params: Record<string, number>;
}

export interface ForecastAccuracy {
  mae: number;
  rmse: number;
  mape: number | null;          // null when actuals contain zeros only
  wape: number | null;
  bias: number;
  mad: number;
  trackingSignal: number | null;
}

export interface ForecastComparison {
  method: string;
  accuracy: ForecastAccuracy;
  recommended: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// AI engine contracts
// ---------------------------------------------------------------------------

export interface AiEvidence {
  metric: string;
  value: string | number;
  source: string;               // dataset/module the number came from
}

export interface AiInsight {
  finding: string;
  evidence: AiEvidence[];
  likelyCause: string;
  businessImpact: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  recommendedAction: string;
  priority: number;             // 1 = highest
  suggestedOwner: string;
  targetTimeframe: string;
  confidence: 'high' | 'medium' | 'low';
  assumptions: string[];
  dataLimitations: string[];
}

export interface AiChatResponse {
  answer: string;
  insights: AiInsight[];
  evidence: AiEvidence[];
  datasetId: number | null;
  governance: {
    passed: boolean;
    checks: { name: string; passed: boolean; detail?: string }[];
  };
  model: string;
  provider: string;
}

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

export type Role =
  | 'system_admin'
  | 'data_admin'
  | 'supply_chain_director'
  | 'supply_chain_manager'
  | 'inventory_manager'
  | 'warehouse_manager'
  | 'material_planner'
  | 'inventory_controller'
  | 'data_analyst'
  | 'auditor'
  | 'executive_viewer'
  | 'read_only';

export type Permission =
  | 'upload'
  | 'view_dataset'
  | 'edit_mapping'
  | 'approve_cleansing'
  | 'run_analysis'
  | 'view_financials'
  | 'use_ai'
  | 'export'
  | 'manage_users'
  | 'delete_dataset'
  | 'view_audit'
  | 'change_config';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  system_admin: [
    'upload', 'view_dataset', 'edit_mapping', 'approve_cleansing', 'run_analysis',
    'view_financials', 'use_ai', 'export', 'manage_users', 'delete_dataset',
    'view_audit', 'change_config',
  ],
  data_admin: [
    'upload', 'view_dataset', 'edit_mapping', 'approve_cleansing', 'run_analysis',
    'view_financials', 'use_ai', 'export', 'delete_dataset', 'view_audit',
  ],
  supply_chain_director: [
    'view_dataset', 'run_analysis', 'view_financials', 'use_ai', 'export', 'view_audit',
  ],
  supply_chain_manager: [
    'upload', 'view_dataset', 'edit_mapping', 'approve_cleansing', 'run_analysis',
    'view_financials', 'use_ai', 'export',
  ],
  inventory_manager: [
    'upload', 'view_dataset', 'edit_mapping', 'approve_cleansing', 'run_analysis',
    'view_financials', 'use_ai', 'export',
  ],
  warehouse_manager: [
    'upload', 'view_dataset', 'run_analysis', 'use_ai', 'export',
  ],
  material_planner: [
    'upload', 'view_dataset', 'edit_mapping', 'approve_cleansing', 'run_analysis',
    'use_ai', 'export',
  ],
  inventory_controller: [
    'view_dataset', 'run_analysis', 'use_ai', 'export',
  ],
  data_analyst: [
    'upload', 'view_dataset', 'edit_mapping', 'run_analysis', 'view_financials',
    'use_ai', 'export',
  ],
  auditor: ['view_dataset', 'view_audit', 'export'],
  executive_viewer: ['view_dataset', 'run_analysis', 'view_financials', 'use_ai'],
  read_only: ['view_dataset'],
};

export const ALL_ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];

// ---------------------------------------------------------------------------
// Shared API DTOs
// ---------------------------------------------------------------------------

export interface DatasetSummary {
  id: number;
  name: string;
  version: number;
  status: 'draft' | 'validated' | 'ready';
  kind: 'stock' | 'movements' | 'material_master' | 'physical_inventory';
  periodStart: string | null;
  periodEnd: string | null;
  rowCount: number;
  qualityScore: number | null;
  createdBy: string;
  createdAt: string;
}

export interface KpiValue {
  key: string;
  name: string;
  value: number;
  unit: string;
  trend?: number | null;
  status?: 'good' | 'warning' | 'critical' | 'neutral';
  definition: string;
  formula: string;
  source: string;
}
