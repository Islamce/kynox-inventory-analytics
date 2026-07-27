# Frontend Completeness Checklist

Method: every route, page, button and interactive control was walked through
against the source (all handlers verified non-decorative), plus a production
build type-check (`tsc --noEmit`, zero errors) and SPA route serving smoke test.
Every listed control calls a real API endpoint or performs a real client action.

| Area | Controls verified | Status |
|---|---|---|
| Login (`/login`) | email+password form → `POST /api/auth/login`; error state on 401/423; redirects on success; autocomplete attributes | ✅ |
| Layout / navigation | 12 nav links (all routed); dataset selectors persist to workspace state and re-render all modules; mobile hamburger toggle; sign-out clears session → `/login` | ✅ |
| Executive Dashboard (`/`) | 10 KPI tiles (each with definition+formula tooltip), aging chart, group chart, shortage/excess queues with drill-down links to Material 360 and Inventory; empty state when no dataset selected | ✅ |
| Import wizard (`/workspace`) | drag-drop + click upload; step indicator; detection override select; per-column mapping selects; "Confirm mapping & validate"; issue list with expandable samples; cleansing checkboxes (flag-only disabled); dataset name/period inputs; "Apply & save"; "Upload another"; back navigation; upload history table | ✅ |
| Data Quality Center (`/quality`) | dataset selector; 7 score cards; finding list with severity badges and sample locations; transformation log | ✅ |
| Inventory (`/inventory`) | 5 working tabs; aging basis selector; excess method selector; all tables sortable/filterable/paginated with CSV export; material links | ✅ |
| ABC–XYZ (`/abc-xyz`) | metric selector (consumption option disabled without movements dataset — with explanation); Pareto chart with escaped tooltips; classification tables; 3×3 matrix with hover policies and expandable policy list | ✅ |
| Consumption (`/consumption`) | granularity selector; material filter (Enter + Apply + Clear); anomaly markers and list; top consumers table | ✅ |
| Material 360 (`/materials`) | search input (Enter + button); badge row; stock facts grid; consumption chart; forecast chart with method comparison table; planning proposal cards; honest per-section "insufficient data" messages | ✅ |
| Planning (`/planning`) | material input; forecast comparison table with recommended row; SS/ROP/min-max proposal cards with formulas and assumptions | ✅ |
| AI Insights (`/ai`) | suggestion chips (each fires a real query); question input; per-insight evidence/assumption expanders; governance check display; honest unconfigured-provider banner | ✅ |
| Reports (`/reports`) | PDF report button; analysis workbook button; per-dataset XLSX/CSV export links; delete with confirm dialog; busy states on all downloads | ✅ |
| Administration (`/admin`) | create-user form (validation); role dropdowns (live PATCH); active/inactive toggle; config rows with save + saved indicator; read-only mode for non-admins | ✅ |
| Audit (`/audit`) | action filter; pagination; prev/new value detail column; permission-denied error state | ✅ |
| Logout | sidebar button clears token+session and navigates to login | ✅ |
| Error handling | every data page renders Spinner → ErrorState (API message) → EmptyState (with next-step hint); 401 responses globally clear the session and redirect | ✅ |
| Unknown routes | `*` redirects to the dashboard; unauthenticated access redirects to `/login` | ✅ |
| Mobile responsiveness | collapsible sidebar (fixed overlay < lg); KPI grids collapse 5→3→2 columns; tables scroll horizontally in bounded containers; charts resize on window resize | ✅ |
| Accessibility | labels/aria-labels on all form controls; role=tablist/tab; role=status on spinners; role=alert on errors; no color-only status (badges carry text) | ✅ |

**No decorative or non-functional buttons exist** — verified by grep: every
`<button>`/link has an `onClick`/`to`/`type=submit` bound to implemented logic.

Not yet implemented (explicitly out of scope for this PR, tracked as follow-ups):
dedicated Scenario Simulation page, Control-Tower-specific page (its KPIs are on
the dashboard), Arabic/RTL locale switch (mapping layer already accepts Arabic
headers).
