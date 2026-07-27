# UI Visual QA Report — Kynox Supply Chain Intelligence

Real visual and interaction review of every frontend route, followed by a
second-pass enhancement. This is **not** a source-only assessment: the running
application was built, seeded with the UAT datasets, and every route rendered
in a real Chromium browser at multiple viewports and both themes.

## Method (evidence-based)
- Built the app (`npm run build`), ran it on the root `app.js` entry over a
  seeded SQLite database, and imported the real UAT SAP exports through the
  actual pipeline (MB52 → stock dataset, 31 rows; MB51 → movements dataset,
  481 rows) via the live API — same detection/mapping/validation/cleansing a
  user drives.
- Rendered **13 routes × {light, dark} × {desktop 1440×900, mobile 390×844}**
  = **52 screenshots** with Playwright + Chromium.
- Accessibility measured with **axe-core (WCAG 2 A/AA)** across all 13 routes
  in both themes — see `docs/UI_ACCESSIBILITY_VALIDATION.md`.

Screenshots are review artifacts (not committed — they are large binaries);
regenerate with `apps/web/e2e` tooling or the review scripts. The Playwright
smoke suite (`apps/web/e2e/smoke.spec.ts`) is committed and runs in CI.

## Rating scale
Excellent · Acceptable · Needs enhancement · Unacceptable

## Per-page results (post-enhancement)

| Page | Visual | Kynox identity | Interaction depth | Hierarchy | Responsive | Dark mode | A11y | Remaining generic traits | Action | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| **Login** | Excellent | Strong | Form + brand panel | Clear | Yes | Yes | Pass | — | None | — |
| **Executive Dashboard** | Excellent | Strong | KPI drill-downs, exception lists | Clear | Yes | Yes | Pass | — | None | — |
| **Data Workspace** | Excellent | Strong | Guided 7-stage pipeline, mapping, cleansing approval, issue drawer, before/after | Clear | Yes | Yes | Pass | — | Redesigned this pass | — |
| **AI Insights Center** | Excellent | Strong | Governed panel, provider status, scope, suggestion cards, evidence/confidence/risk/action | Clear | Yes | Yes | Pass | — | Redesigned this pass | — |
| **Reports & Exports** | Excellent | Strong | Report-studio template cards + dataset export table | Clear | Yes | Yes | Pass | — | Redesigned this pass | — |
| **Material 360°** | Excellent | Strong | Dossier: identity, KPIs, ABC/XYZ, consumption + forecast, planning proposal | Clear | Yes | Yes | Pass | — | Intelligence header added | — |
| **ABC–XYZ Analysis** | Excellent | Strong | Class cards, Pareto, classification + XYZ tables, interactive 3×3 matrix with policy | Clear | Yes | Yes | Pass | — | Matrix contrast fixed | — |
| **Inventory Intelligence** | Acceptable | Good | Tabs (position/aging/categories/excess/shortage), tables, charts | Clear | Yes | Yes | Pass | Tables-forward | Add a risk-summary band + excess/shortage visual comparison | Medium |
| **Consumption Analytics** | Acceptable | Good | Trend + KPI strip + top-consumers table | Clear | Yes | Yes | Pass | Table-forward | Add anomaly markers / seasonality overlay | Medium |
| **Data Quality Center** | Acceptable | Good | Score dimensions, findings, cleansing log, dataset selector | Clear | Yes | Yes | Pass | Empty when 0 findings | Add severity/hotspot/error-distribution when findings exist | Medium |
| **Planning & Forecasting** | Acceptable | Good | Forecast vs actual, method comparison, error metrics, rationale, assumptions | Clear | Yes | Yes | Pass | Bare until a material is entered | Add a starting recommendation / recent-materials shortcuts | Low |
| **Administration** | Acceptable | Good | User table, role status pills, config groups | Clear | Yes | Yes | Pass | Restrained by design | Optional role-matrix visual | Low |
| **Audit & Governance** | Acceptable | Good | Append-only trail, action filter, pagination | Clear | Yes | Yes | Pass | Table-forward | Optional event-detail drawer + timeline view | Low |

## What the second pass changed
- **New intelligence component vocabulary** (`components/intelligence.tsx`):
  `IntelligenceHeader`, `ContextChip`, `InsightCallout`, `StatTile`, `Stepper`,
  `Meter`, `Drawer` — applied so every route opens with a signature header and
  live context rather than a bare `<h1>`.
- **Data Workspace** rebuilt as a guided pipeline: 7-stage stepper
  (Upload → Detect → Map → Validate → Cleanse → Approve → Analyze), a proper
  dropzone (emoji removed → SVG), per-column mapping confidence meters,
  quality-score tiles, an issue-detail drawer, cleansing approval, and a
  before → after summary with a clear next action.
- **AI Center** rebuilt as a governed, evidence-driven experience: provider
  status + dataset-scope chips, honest disabled state, suggested-analysis
  cards, and structured insight cards (evidence, confidence, risk, action,
  assumptions, limitations, governance checks).
- **Reports** rebuilt as a report studio (template cards with format + method
  notes) over the dataset-export table.
- **Accessibility**: raised contrast tokens to WCAG-AA, added a dedicated link
  token for dark surfaces, gave charts accessible names, made scroll regions
  keyboard-focusable, and tokenised the last hardcoded status colours →
  **0 serious/critical axe violations across 26 route×theme combinations.**

## Preserved guardrails (unchanged)
Analytics formulas, API contracts, RBAC, DB schema, MySQL/Hostinger `app.js`
path, the DataTable **CSV formula-injection guard**, the AbcXyz **escaped chart
tooltip**, AI governance, and existing test behaviour.

## Performance (production build)
| Asset | Raw | Gzip |
|---|---|---|
| JS (single chunk, ECharts-dominant) | ~1381 KB | ~453 KB |
| CSS | ~36 KB | ~8 KB |

- The design system (tokens/themes/motion/icons) and the command palette are
  CSS + small JS — **negligible** bundle impact; **no new runtime
  dependencies** were added for the UI work.
- The dominant cost is **ECharts**, unchanged by this work. The app currently
  ships a single JS chunk. **Recommendation (not done here to avoid behavioural
  risk):** lazy-load routes and/or import ECharts per-chart to code-split the
  vendor chunk; this would cut first-paint JS materially on the managed host.
- Theme switching is a CSS-variable flip (no re-render storm); chart chrome
  re-themes via a single `data-theme` observer. Mobile interaction was smooth
  at 390×844 across routes.

## Open visual limitations
1. Inventory / Consumption / Quality still lean on tables where a risk-summary
   or anomaly-storytelling band would add value (Medium priority above).
2. Single JS chunk — code-splitting recommended for first-paint on the managed
   host.
3. Screenshots reflect a single seeded dataset; production data variety should
   be re-checked during live temporary-domain UAT.
4. No live Hostinger-domain visual UAT has been performed — required before any
   production-acceptance claim.
