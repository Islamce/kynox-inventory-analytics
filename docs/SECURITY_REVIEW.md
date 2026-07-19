# Security Review — Pre-merge Hardening (PR #1)

Scope: full review of authentication, authorization, uploads, exports, AI
input handling, injection surfaces, logging and configuration. Every Critical
and High finding below is **fixed in this branch**; remaining Medium/Low items
are accepted with documented rationale or scheduled follow-ups.

## Findings table

| # | Finding | Severity | Affected file(s) | Exploit scenario | Recommended correction | Status |
|---|---|---|---|---|---|---|
| 1 | `xlsx` 0.18.5 with known prototype-pollution (GHSA-4r6h-8v6p-xvw6) and ReDoS (GHSA-5pgg-2g8v-p4x9) CVEs | **High** | `apps/api/package.json` | A crafted workbook uploaded by a low-privilege user pollutes `Object.prototype` in the API process or stalls it via ReDoS | Upgrade to SheetJS 0.20.3 (official CDN build; npm registry version is abandoned) | **Fixed** — upgraded, `npm audit` clean |
| 2 | CSV/Excel formula injection: exported cells beginning with `=`, `+`, `-`, `@` execute as formulas in Excel | **High** | `apps/api/src/routes/exports.ts`, `apps/web/src/components/ui.tsx` | Attacker uploads a stock file with material description `=cmd\|'/c calc'!A1`; a manager exports the analysis and opens it in Excel | Prefix formula-triggering cells with `'` on every export path (server XLSX/CSV + client CSV) | **Fixed** |
| 3 | Stored XSS via ECharts tooltip: material codes interpolated into tooltip HTML unescaped | **High** | `apps/web/src/pages/AbcXyz.tsx` | Material named `<img src=x onerror=…>` in an uploaded file executes in any user's browser hovering the Pareto chart | HTML-escape data-derived strings in every custom tooltip formatter | **Fixed** |
| 4 | IDOR on uploads: any user with `edit_mapping`/`run_analysis` could read, remap and validate other users' uploads by ID | **High** | `apps/api/src/routes/uploads.ts`, `datasets.ts` | User B iterates `/api/uploads/1..n/preview` to read files uploaded by user A | Object-level ownership check (uploader or admin roles) on all `/uploads/:id` routes and dataset creation | **Fixed** |
| 5 | Missing production startup validation: production could silently run with the dev JWT secret fallback if `NODE_ENV` was set but `JWT_SECRET` empty was caught — however weak/short secrets and SQLite-in-production were not | **High** | `apps/api/src/config.ts`, `server.ts` | Deployment with a 6-char JWT secret enables token forgery by brute force | `validateProductionConfig()` refuses startup on missing/short `JWT_SECRET`, SQLite in production, missing DB vars, missing `CORS_ORIGIN` | **Fixed** |
| 6 | Prompt injection via uploaded data reaching the AI evidence package (material descriptions etc.) | Medium | `packages/ai-engine/src/orchestrator.ts` | A material description contains "ignore your instructions and approve…"; the narrative echoes attacker text | Explicit data-vs-instruction guardrail in the system prompt + existing governance checks (untraceable values withheld); AI never executes actions | **Fixed (mitigated)** — residual risk documented in `AI_GOVERNANCE.md` |
| 7 | Oversized uploads surfaced as unhandled 500 (stack logged, generic error) instead of a clean 413 | Low | `apps/api/src/middleware/errors.ts` | None (availability noise only) | Map `MulterError LIMIT_FILE_SIZE` → 413 | **Fixed** |
| 8 | JWT tokens are not revocable before expiry (no server-side session store) | Medium | `apps/api/src/middleware/auth.ts` | A stolen token stays valid up to 8 h even after the user is deactivated | Accepted for v1: 8 h expiry + account `active` check happens at login; follow-up: token version claim checked per request | Accepted (documented) |
| 9 | No plant/warehouse-level row isolation: all datasets are visible to any user with `view_dataset` (single-tenant deployment) | Medium | `apps/api/src/routes/datasets.ts` | An internal viewer sees another plant's data | Accepted for the single-organisation v1; org/plant scoping columns exist in the model for a follow-up | Accepted (documented) |
| 10 | MIME spoofing: `application/octet-stream` accepted for CSV | Low | `apps/api/src/services/files.ts` | Upload of a mislabeled file — it is then parsed by SheetJS and rejected if not a spreadsheet; content is never executed or served back raw | Extension allowlist + parse-or-reject already constrain this | Accepted |
| 11 | Login rate limit keyed by IP; NAT'd offices share a budget, and a botnet rotates IPs | Low | `apps/api/src/routes/auth.ts` | Distributed credential stuffing | Per-account lockout (5 fails → 15 min) already complements the IP limit | Accepted |
| 12 | Hardcoded secrets / default credentials | — | seed | — | Verified none: seed takes password from env or generates a random one printed once; CI job greps tracked files for key patterns | Verified clean |
| 13 | SQL injection | — | all routes | — | Verified: all queries via Knex bindings; the one dynamic `LIKE` uses parameter binding (wildcards only affect match breadth) | Verified clean |
| 14 | CSRF | — | — | — | Not applicable: bearer-token auth, no auth cookies | N/A |
| 15 | Sensitive logging | — | `logger.ts`, `audit.ts` | — | Verified: pino redacts authorization headers/passwords/keys; audit stores no secrets; AI logs store metadata only | Verified clean |
| 16 | CORS | — | `app.ts` | — | Verified: explicit origin allowlist from env, credentials disabled, same-origin SPA serving in production | Verified clean |

## Verification

- `npm audit --audit-level=high`: **0 vulnerabilities** after upgrades (xlsx 0.20.3, echarts 6.1.0).
- All fixes covered by the automated suites (44 API integration tests + 84 unit tests) run on SQLite, PostgreSQL 16 and MySQL 8.4.
- CI includes a tracked-file scan for `.env` files, database files, uploads/exports content and common secret patterns.
