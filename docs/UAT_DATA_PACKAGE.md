# Staging UAT Data Package

Location: `uat-data/` (fully synthetic and anonymized — every material, vendor,
user and description is invented; formats mirror real SAP exports).
Regenerate deterministically with `node scripts/generate-uat-data.js`.

## Files and minimum required fields

| File | Report | Minimum required fields | Rows |
|---|---|---|---|
| `MB52-stock.csv` | MB52 warehouse stock | Material, Unrestricted (or Quantity); recommended: Plant, SLoc, Value, Blocked, Quality, Safety Stock, Reorder Point, Max Stock, Lead Time, Last Movement | 34 |
| `MB51-movements.csv` | MB51 material documents | Material, Qty in unit of entry, Posting Date; recommended: Movement Type, Amount, Document, Plant, Cost Center | 481 |
| `MB5B-historical-stock.csv` | MB5B stock on posting date | Material, Posting Date, Quantity | 60 |
| `MMBE-stock-overview.csv` | MMBE breakdown | Material, Unrestricted; recommended: Blocked, Quality, In Transit | 30 |
| `material-master.csv` | Material master (SAP technical headers MATNR/MAKTX/…) | MATNR; recommended: MTART, MATKL, MEINS, STPRS, EISBE, MINBE, MABST, PLIFZ | 30 |
| `physical-inventory.csv` | PI count documents | Material, Book Quantity, Counted Quantity | 15 |
| `MD04-requirements.csv` | Requirements/supply (optional) | Material, Requirement Quantity | 16 |

Coverage: **2 plants** (P100, P200), **3 storage locations**, one declared
currency (SAR), a **multi-unit conflict** material, **returns/reversals**
(202), **transfers** (311), **blocked + quality stock**, EA and KG units,
EU-format numbers, an SAP-technical-header file and Arabic-header coverage via
the automated tests.

## Scenario materials and expected UAT outcomes

| Material | Scenario | Expected outcome after import + analysis |
|---|---|---|
| UAT-0001…0010 | Active consumers, monthly issues | Category `active`; ABC classes spread by value; XYZ = X for steady consumers |
| UAT-0011, UAT-0012 | Rare issues (every 6 months), old last-issue | Category **slow_moving** with the reason string naming the threshold |
| UAT-0013, UAT-0014 | No issues since Mar 2025 | Category **non_moving** (> 365 days) |
| UAT-0015 | Unrestricted 3 vs safety stock 25 | **Shortage** finding, risk high, gap 22 |
| UAT-0016 | Stock 2400 vs max 200 | **Excess** (above_max_stock): excess qty 2200; also top of coverage-target excess |
| UAT-0017 | Blocked 60 + quality 25 | Position tab shows blocked/quality split; blocked value on dashboard |
| UAT-0018 | Demand only every 3rd month | XYZ = **Z (intermittent)**; forecast selection offers Croston |
| UAT-0019 | Seasonal 12-month pattern | Consumption chart shows seasonality; Holt-Winters among forecast candidates |
| UAT-0020 | Issues + 202 returns every other month | Consumption = issues − returns (verify totals; returns must NOT inflate demand) |
| UAT-0021 | 311 transfers only | **No consumption**; excluded from XYZ demand; appears non-moving by issues |
| UAT-0022 | Stock lines in EA and KG | **conflicting_units** High finding in validation |
| UAT-0023 | Unrestricted −12 | **negative_stock** finding; critical shortage (negative availability) |
| UAT-0024 | Value 0 / missing price | **zero_value_stock** + missing-price findings; excluded from value KPIs |
| UAT-0025 | Last movement `31.02.2026` | **invalid_dates** finding; row kept, excluded from aging |
| UAT-0026 | Missing MATKL in master | missing-group finding (Unassigned bucket) |
| UAT-0027 | Missing PLIFZ in master | Planning proposal refuses with "maintain lead time" message |
| (row 35) | Missing material code | **missing_material** critical; blocked until exclusion approved |
| (row 36) | Exact duplicate stock row | **duplicate_rows** finding; dedup cleansing proposal |
| UAT-0005 (PI) | Stated difference 99 vs computed −3 | **count_difference_mismatch**; platform uses computed value |

## Import order for UAT

1. `MB52-stock.csv` → dataset "UAT Stock" (approve safe cleansing + the two exclusion actions).
2. `MB51-movements.csv` → dataset "UAT Movements".
3. `material-master.csv` → dataset "UAT Master" (verify SAP technical mapping).
4. `physical-inventory.csv` → dataset "UAT Counts".
5. Select UAT Stock + UAT Movements in the workspace header; run every module per `docs/STAGING_UAT_PLAN.md`.

## Reconciliation targets (manual spot checks)

- MB52 import: 30 materials survive cleansing (33 rows minus the no-material row, the duplicate and nothing else); UAT-0022 keeps 2 lines.
- UAT-0001 monthly consumption = 14/month steady (18 issue months) minus nothing; the duplicate movement row must be removed by dedup, keeping totals at the hand-checkable value shown in the consumption stats.
- UAT-0020 net consumption per return month = issue − return (e.g. 22 − 11 = 11).
- Dashboard total value = Σ MB52 `Value` column of surviving rows (spreadsheet-checkable).
