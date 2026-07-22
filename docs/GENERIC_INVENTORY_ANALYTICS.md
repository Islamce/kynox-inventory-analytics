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

## Phased plan (honest status)

**Delivered now (engine foundation, additive, fully unit-tested):** canonical
model, date-normalization engine, quantity/direction classification engine
(incl. SAP adapter), generalized mapping synonyms, generalized DQ rules.

**Pending (require schema/UI/route changes and a further hardening pass — not
in this change):**
1. Persist `CanonicalTransaction`/material fields (migrations across SQLite/
   PostgreSQL/MySQL, backfill, rollback tests) and wire the engines into the
   upload → dataset pipeline.
2. Import preview UI (mapping/date/direction previews, user overrides, dataset-
   level rules) and Data Quality Center surfacing of the new issue codes.
3. Dashboard movement-category cards (receipts/consumption/transfers/returns/
   adjustments/reversals/unknown/date-parse errors/sign conflicts) and demand
   filters that exclude transfers/returns/reversals/adjustments by default.
4. Inventory reconciliation (opening + movements = closing) by material/
   warehouse/location/plant/batch/period, with transfer & reversal pairing.
5. AI wording generalization (source-neutral terminology; explain normalization
   and exclusions) within existing governance limits.

Acceptance criteria in §19 of the request that depend on the pending phases
(end-to-end generic upload through the UI, DB persistence, dashboard cards,
reconciliation) are **not yet met**; the engine foundation they build on is in
place and tested.
