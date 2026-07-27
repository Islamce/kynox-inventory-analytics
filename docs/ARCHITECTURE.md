# Architecture

## System overview

A modular monorepo with a strict dependency direction:

```
web (React SPA)
  └── HTTP → api (Express)
                ├── analytics-engine   (pure functions, no I/O)
                ├── data-quality       (pure functions, no I/O)
                ├── ai-engine          (provider adapter + orchestrator; fetch only to the configured AI API)
                └── shared-types       (types + RBAC matrix, no logic)
```

The API is the only component with database and filesystem access. Analytical
packages are pure and independently unit-tested; the API composes them.

## Technology choices

| Layer | Choice | Rationale |
|---|---|---|
| Backend | Node 20+/22, Express 4, TypeScript strict | Hostinger-compatible, simple process model |
| DB access | Knex | One migration set for SQLite (dev), MySQL (Hostinger shared), PostgreSQL (preferred, VPS); switch via `DB_CLIENT` |
| Files | SheetJS (xlsx) | XLSX/XLS/CSV read + XLSX/CSV write |
| PDF | pdfkit | Management report generation |
| Auth | JWT + bcryptjs | Stateless, reverse-proxy friendly |
| Frontend | React 18, Vite, Tailwind 4, ECharts | Fast builds, production-grade charts |
| Tests | Vitest + Supertest | Unit + full-journey integration |

## Database entities

- `users` — accounts, role, lockout state
- `audit_log` — append-only trail (user, action, entity, prev/new value, IP, correlation id)
- `uploads` — file metadata, detection result, mapping, selected sheet (source files stay on disk verbatim)
- `datasets` — versioned analysis datasets: kind (stock / movements / material_master / physical_inventory), period, applied mapping, cleansing log, approved actions, remaining issues, quality scores
- `stock_items`, `movements`, `material_master`, `physical_inventory` — canonical rows per dataset (indexed by dataset+material, dataset+posting_date)
- `config` — admin-configurable thresholds/weights (JSON values, audited)
- `ai_logs` — question metadata, provider/model, governance outcome (no secrets)
- `exports` — export history

## Data pipeline (Data Workspace)

1. **Upload** — multer disk storage, extension + MIME allowlist, filename
   sanitisation, 50 MB default cap. Original file is never modified.
2. **Detection** — signature matching over *mapped canonical fields* (required
   any-of groups + supporting fields) plus sheet/file-name hints; returns
   confidence, matched fields, ranked alternatives; user can override.
3. **Mapping** — exact / SAP technical (MATNR, WERKS, …) / synonym (EN + AR) /
   fuzzy (Levenshtein ≥ 0.72) matching; greedy best-first assignment, one field
   per column; column positions are never used; user edits persist as `user`
   mappings.
4. **Preview** — 50-row sample + per-column profile (inferred type, null %, unique count).
5. **Validation** — 14 rules with severity (critical → info), row/column
   samples, business impact, recommended correction. Critical issues block
   dataset finalisation unless resolved by approved exclusions.
6. **Cleansing approval** — proposals (trim, dedupe, sign normalisation,
   number/date normalisation, exclusions) applied only when approved;
   the result is a new row set + transformation log; excluded rows are reported.
7. **Dataset save** — versioned by name; canonical rows persisted in chunks
   inside a transaction; quality scores recomputed post-cleansing.

## Analytics services (deterministic)

All computation lives in `packages/analytics-engine` and is orchestrated by
`apps/api/src/services/analytics.ts`, which loads canonical rows, applies
configured thresholds from the `config` table, and returns results including
the reasons/assumptions. Endpoints (all under `/api/analytics`, permission
`run_analysis`):

| Endpoint | Analysis |
|---|---|
| `position/:stockId` | Totals, status split, by group/plant |
| `aging/:stockId` | Configurable buckets, basis last receipt/issue/movement |
| `abc/:stockId` | Cumulative-value classification (stock or consumption value) |
| `xyz/:movementsId` | CoV + intermittency with per-material reasoning |
| `matrix/:stockId/:movementsId` | 9-segment matrix with policies + stock value |
| `movement-categories/:stockId` | active / slow / non-moving / no-data (distinct concepts) |
| `excess/:stockId` | 4 selectable methods; skips materials missing required inputs |
| `shortage/:stockId` | negative availability, uncovered reservations, below SS/ROP |
| `health/:stockId` | weighted index; unmeasurable components excluded + disclosed |
| `consumption/:movementsId` | zero-filled period series, stats, z-score anomalies |
| `forecast/:movementsId` | 10 methods, holdout back-test, best-by-WAPE recommendation |
| `planning/:stockId/:movementsId` | safety stock (5 methods), ROP, min/max — recommendations only |
| `physical/:datasetId` | count accuracy, variances, worst materials |
| `material360/:stockId` | full profile joining every module |
| `dashboard/:stockId` | headline KPIs + exception queues |

## AI agent design

`packages/ai-engine` defines 10 agents (intake, quality, inventory analyst,
materials master, demand analyst, planning, warehouse performance, financial
impact, root cause, executive advisor), each with intent keywords and a system
prompt embedding shared guardrails (never invent data; hypotheses ≠ causes;
label estimates; cite evidence).

Flow for `/api/ai/chat`:

1. Deterministic services compute metrics/findings for the selected datasets.
2. An **evidence package** (metrics, findings, period, limitations) is built.
3. The orchestrator routes the question to ≤ 3 agents by intent and issues a
   single structured request (strict JSON schema) to the configured provider.
4. The response is parsed and passed through **governance checks**: evidence
   present, confidence stated, assumptions marked, cited values traceable to
   the package. Failing insights are withheld (the failure is shown).
5. Question metadata is logged in `ai_logs` and the audit trail.

The provider layer (`anthropic` | `openai` | `none`) is selected by env vars.
With no provider, AI endpoints return 503 with a clear message.

## Error handling & logging

Central error middleware: typed `HttpError`, Zod validation errors as field
lists, `AiNotConfiguredError` → 503; everything else logs server-side (pino,
with redaction of auth headers/passwords/keys) and returns a sanitised 500.

## Scale posture

Server-side pagination for dataset rows and audit log; chunked inserts;
indexed queries per dataset; SPA bundles served statically; analysis responses
cap embedded lists (e.g. matrix cells cap at 100 materials, counts stay exact).
Long-running work is bounded by dataset size; for very large estates move
`DB_CLIENT` to PostgreSQL and scale vertically before introducing a queue.
