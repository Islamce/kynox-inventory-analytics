# Kynox Supply Chain Intelligence

An enterprise-grade, governed Supply Chain & Materials Intelligence platform:
upload SAP/ERP/WMS/Excel/CSV data, get automatic report detection, smart column
mapping, validation with approval-based cleansing, deterministic inventory
analytics (ABC/XYZ, aging, excess, shortage, forecasting, planning proposals)
and a governed AI insights layer — with full traceability and auditability.

Deployed standalone at `https://analytics.kynox.io`. It never touches the
existing `www.kynox.io` site or the production WMS.

## Architecture at a glance

```
kynox-inventory-analytics/
├── apps/
│   ├── api/        Express + TypeScript REST API (serves the built SPA in production)
│   └── web/        React + Vite + Tailwind + ECharts frontend
├── packages/
│   ├── shared-types/       Canonical data model, RBAC matrix, DTOs
│   ├── analytics-engine/   Pure deterministic analytics (ABC, XYZ, aging, forecasting…)
│   ├── data-quality/       Parsers, 14 validation rules, scoring, cleansing
│   └── ai-engine/          Provider abstraction, 10 agents, orchestrator, governance
├── docs/           Architecture, deployment, KPI dictionary, guides
├── database/       SQLite file location for local dev
├── uploads/        Uploaded source files (never modified)
└── exports/        Generated reports
```

Key design principles (enforced in code, not just documented):

- **Backend complexity, frontend simplicity** — all formulas live in
  `packages/analytics-engine` as pure, unit-tested functions; the UI shows
  plain-language explanations, definitions and drill-downs.
- **No black-box analytics** — every classification returns *why* (reason
  strings, formulas, thresholds, confidence); KPI tiles carry definition +
  formula tooltips.
- **Human-in-the-loop** — cleansing is proposal + approval; planning parameters
  are recommendations; nothing modifies source data.
- **Source-data protection** — original files are kept verbatim; datasets are
  versioned; every transformation is logged.
- **Governed AI** — the AI never computes metrics or queries the database. It
  receives a structured evidence package from deterministic services, and its
  output must pass governance checks (evidence present, confidence stated,
  values traceable) or insights are withheld. Without an API key the AI
  features return an honest 503 — never fake analysis.

## Quick start (local development)

```bash
npm install
npm run build:packages          # compile shared packages once
cp .env.example .env            # defaults work for dev (SQLite); set ADMIN_INITIAL_PASSWORD
npm run migrate                 # create the schema
npm run seed                    # admin user + default configuration
npm run dev:api                 # API on :4000
npm run dev:web                 # UI on :5173 (proxies /api to :4000)
```

If `ADMIN_INITIAL_PASSWORD` is unset, the seed prints a generated password once.

## Production build & start

```bash
npm run build                   # packages + api + web
npm run migrate
npm run seed                    # first deployment only
npm start                       # serves API and the SPA on $PORT
```

Health endpoints: `/api/health`, `/api/version`, `/api/readiness`.

## Tests

```bash
npm test        # 99 tests: 65 unit (analytics/quality/ai) + 34 API integration (full user journey)
```

## Documentation

| Document | Purpose |
|---|---|
| `docs/ARCHITECTURE.md` | Modules, data model, API map, AI agent design |
| `docs/DEPLOYMENT_HOSTINGER.md` | Subdomain setup, Node app config, DB, SSL, backup, rollback |
| `docs/KPI_DICTIONARY.md` | Every KPI/classification: definition, formula, configuration |
| `docs/AI_GOVERNANCE.md` | AI safeguards, agent responsibilities, logging |
| `docs/USER_GUIDE.md` | End-user walkthrough of the 7-step import and all modules |
| `.env.example` | Full environment variable template |

## Security summary

JWT auth (bcrypt-hashed passwords, account lockout, login rate limiting),
per-route RBAC from a 12-role permission matrix, upload extension+MIME
validation with filename sanitisation, parameterised queries via Knex,
helmet security headers, API rate limiting, sanitised error responses,
append-only audit log (no secrets ever logged), environment-variable secrets.
