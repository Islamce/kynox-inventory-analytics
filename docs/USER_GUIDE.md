# User Guide

## Signing in

Your administrator creates your account and role. Roles control what you can
see and do (upload, approve cleansing, view financial values, use AI, export,
administer). After signing in you land on the Executive Dashboard.

## The workspace header

Two selectors at the top choose the **stock dataset** (e.g. an MB52 snapshot)
and the **movements dataset** (e.g. an MB51 extract) that every module reads.
Modules that need movements (consumption, XYZ, forecasting, demand-based
excess) tell you explicitly when none is linked — nothing is silently
approximated.

## Importing data (Data Workspace)

1. **Upload** — drag & drop an XLSX/XLS/CSV export. The original file is
   stored unmodified.
2. **Detect & map** — the platform names the report type (MB52, MB51, material
   master, physical inventory, …) with a confidence score, its reasons and
   alternatives; override it if needed. Below, every source column shows its
   canonical mapping — fix any column with the dropdown. Arabic and English
   headers and SAP technical names (MATNR, WERKS…) are recognised.
3. **Validate & cleanse** — quality scores across six dimensions, plus every
   issue with severity, affected rows (file/column/row samples), business
   impact and a recommended correction. Tick the cleansing actions you approve;
   "safe" actions are pre-ticked, risky ones require your explicit choice.
   Critical issues block saving unless the exclusion actions are approved.
4. **Dataset ready** — a versioned dataset is created with its transformation
   log; re-importing under the same name creates version 2, 3, … The new
   dataset is auto-selected in the header.

## Modules

- **Executive Dashboard** — headline KPIs (hover any tile for its definition
  and formula), aging distribution, top shortage/excess exceptions with
  drill-down links.
- **Data Quality Center** — scores and remaining findings per dataset, plus
  the applied transformation log.
- **Inventory Intelligence** — five tabs: Position, Aging (choose the date
  basis), Movement categories (slow-moving, non-moving, active — with the
  reason for every material), Excess (four selectable methods), Shortage.
- **ABC–XYZ** — Pareto curve, per-material classes with reasons, 3×3 matrix
  with recommended (configurable) control policies.
- **Consumption Analytics** — period series with zero-filling, statistics,
  anomaly flags (≥3σ) that you should verify against business events.
- **Material 360°** — everything about one material: stock, classes, category,
  shortage state, consumption history, recommended forecast, planning proposal.
  Reach it from any material link in other modules.
- **Planning & Forecasting** — the platform back-tests all applicable methods
  and recommends the best by WAPE, showing the full comparison table. Safety
  stock / reorder point / min-max are proposals with formulas and assumptions —
  review before applying anything in your ERP.
- **AI Insights Center** — ask questions in plain language. Every answer is
  built from the deterministic metrics of your selected datasets; expand
  "Evidence & governance" under any answer to see exactly which numbers the AI
  was given and which checks passed.
- **Reports & Exports** — management PDF, analysis workbook, dataset XLSX/CSV.
  Every report carries dataset, period, generation info and method notes.
- **Administration / Audit** — users & roles, analytical configuration
  (thresholds, weights, service level), and the append-only audit trail.

## Good practice

- Import stock and movements covering the same period and link both.
- Keep material master data (lead times, max stock, safety stock) maintained —
  several analyses state explicitly when they must skip a material for missing
  master data.
- Treat anomaly flags and AI recommendations as decision support: the platform
  is deliberately built to show its evidence so you can verify before acting.
