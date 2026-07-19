# KPI & Formula Dictionary

Every metric the platform reports, with its exact formula and the configuration
keys that govern it (Administration → Configuration; all changes audited).

## Inventory position

| KPI | Formula | Notes |
|---|---|---|
| Total inventory value | Σ stock line `value` | per selected stock dataset |
| Total quantity | Σ stock line `quantity` | quantity falls back to unrestricted qty when the export has no total column |
| Blocked / QI / in-transit / reserved | Σ respective status quantities | shown only when the source supplies them |
| Net available | `unrestricted` (or `quantity − blocked − quality`) | used by shortage analysis |

## Aging

- Age (days) = `asOfDate − reference date`, basis selectable: last movement (default), last receipt, last issue.
- Buckets: config `aging_buckets` (default 0–30 / 31–60 / 61–90 / 91–180 / 181–365 / >365).
- Items without a usable date are reported in a separate "No movement data" bucket — never guessed.

## ABC classification (config `abc_thresholds`)

- Sort materials by metric (current stock value, or consumption value when a
  movements dataset is linked) descending; classify by **cumulative value
  share**: A ≤ 80 %, B ≤ 95 %, C remainder (defaults; configurable).
- Zero/negative metric ⇒ C. The largest material is always A.
- Never classified by item count.

## XYZ classification (config `xyz_thresholds`)

- Demand series = issued quantity per period (month default), zero-filled.
- CoV = σ / |mean| (sample σ). X: CoV ≤ 0.5; Y: ≤ 1.0; Z otherwise.
- Z is also assigned when: history < `minPeriods` (4), mean = 0, or zero-demand
  periods ≥ `intermittencyThreshold` (40 %). Every result carries its reason.

## Movement categories (distinct concepts, never conflated)

| Category | Rule (config keys) |
|---|---|
| Non-moving | no issue for ≥ `non_moving_days` (365) |
| Slow-moving | last issue ≥ `slow_moving_days` (180) OR annualised turnover < `slow_turnover_threshold` (1) |
| Active | recent issues |
| No movement data | period too short / no history to judge — reported honestly |

Annualised turnover = (issued qty / stock qty) × (365 / period days). Closing
stock is used as the average-stock proxy when no opening stock is supplied
(disclosed in the reason string).

## Excess stock (method selectable per run; config `coverage_target_days`)

| Method | Reference quantity |
|---|---|
| above_max_stock | material master `max_stock` |
| above_coverage_target | avg daily demand × coverage target days (90) |
| above_safety_plus_leadtime | safety stock + avg daily demand × lead time |
| no_demand | 0 when the material has stock but no demand in the horizon |

Excess qty = max(0, stock − reference); excess value = excess qty × (stock
value / stock qty). Materials missing a method's required inputs are skipped,
not guessed.

## Shortage risk

- Critical: negative available stock; open reservations > available + open supply.
- High: available < safety stock (with projected stockout days when demand known).
- Medium: available < reorder point with no open supply.

## Inventory health index (config `health_weights`)

Weighted 0–100 score over: availability (100 − shortage share), excess
(100 − excess value share), obsolescence (100 − non-moving value share), aging
(100 − share of value older than 180 days), turnover (annual turns × 25, capped
at 100 ⇒ 4 turns = perfect), data quality (dataset score). Components that
cannot be measured with the supplied data are excluded and the remaining
weights renormalised — the explanation lists exactly what was excluded.

## Forecasting

Methods: naive, seasonal naive, moving average, weighted MA, exponential
smoothing, Holt, Holt-Winters (≥ 2 seasons required), Croston + SBA (offered
when ≥ 30 % zero periods), linear trend. Selection: hold out the last 20 %
(min 2 periods), fit on the rest, recommend the lowest **WAPE** (MAE
tiebreak). < 6 periods of history ⇒ explicit "insufficient data", no model.

Accuracy metrics: MAE, RMSE, MAPE (null when all actuals are zero), WAPE
(null on zero total), bias, MAD, tracking signal — all zero-demand safe.

## Safety stock (5 methods) & reorder point

- Fixed quantity; Days of supply = avg daily demand × days;
  Max consumption = (max daily − avg daily) × lead time;
  **Statistical (default)** = z(service level) × σ_daily × √lead time;
  Demand+LT variability = z × √(LT·σ_d² + d̄²·σ_LT²).
- z from the inverse normal CDF; `service_level` config (0.95 default).
- ROP = avg daily demand × lead time + safety stock.
- Min = ROP; Max = Min + avg daily demand × `coverage_target_days`.
- All outputs are labelled recommendations with formula, inputs and assumptions;
  materials without a maintained lead time get an explicit refusal, not a guess.

## Data-quality scores (0–100 each)

Completeness (populated cells / expected cells), Validity (parseable numerics
and dates), Consistency (100 − consistency-issue row share), Uniqueness
(100 − duplicate row share), Timeliness (100 − future-posting share), Integrity
(100 − critical row share − 0.5 × high row share). Overall = weighted mean
(0.20/0.25/0.15/0.15/0.10/0.15).

## Physical inventory

Line accuracy % = lines with zero variance / lines. Quantity accuracy % =
max(0, 1 − Σ|counted − book| / Σ|book|) × 100. Positive/negative variance
reported separately; stated difference columns are cross-checked against
counted − book.
