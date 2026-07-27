/**
 * Source-independent canonical inventory model.
 *
 * The analytics engine is being generalised beyond SAP: it consumes these
 * canonical, source-neutral records rather than SAP-specific column names or
 * movement types. Source-specific interpretation (SAP movement types, Oracle
 * transaction codes, …) lives in per-source adapters that emit these shapes.
 *
 * These types are ADDITIVE — they do not replace the existing StockRow /
 * MovementRow / MaterialMasterRow contracts, which remain fully supported.
 */

// ---------------------------------------------------------------------------
// Source classification
// ---------------------------------------------------------------------------

/** The originating system family a dataset came from. */
export type SourceSystem =
  | 'SAP'
  | 'ORACLE'
  | 'MICROSOFT_DYNAMICS'
  | 'ODOO'
  | 'GENERIC_ERP'
  | 'WMS'
  | 'MANUAL'
  | 'UNKNOWN';

/**
 * Concrete source report classification. SAP report types remain first-class;
 * generic classifications let any ERP / WMS / file be imported without first
 * matching a known template.
 */
export type SourceReportType =
  | 'SAP_MB51'
  | 'SAP_MB52'
  | 'SAP_MB5B'
  | 'SAP_MMBE'
  | 'SAP_MATERIAL_MASTER'
  | 'SAP_PHYSICAL_INVENTORY'
  | 'ORACLE_INVENTORY'
  | 'MICROSOFT_DYNAMICS'
  | 'ODOO_INVENTORY'
  | 'GENERIC_ERP_TRANSACTION'
  | 'GENERIC_INVENTORY_BALANCE'
  | 'GENERIC_MATERIAL_MASTER'
  | 'GENERIC_PHYSICAL_INVENTORY'
  | 'UNKNOWN_SOURCE';

// ---------------------------------------------------------------------------
// Transaction direction & category
// ---------------------------------------------------------------------------

/** Net inventory effect of a transaction, independent of the raw sign. */
export type TransactionDirection = 'IN' | 'OUT' | 'NEUTRAL' | 'UNKNOWN';

/**
 * Source-neutral movement classification. Unknown movements are NEVER forced
 * into RECEIPT or CONSUMPTION — they stay visible as UNKNOWN.
 */
export type TransactionCategory =
  | 'RECEIPT'
  | 'CONSUMPTION'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'RETURN_IN'
  | 'RETURN_OUT'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'OPENING_BALANCE'
  | 'CLOSING_BALANCE'
  | 'STOCK_COUNT'
  | 'RESERVATION'
  | 'BLOCKED_STOCK'
  | 'QUALITY_INSPECTION'
  | 'REVERSAL_IN'
  | 'REVERSAL_OUT'
  | 'NEUTRAL'
  | 'UNKNOWN';

/** Direction/category IN vs OUT lookup (NEUTRAL / UNKNOWN excluded). */
export const CATEGORY_DIRECTION: Record<TransactionCategory, TransactionDirection> = {
  RECEIPT: 'IN',
  TRANSFER_IN: 'IN',
  RETURN_IN: 'IN',
  ADJUSTMENT_IN: 'IN',
  OPENING_BALANCE: 'IN',
  REVERSAL_IN: 'IN',
  CONSUMPTION: 'OUT',
  TRANSFER_OUT: 'OUT',
  RETURN_OUT: 'OUT',
  ADJUSTMENT_OUT: 'OUT',
  CLOSING_BALANCE: 'OUT',
  REVERSAL_OUT: 'OUT',
  STOCK_COUNT: 'NEUTRAL',
  RESERVATION: 'NEUTRAL',
  BLOCKED_STOCK: 'NEUTRAL',
  QUALITY_INSPECTION: 'NEUTRAL',
  NEUTRAL: 'NEUTRAL',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Categories counted as operational demand for consumption analytics.
 * Transfers, returns-to-supplier, reversals, adjustments and neutral / unknown
 * movements are excluded unless the user explicitly opts them in.
 */
export const DEMAND_CATEGORIES: TransactionCategory[] = ['CONSUMPTION'];

/** How a classification decision was reached (for traceability). */
export type ClassificationSource =
  | 'explicit_direction_field'
  | 'receipt_issue_indicator'
  | 'transaction_type'
  | 'separate_quantity_columns'
  | 'debit_credit_indicator'
  | 'quantity_sign'
  | 'balance_reconciliation'
  | 'source_adapter'
  | 'user_rule'
  | 'unknown';

// ---------------------------------------------------------------------------
// Canonical transaction record
// ---------------------------------------------------------------------------

export interface CanonicalTransaction {
  sourceSystem: SourceSystem;
  sourceReportType: SourceReportType;
  sourceFileName: string;
  sourceSheetName: string | null;
  sourceRowNumber: number;

  organizationId: string | null;
  datasetId: number | null;
  transactionId: string | null;
  referenceDocument: string | null;
  referenceLine: string | null;

  materialId: string;
  materialDescription: string | null;
  materialGroup: string | null;
  materialType: string | null;
  batchNumber: string | null;
  serialNumber: string | null;

  warehouseId: string | null;
  warehouseName: string | null;
  locationId: string | null;
  locationName: string | null;
  plantId: string | null;
  plantName: string | null;
  siteId: string | null;
  siteName: string | null;
  businessUnit: string | null;

  transactionDate: string | null;   // ISO YYYY-MM-DD (system of record)
  postingDate: string | null;
  documentDate: string | null;
  fiscalPeriod: string | null;

  quantity: number | null;          // interpreted quantity
  rawQuantity: string | number | null;   // exactly as imported
  absoluteQuantity: number | null;
  signedQuantity: number | null;    // + increases stock, − decreases
  unitOfMeasure: string | null;

  transactionDirection: TransactionDirection;
  transactionCategory: TransactionCategory;
  transactionTypeCode: string | null;
  transactionTypeDescription: string | null;

  unitCost: number | null;
  transactionValue: number | null;
  currency: string | null;

  openingQuantity: number | null;
  closingQuantity: number | null;
  stockStatus: string | null;
  specialStockType: string | null;

  classificationSource: ClassificationSource;
  classificationConfidence: number;   // 0..1

  /** The full original row, preserved for audit/traceability. */
  originalSourceRecord: Record<string, unknown>;
  normalizationWarnings: string[];
  createdAt: string;                   // ISO timestamp
}

// ---------------------------------------------------------------------------
// Canonical material master (non-SAP terminology supported)
// ---------------------------------------------------------------------------

export interface CanonicalMaterialMaster {
  materialId: string;
  materialDescription: string | null;
  alternateMaterialId: string | null;
  sku: string | null;
  itemCode: string | null;
  partNumber: string | null;
  materialGroup: string | null;
  category: string | null;
  subcategory: string | null;
  materialType: string | null;
  baseUnit: string | null;
  purchasingUnit: string | null;
  issueUnit: string | null;
  valuationClass: string | null;
  unitCost: number | null;
  standardCost: number | null;
  movingAverageCost: number | null;
  currency: string | null;
  leadTimeDays: number | null;
  reorderPoint: number | null;
  safetyStock: number | null;
  minimumStock: number | null;
  maximumStock: number | null;
  storageCondition: string | null;
  shelfLifeDays: number | null;
  preferredWarehouse: string | null;
  activeStatus: boolean | null;
  sourceSystem: SourceSystem;
  originalSourceRecord: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Mapping confidence detail (import preview)
// ---------------------------------------------------------------------------

export type ConfidenceBand = 'high' | 'medium' | 'low';

/** High: 0.90–1.00 · Medium: 0.70–0.89 · Low: < 0.70. */
export function confidenceBand(score: number): ConfidenceBand {
  if (score >= 0.9) return 'high';
  if (score >= 0.7) return 'medium';
  return 'low';
}

export interface MappingDetail {
  originalColumnName: string;
  detectedCanonicalField: string | null;
  confidenceScore: number;             // 0..1
  detectionMethod: string;
  sampleValues: unknown[];
  alternativeMappings: { field: string; confidence: number }[];
  userConfirmed: boolean;
  validationWarnings: string[];
}

// ---------------------------------------------------------------------------
// Date normalization
// ---------------------------------------------------------------------------

export type DetectedDateFormat =
  | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD-MM-YYYY' | 'MM-DD-YYYY'
  | 'YYYY-MM-DD' | 'YYYY/MM/DD' | 'DD.MM.YYYY' | 'MM.DD.YYYY' | 'YYYY.MM.DD'
  | 'YYYYMMDD' | 'DDMMYYYY' | 'MMDDYYYY'
  | 'EXCEL_SERIAL' | 'ISO_TIMESTAMP' | 'ISO_TIMESTAMP_TZ' | 'UNIX_TIMESTAMP'
  | 'TEXT_MONTH' | 'UNKNOWN';

export type DateParsingStatus = 'parsed' | 'ambiguous' | 'invalid' | 'empty' | 'out_of_range';

export interface NormalizedDate {
  originalDateValue: string | number | null;
  normalizedDate: string | null;       // ISO YYYY-MM-DD, or full ISO for date-time
  detectedDateFormat: DetectedDateFormat;
  dateParsingStatus: DateParsingStatus;
  dateParsingConfidence: number;        // 0..1
  timezoneDetected: string | null;
  parsingWarnings: string[];
  sourceRowNumber: number | null;
  sourceColumnName: string | null;
}

// ---------------------------------------------------------------------------
// Data-quality issue codes introduced by the generalisation work
// ---------------------------------------------------------------------------

export type NormalizationIssueCode =
  | 'INVALID_DATE'
  | 'AMBIGUOUS_DATE_FORMAT'
  | 'MIXED_DATE_FORMATS'
  | 'OUT_OF_RANGE_DATE'
  | 'FUTURE_DATE_WARNING'
  | 'MISSING_TRANSACTION_DATE'
  | 'INVALID_EXCEL_DATE_SERIAL'
  | 'DATE_TIMEZONE_CONFLICT'
  | 'DATE_COLUMN_MAPPING_LOW_CONFIDENCE'
  | 'SIGN_CONFLICT'
  | 'DIRECTION_CONFLICT'
  | 'MISSING_QUANTITY'
  | 'INVALID_QUANTITY'
  | 'UNKNOWN_TRANSACTION_TYPE'
  | 'SIMULTANEOUS_RECEIPT_AND_CONSUMPTION'
  | 'LOW_CONFIDENCE_COLUMN_MAPPING'
  | 'LOW_CONFIDENCE_DIRECTION_CLASSIFICATION'
  | 'MISSING_MATERIAL_ID'
  | 'MISSING_WAREHOUSE'
  | 'TRANSFER_PAIR_NOT_FOUND'
  | 'REVERSAL_ORIGINAL_NOT_FOUND'
  | 'OPENING_CLOSING_BALANCE_CONFLICT';

/** A precise, row-anchored normalization finding for the Data Quality Center. */
export interface NormalizationIssue {
  code: NormalizationIssueCode;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  fileName: string | null;
  sheetName: string | null;
  datasetId: number | null;
  rowNumber: number | null;
  columnName: string | null;
  originalValue: unknown;
  parsedValue: unknown;
  normalizedValue: unknown;
  explanation: string;
  recommendedCorrection: string;
  confidenceScore: number;             // 0..1
  classificationSource: ClassificationSource | null;
  blocksImport: boolean;
  userActionRequired: boolean;
}
