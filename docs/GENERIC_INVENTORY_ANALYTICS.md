# Generalized Inventory & Materials Analytics — Architecture

The platform is being generalized from an SAP-centric tool into a
**source-independent** inventory & materials analytics platform. SAP remains a
first-class source; it becomes **one adapter among many** (Oracle, Dynamics,
Odoo, generic ERP, WMS, CSV/Excel, manual reports).

This document describes the engine foundation delivered in this change and the
phased plan for the remaining wiring. It is honest about what is implemented
vs pending.

## Layered ingestion → analytics architecture

```
Source Detection → Smart Column Mapping → Source Adapter →
Canonical Normalization → Data-Quality Validation → Cleansing →
Persistence → Analytics Engine → AI Insights → Reporting/Export
```

- The **analytics engine consumes canonical, source-neutral records** — never
  SAP column names or movement types directly.
- **Source-specific rules live in adapters.** SAP `BWART` movement-type codes
  are mapped inside the SAP adapter (`sapMovementTypeCategory`) and are *not*
  baked into the generic classifier or the analytics calculations.

## Canonical model (`@kynox/shared-types`)

Added in `packages/shared-types/src/canonical.ts` (additive — the existing
`StockRow` / `MovementRow` / `MaterialMasterRow` contracts are unchanged):

- **`CanonicalTransaction`** — a source-independent transaction record
  (material, warehouse/location/plant/site, dates, `signedQuantity`,
  `transactionDirection`, `transactionCategory`, cost/value, opening/closing,
  classification provenance, **`originalSourceRecord`** for full traceability,
  `normalizationWarnings`).
- **`CanonicalMaterialMaster`** — non-SAP terminology supported (`sku`,
  `itemCode`, `partNumber`, `category`, costs, lead time, reorder/safety, …);
  SAP fields (MATNR/WERKS/MEINS/PLIFZ) are mapped when present but **not
  required**.
- Enums: `SourceSystem`, `SourceReportType` (SAP_* + GENERIC_* + UNKNOWN_SOURCE),
  `TransactionDirection` (IN/OUT/NEUTRAL/UNKNOWN), `TransactionCategory`
  (18 categories incl. transfers, returns, adjustments, reversals, opening/
  closing, unknown), `ClassificationSource`.
- `MappingDetail` + `confidenceBand()` (High ≥0.90 · Medium 0.70–0.89 · Low <0.70).
- `NormalizedDate` and `NormalizationIssue` (+ `NormalizationIssueCode`).

## Date normalization engine (`@kynox/data-quality/date-normalization`)

- Detects and normalizes: `YYYY-MM-DD`, `YYYY/MM/DD`, `YYYY.MM.DD`,
  `DD/MM/YYYY`, `MM/DD/YYYY`, `DD-MM-YYYY`, `MM-DD-YYYY`, `DD.MM.YYYY`,
  `YYYYMMDD`, `DDMMYYYY`/`MMDDYYYY`, **Excel serials** (number & text),
  **ISO timestamps** (with/without timezone), and **textual months**
  (English + common Arabic Gregorian month names).
- **Internal system of record is ISO** (`YYYY-MM-DD`, or full ISO 8601 for
  date-times). **UI default display is `DD/MM/YYYY`** via the centralized
  `formatDisplayDate()` — storage is never a localized display string.
- **Ambiguity is resolved from the whole column**, not a single value:
  `detectColumnDateFormat()` uses any value where a component > 12 to fix the
  day/month order. When the column is fully ambiguous it is **not silently
  guessed** — the value is marked `ambiguous`, surfaced to the Data Quality
  Center, and blocks approval until the user selects the order.
- **Mixed formats** in one column are detected and reported; valid rows are
  still parsed individually.
- A normal numeric quantity (e.g. `25`) is **not** treated as a date.
- Every result preserves `originalDateValue`, `detectedDateFormat`,
  `dateParsingStatus`, `dateParsingConfidence`, `timezoneDetected` and
  `parsingWarnings`.

## Transaction classification engine (`@kynox/data-quality/transaction-classification`)

Determines **direction, category and canonical signed quantity** with an
explicit priority ladder — **never quantity sign alone**:

1. explicit direction field → 2. receipt/issue indicator →
3. transaction/movement type → 4. separate receipt/consumption columns →
5. debit/credit indicator → 6. quantity sign → 7. opening/closing
reconciliation → 8. source adapter → 9. user rule → 10. UNKNOWN.

- **Sign normalization:** stock increase → positive, decrease → negative,
  neutral → zero, unknown → preserved & flagged. Positive *unsigned*
  consumption with `OUT` → `-qty`; negative *receipt reversal* → stock-
  decreasing `REVERSAL_OUT` (not consumption).
- **Transfers** are their own categories (`TRANSFER_IN/OUT`) and excluded from
  operational demand. **Returns**, **adjustments** and **reversals** are
  separated, never merged into receipts/consumption.
- **Unknown types stay `UNKNOWN`** and visible — never forced into
  receipt/consumption.
- **Separate receipt/consumption columns** → receipts positive, consumption
  negative; both populated on one row is **flagged, never netted**
  (`SIMULTANEOUS_RECEIPT_AND_CONSUMPTION`).
- **SAP adapter** (`sapMovementTypeCategory`) maps `BWART` codes (101/261/311/
  202/262/…) to canonical categories — kept out of the generic engine.
- Conflicts are surfaced: `signConflict`, `directionConflict`, and a
  `classificationSource` + `classificationConfidence` on every result.

## Generalized smart mapping (`apps/api/services/mapping.ts`)

Synonyms expanded (additively — all SAP technical names & Arabic variants
preserved) so generic files map without SAP columns: e.g. Item Code / SKU /
Product Code / Part Number → `material`; Transaction/Movement/Entry Date →
`posting_date`; Transaction Type / Activity / Operation → `movement_type`;
Received/Issued/In/Out Qty → `receipt_qty`/`issue_qty`; Direction / Debit-Credit
→ `transaction_direction`. Detection still returns `UNKNOWN` gracefully and the
user can always override — a file does **not** need to match a template to import.

## Generalized data-quality rules (`normalization-rules.ts`)

Row-anchored, specific findings (never "invalid data"): `INVALID_DATE`,
`AMBIGUOUS_DATE_FORMAT`, `MIXED_DATE_FORMATS`, `OUT_OF_RANGE_DATE`,
`FUTURE_DATE_WARNING`, `MISSING_TRANSACTION_DATE`, `SIGN_CONFLICT`,
`DIRECTION_CONFLICT`, `UNKNOWN_TRANSACTION_TYPE`, `MISSING_QUANTITY`,
`SIMULTANEOUS_RECEIPT_AND_CONSUMPTION`, `LOW_CONFIDENCE_COLUMN_MAPPING`,
`LOW_CONFIDENCE_DIRECTION_CLASSIFICATION`, `DATE_COLUMN_MAPPING_LOW_CONFIDENCE`.
Each finding carries file/sheet/row/column, original + normalized value,
explanation, recommended correction, confidence, whether it blocks import and
whether user action is required.

## Backward compatibility

- SAP detection (MB51/MB52/MB5B/MMBE/material master/physical inventory) and
  the existing SAP reversal/transfer analytics are **unchanged** — all existing
  API tests remain green (48/48).
- The canonical model and engines are **additive**; no existing type, route,
  schema, migration or DB configuration was changed.

## Testing evidence

- `@kynox/data-quality`: **58** tests (43 new) — date formats, ambiguity
  (Scenarios D/E), mixed formats, Excel serials, sign/direction (Scenarios
  F/G/H/I), SAP adapter, and the new DQ rules.
- `@kynox/api`: **48** tests (4 new) — generic mapping (Scenario A) + SAP
  mapping regression.
- Full monorepo: build green; 175 tests passing.

## Phase 2 — persistence, migrations & pipeline wiring (delivered)

The Phase 1 engines are now wired into the **real** upload → validate → dataset
sequence and their output is **persisted**, additively and transactionally.

### Schema (`20260722000003_canonical_normalization.js`)

- New **`canonical_transactions`** table: the source-neutral, signed, classified
  transaction record. Columns include material/warehouse/location/plant, the
  three canonical dates, `raw_quantity` (preserved as text) + parsed/absolute/
  signed/receipt/consumption quantities, `transaction_direction`,
  `transaction_category`, classification provenance
  (`classification_source`/`classification_confidence`), `sign_conflict`/
  `direction_conflict`, `normalization_warnings` (JSON), and
  **`original_source_record`** (JSON of the mapped source row, for full
  traceability). Indexed on `dataset_id` and the common analytics composites
  (material / date / category / direction / source row).
- New **nullable** `datasets` columns for dataset-level normalization metadata:
  `source_system`, `source_report_type`, `normalization_status/version`,
  `import_locale`, `detected/selected_date_format`, `date_format_confidence`,
  `date_format_user_confirmed`, `total_source_rows`, `normalized_rows`,
  `rejected_rows`, `warning_rows`, `unknown_transaction_rows`,
  `normalization_summary` (JSON) and `normalization_findings` (JSON).

Only portable Knex column types are used (string / integer / double / date /
datetime / boolean / text), matching the existing schema; JSON lives in `text`
columns. `up` and `down` are both exercised (migrate → rollback → re-migrate)
on SQLite in the dev cycle and on **PostgreSQL 16** and **MySQL 8.4** in CI.

### Ingestion wiring (`apps/api/services/normalization.ts`)

`buildNormalization()` is pure/in-memory: it reuses `classifyTransaction`,
`normalizeDateColumn`, `dateIssues` and `classificationIssues` to produce the
`canonical_transactions` rows, a dataset-level **summary** (category/direction
counts, receipt/consumption/transfer/return/adjustment/reversal/unknown rows,
sign & direction conflicts, date-format decision) and the row-anchored
findings. The dataset route persists the canonical rows **inside the same
transaction** that creates the dataset, chunked — so a canonical failure rolls
the whole dataset back (no partially-active dataset). The existing per-kind
tables (movements/stock/…) and all SAP analytics are untouched.

- **SAP stays first-class:** for SAP sources the SAP adapter
  (`sapMovementTypeCategory`) classifies the numeric `BWART`; the generic text
  classifier is the fallback so a generic file the detector labelled
  "movements" still classifies from its type text.
- **Ambiguous dates block activation:** genuine DD/MM vs MM/DD ambiguity is
  judged from the **raw** column (before the "normalize dates" cleansing action
  rewrites values to ISO) and returns **HTTP 422** until the client re-submits
  with `dateOrder: "DMY" | "MDY"`. Unambiguous files (e.g. SAP ISO dates) are
  never blocked.
- **Unknown transactions** stay `UNKNOWN` and visible, and are **excluded** from
  the receipt/consumption KPIs — never forced in.

### Read APIs (for a future import UI)

- `GET /api/datasets/:id/normalization` — dataset-level source/date metadata,
  summary and findings.
- `GET /api/datasets/:id/canonical` — paginated canonical transactions with
  optional `material` / `category` / `direction` filters.

Both require `view_dataset` and return structured JSON (no internal SQL).

### Testing evidence (Phase 2)

- `@kynox/api`: **52** tests (4 new in `normalization.test.ts`) — generic
  transaction import persists canonical rows + preserves the source row +
  excludes UNKNOWN from KPIs; ambiguous-date blocking then confirmed import;
  transactional rollback on canonical failure; SAP MB51 (numeric BWART)
  regression. Full monorepo: **179** tests green; build green.

## Still pending (future phases)

1. Import preview UI (mapping/date/direction previews, user overrides) and Data
   Quality Center surfacing of the new issue codes.
2. Dashboard movement-category cards and demand filters that exclude transfers/
   returns/reversals/adjustments by default.
3. Inventory reconciliation (opening + movements = closing) with transfer &
   reversal pairing.
4. AI wording generalization (source-neutral terminology) within governance
   limits.

These require UI/dashboard work and are not part of Phase 2 (persistence &
pipeline wiring).
