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

- `@kynox/api`: **53** tests (5 in `normalization.test.ts`) — generic
  transaction import persists canonical rows + preserves the source row +
  excludes UNKNOWN from KPIs; ambiguous-date blocking then confirmed import;
  transactional rollback on canonical failure; SAP MB51 (numeric BWART)
  regression through the real PUT-mapping step; a generic file that collides
  with an SAP report-type shape stays correctly labeled non-SAP. Full
  monorepo: **180** tests green; build green.

## Import preview UI (started)

`apps/web/src/pages/Workspace.tsx` now surfaces the canonical normalization
result inline in the existing Upload → Detect → Map → Validate → Cleanse →
Approve → Analyze pipeline, using `GET /api/datasets/:id/normalization` and
`GET /api/datasets/:id/canonical`:

- **Ambiguous-date confirmation.** A genuinely ambiguous transaction-date
  column no longer surfaces as a raw 422 error — the Cleansing step shows a
  "Confirm the transaction date format" card (DD/MM/YYYY vs MM/DD/YYYY) that
  resubmits with the chosen `dateOrder`. Unambiguous files (SAP ISO dates,
  etc.) never see this step.
- **Transaction normalization preview**, shown once a movements dataset is
  created: source system / report type / date-format chips, a receipt /
  consumption / transfer / return / adjustment / reversal / unknown
  breakdown (unknown explicitly labeled as excluded from receipt/consumption
  KPIs), a sign/direction-conflict callout, the row-anchored normalization
  findings, and a filterable, exportable preview of the persisted
  `canonical_transactions` rows.

**A real correctness bug was found and fixed while manually testing this in a
browser** (not caught by the Phase 2 automated suite, which bypassed the real
pipeline): `classifySource()` treated report-type *shape* (material +
posting_date + quantity) as SAP evidence, so a purely generic file could be
mislabeled `Source: SAP`. Separately, `PUT /uploads/:id/mapping` — called by
the UI every time the user confirms mapping, even for untouched columns — was
unconditionally stamping every column `method: 'user'`, which erased the
`sap_technical` provenance real SAP imports rely on before dataset creation
ever ran. Both are fixed: SAP is now only inferred from an explicit hint or an
actual `sap_technical`-mapped column, and the mapping PUT only re-stamps
columns the user actually changed. Per-row transaction classification itself
was correct in both directions throughout (the generic keyword classifier was
always the fallback), so this was a labeling/traceability bug, not a
data-correctness one — but it would have made every SAP import through the
real UI look non-SAP for source-classification purposes. Regression tests
added for both.

**Not yet done from this increment:** a richer date/direction preview *before*
dataset creation (currently the preview appears after creation, since
blocking/preview both run through the same `POST /api/datasets` call), and
full user override of individual row classifications. (Both were delivered in
a later increment — see below.)

## Data Quality Center surfacing (delivered)

`apps/web/src/pages/Quality.tsx` fetches `GET /api/datasets/:id/normalization`
for movements datasets and renders a "Transaction normalization findings"
card alongside the existing row-quality findings: source system, normalized/
rejected/warning/unknown row counts, and the full row-anchored findings list
(date, sign, direction and classification issues) — separate from, and
additive to, the pre-existing quality-rule findings.

## Dashboard movement-category cards + demand filters (delivered)

`apps/web/src/pages/Dashboard.tsx` adds a "Transaction categories" section
(shown when a movements dataset with canonical data is linked): a
receipt/consumption/transfer/return/adjustment/reversal/unknown breakdown
sourced from `GET /api/datasets/:id/normalization`, and a filterable,
exportable transaction browser sourced from `GET /api/datasets/:id/canonical`
with a **"Demand view" default** that hides transfers, returns, adjustments
and reversals (they are internal movement, not external demand or supply) —
an "All transactions" toggle shows everything. This is purely additive
read-only display; no existing KPI calculation (position, aging, ABC/XYZ,
shortage, excess, consumption, health) was touched.

**Honest scope note:** the *existing* consumption/ABC/XYZ/shortage/excess/
health analytics still compute demand from the legacy `movements` table via
SAP-specific movement-type heuristics (`loadMovementsByMaterial` in
`services/analytics.ts`), not from `canonical_transactions`. Rewiring those to
the canonical, source-neutral model is architecturally the right long-term
direction (the platform's own stated goal), but doing so changes the actual
computed numbers for every movements dataset — in particular, the legacy path
explicitly *subtracts* issue reversals from consumption, while the canonical
model's `REVERSAL_IN`/`REVERSAL_OUT` categories are separate from
`CONSUMPTION` by design. Reconciling that semantic difference is a real
analytical decision, not a display change, and was deliberately left out of
this increment rather than silently altering already-reconciled UAT numbers.

## Inventory reconciliation (delivered, v1 scope)

New `apps/api/src/services/reconciliation.ts` + `GET
/api/analytics/reconciliation/:movementsDatasetId?stockDatasetId=` + a new
**Inventory Reconciliation** page (`apps/web/src/pages/Reconciliation.tsx`),
computed entirely from `canonical_transactions` (never SAP movement types):
opening (from `OPENING_BALANCE` rows, else 0) + receipts + consumption +
transfer/return/adjustment/reversal/unknown net = computed closing quantity,
per material, optionally compared against a linked stock dataset's current
quantity to surface a variance.

**Honest scope limits, stated in the UI itself:**
- Transfer/reversal pairing is document-level (see "Document-level
  transfer/reversal pairing" below), first within the import and then against
  older imports in the same company/user scope. Legitimate misses are reported
  as low-severity findings, not treated as errors.
- Variance against a linked stock dataset is only meaningful when the
  movements dataset's period covers the material's full history since stock
  was last a known value (an explicit opening balance, or genuinely zero);
  otherwise it is informational, not a defect report.
- A dataset created before this normalization engine existed has no canonical
  rows; the endpoint honestly reports `available: false` rather than
  fabricating a reconciliation.

## AI wording generalization + normalization evidence (delivered)

The AI agent system prompts (`packages/ai-engine/src/agents.ts`) were already
fully source-neutral — no SAP-specific terminology was found on review. The
concrete gap was that the AI's evidence package never included any Phase 2
normalization data, so it could not explain *why* a transaction was excluded
or "unknown" even though the underlying data existed. `apps/api/src/routes/ai.ts`
now adds `unknown_transaction_rows` / `sign_conflicts` / `direction_conflicts`
metrics and a `transactionNormalization` finding (source system, category
breakdown, an explicit exclusion note, and top severity findings) to the
evidence package whenever a movements dataset with canonical data is linked.
The Data Quality Agent's intents and system prompt were extended to route and
answer these questions from real evidence — the AI still never computes a
number itself; it only interprets deterministically-computed evidence, per
existing governance.

## Document-level transfer/reversal pairing (delivered)

`pairTransfersAndReversals()` in `apps/api/src/services/normalization.ts`
matches unclaimed `TRANSFER_OUT`↔`TRANSFER_IN` canonical rows on
material + exact absolute quantity + closest date and assigns them a shared
`transfer_id` and stable canonical-row `paired_transaction_id`; `REVERSAL_IN`/
`REVERSAL_OUT` rows are matched to the most recent qualifying
`RECEIPT`/`CONSUMPTION` row (same material + quantity, original date on or
before the reversal date) and stamped with `reversal_of_transaction_id`.
Unmatched rows produce low-severity, non-blocking
`TRANSFER_PAIR_NOT_FOUND` / `REVERSAL_ORIGINAL_NOT_FOUND` findings — a miss is
reported honestly rather than silently ignored. Matching is scoped to a single
dataset (both legs must be in the same import); cross-dataset pairing is not
attempted. `apps/api/src/services/reconciliation.ts` now reports
`unpairedTransferRows` / `unpairedReversalRows` per material and
`materialsWithUnpairedTransfers` / `materialsWithUnpairedReversals` in the
summary, surfaced in the Inventory Reconciliation page.

## Manual per-row classification override (delivered)

`PATCH /api/datasets/:id/canonical/:canonicalId` (permission: `edit_mapping`,
IDOR-safe — the row is looked up scoped to `{ id, dataset_id }`) lets a user
correct a single canonical row's `transaction_category`. The handler
recomputes `transaction_direction`, `signed_quantity`,
`receipt_quantity`/`consumption_quantity` from the corrected category, marks
`classification_source: 'user_rule'`, clears any stale sign/direction-conflict
flags, and recomputes the dataset's `normalization_summary` from the current
row set — all inside one DB transaction so the row and the dataset-level
aggregates never drift apart. Audited as `canonical_reclassified`. The
Dashboard's "Transaction categories" browser (`Dashboard.tsx`) exposes this as
an inline category `<select>` per row.

## Import-time preview before dataset creation (delivered)

`POST /api/datasets/preview` runs the exact same `prepareImport()` pipeline
(mapping → cleansing → quality scoring → canonical normalization) that
`POST /api/datasets` uses, but never writes to the database — it reports row
counts, quality scores, whether creation would still be blocked by remaining
critical issues, and the full normalization summary/findings, including
`ambiguousDatesNeedConfirmation`. `Workspace.tsx` adds a "Preview
normalization" button in the Cleansing step (movements datasets only): it
shows the category/direction breakdown and findings inline, and — when the
date column is genuinely ambiguous — an inline DD/MM/YYYY vs MM/DD/YYYY picker
that resolves the preview *and* carries the chosen order through to "Apply
approved cleansing" automatically, so the user never has to make the same
choice twice. The reactive post-422 picker from the previous increment is kept
as a fallback for anyone who skips the preview button. A test asserts preview
output and actual creation output agree exactly, and that preview never
persists a row.

## Testing evidence (previous sub-increment)

`@kynox/api` **66** tests (+8 since the prior increment: 2 transfer/
reversal pairing, 3 manual override, 3 import-time preview — including the
preview-equals-creation equality check and an unauthenticated/cross-dataset
IDOR check). Full monorepo: **193** tests green; typecheck and build clean.
All features verified in a real browser (Playwright/Chromium): light, dark
and a 390px mobile viewport, no horizontal overflow — including the new
inline preview panel and its ambiguous-date picker.

## Consumption/ABC/XYZ/shortage/excess/health rewired to the canonical model (delivered)

This was previously listed as "still pending" because it is an explicit
architectural decision (reconciling reversal semantics between the legacy
heuristic and the canonical model) rather than a mechanical change — it was
raised as a question and the user chose to proceed with the rewire.

`loadMovementsByMaterial()` in `apps/api/src/services/analytics.ts` (the
single aggregation function feeding consumption, ABC (consumption-value
metric), XYZ, excess, shortage and health analytics) now prefers
`canonical_transactions` when the dataset has canonical rows (every dataset
imported since the Phase 2 normalization engine shipped): demand is
`DEMAND_CATEGORIES` — `CONSUMPTION` only, per `@kynox/shared-types` — and
`REVERSAL_IN`/`REVERSAL_OUT` are tracked separately and intentionally **not**
netted against consumption, unlike the legacy path. Datasets imported before
the canonical engine existed (no canonical rows) fall back unchanged to the
legacy `movements` table + SAP movement-type heuristic (renamed
`loadLegacyMovementsByMaterial`, logic untouched), so old datasets keep
producing the numbers they always did. The function's return type and every
call site (`abcAnalysis`, `xyzAnalysis`, `movementCategoryAnalysis`,
`excessAnalysis`, `shortageAnalysis`, `healthAnalysis`, `consumptionAnalysis`,
`forecastAnalysis`, `planningProposal`) are unchanged — the rewire is
entirely inside the aggregation function.

**A real, independent classification bug was found and fixed while verifying
this rewire against a realistic SAP movement fixture** (friendly column
headers like "Movement Type" rather than raw SAP technical names like
`BWART`): `classifyTransaction()`'s numeric SAP movement-type lookup
(`sapMovementTypeCategory`, e.g. `201` → `CONSUMPTION`, `101` → `RECEIPT`) was
only attempted when the *dataset* had already been labelled `sourceSystem:
'SAP'` — a deliberately conservative determination from an earlier increment
requiring an explicit hint or a real `sap_technical`-mapped column. Numeric
movement-type codes are unambiguous evidence on their own regardless of that
display label, so every row of a real SAP movement file that used friendly
headers was silently classified `UNKNOWN` — zero consumption, zero receipts,
even though the legacy `movements` table (used before this rewire) parsed the
same codes correctly via its own hardcoded set. Fixed by decoupling the
numeric lookup from the `sourceSystem` label in
`apps/api/src/services/normalization.ts`: the lookup is now always attempted
first (it can only ever match one of a small set of exact known codes, so it
cannot misfire on generic text), while `sourceSystem` labelling itself is
completely unchanged. Existing SAP-source-labelling regression tests still
pass unmodified.

**Test semantics updated to match the new, intended behaviour** (not a
regression): `pipeline.test.ts`'s reversal test previously asserted the
legacy net-of-reversal number (100 − 60 + 40 = 80); it now asserts the
canonical number (100 + 40 = 140, reversal tracked separately) and explicitly
checks the canonical row categories.

## Testing evidence (this increment)

`@kynox/api` **68** tests (2 cross-import pairing tests added after the
canonical rewire: successful matching plus company/time-boundary rejection).
Full monorepo: **195** tests green; typecheck and build clean. Verified in a
real browser (Playwright/Chromium) against a realistic
movements fixture (friendly headers + numeric movement-type codes, including
a reversal and a transfer): Executive Dashboard, ABC-XYZ Analysis,
Consumption Analytics, Inventory Reconciliation and Material 360 all render
correct canonical-derived numbers in light, dark and a 390px mobile viewport,
no horizontal overflow, no console/page errors. Stale UI copy referencing
"SAP issue-reversal semantics already applied" on the Consumption Analytics
page was corrected to describe the actual (source-neutral) behaviour.

## Still pending (future work, honestly scoped)

None from the original "still pending" list — all four items (document-level
transfer/reversal pairing, manual per-row override, import-time preview, and
the canonical-model rewire) have been delivered. Real gaps that remain,
found along the way rather than planned:

1. The numeric SAP movement-type lookup fix only helps when a movement-type
   *column* is present and mapped; a file with neither recognisable type text
   nor a numeric SAP code still classifies as `UNKNOWN` by design (no data to
   infer from) rather than guessing from quantity sign — that is intentional,
   not a gap, but worth knowing when investigating an unexpectedly high
   `UNKNOWN` count.
2. Cross-import transfer/reversal pairing is now supported within a strict
   tenant boundary: matching uses the dataset company when present, otherwise
   the creating user. Only exact material + absolute-quantity matches with a
   compatible unit are eligible; transfers must be within 31 days, while
   reversals require an unclaimed original on or before the reversal date.
   Ambiguous or absent matches remain visibly unpaired rather than being
   guessed.
