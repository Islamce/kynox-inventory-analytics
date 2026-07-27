# Independent Review Guide — PR #1

Purpose: give a human reviewer the fastest path to a meaningful independent
verdict. This document does not replace the review; **no independent approval
has been performed or claimed** — that is deliberately left to you.

## What you are reviewing

A standalone supply-chain analytics platform (monorepo: Express API + React
SPA + three pure analytical packages) targeting staging at
`staging-analytics.kynox.io`. It must never touch `www.kynox.io` or
`wms.kynox.io`. Architecture: `docs/ARCHITECTURE.md` (10 min read).

## Suggested review order (~2–4 hours)

1. **Security-sensitive surface (45 min)** — the files where a mistake is exploitable:
   - `apps/api/src/middleware/auth.ts` — JWT issuing/verification, RBAC enforcement
   - `apps/api/src/routes/auth.ts` — login, lockout, rate limit
   - `apps/api/src/routes/uploads.ts` — file handling, ownership checks (IDOR fix), multer limits
   - `apps/api/src/services/files.ts` — extension/MIME allowlist, filename sanitisation, SheetJS `raw:true` rationale
   - `apps/api/src/routes/exports.ts` — formula-injection sanitiser (`sanitizeCell`)
   - `apps/api/src/config.ts` — `validateProductionConfig()` startup refusal
   - Cross-check each against `docs/SECURITY_REVIEW.md` findings #1–#7 and confirm the fixes are real.
2. **Analytical formulas (45 min)** — business-critical correctness:
   - `packages/analytics-engine/src/` — `abc.ts`, `xyz.ts`, `aging.ts`, `excess-shortage.ts`, `forecasting.ts`, `planning.ts`, `health.ts`
   - Verify against `packages/analytics-engine/src/fixtures.test.ts` (hand-computed expectations) and `docs/KPI_DICTIONARY.md`.
   - Movement semantics (reversals subtract, transfers excluded): `apps/api/src/services/analytics.ts` lines around `ISSUE_REVERSAL_TYPES`.
3. **Database migrations (15 min)** — `apps/api/src/db/migrations/` (2 files). Check unsigned FKs, additive second migration, rollback functions. Executed-compatibility evidence: `docs/DB_COMPATIBILITY.md`.
4. **AI governance path (30 min)** — follow one request end to end:
   `apps/api/src/routes/ai.ts` (limits, evidence collection, logging) →
   `packages/ai-engine/src/orchestrator.ts` (prompt, injection guardrail, JSON parsing, governance checks) →
   `packages/ai-engine/src/providers.ts` (timeout/retry, usage capture).
   Confirm: the AI never queries the DB, never computes KPIs, failing governance withholds insights, and `AI_PROVIDER=none` → honest 503.
5. **Deployment scripts (20 min)** — `scripts/deployment/*.sh` + `ecosystem.config.cjs`. Check: strict mode, no secret echoing, backup-before-migrate, symlink atomicity, automatic smoke-test rollback, and the documented DB-rollback limitation in `rollback.sh`.
6. **Evidence spot-checks (15 min)**:
   - CI: latest run on the PR (three green jobs; job names match `docs/BRANCH_PROTECTION.md` required checks).
   - Tests: `npm ci && npm test` locally — expect 6 files / 128 passed.
   - Security: `npm audit` — expect 0.

## Known limitations to weigh (not hidden)

See PR #1 §9 and `docs/PRODUCTION_READINESS.md`: JWT non-revocability (8 h),
single-org data scope, no frontend component tests, `double` value columns,
synchronous import pipeline, scenario-simulation/RTL follow-ups.

## Questions worth asking the author/owner

- Is single-organisation scope acceptable for the first production tenant?
- Is SAR/单-currency assumption per dataset acceptable for your business data?
- Should the AI provider's data-use terms be legal-reviewed before staging UAT-D?

## What sign-off should state

Reviewer name, date, commit SHA reviewed, areas covered, defects raised (with
severity), and an explicit verdict: approve for staging / changes requested.
