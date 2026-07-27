# Production Readiness Checklist

Status legend: ✅ implemented & verified · 📋 operational instruction documented · ⏳ follow-up

## Application controls

| Control | Status | Where |
|---|---|---|
| Readiness endpoint with real DB connectivity check | ✅ | `GET /api/readiness` runs `select 1`; 503 when unreachable |
| Health / version endpoints without sensitive data | ✅ | `/api/health`, `/api/version` |
| Production startup validation (refuses to start on missing/weak critical env) | ✅ | `validateProductionConfig()` — JWT secret presence+length, DB client/vars, CORS origin; verified: process exits 1 with named problems |
| Graceful shutdown (SIGINT/SIGTERM) with connection-pool drain | ✅ | `server.ts` → `closeDb()` destroys the Knex pool; 10 s hard-exit guard |
| Process-level unhandled rejection / uncaught exception handling | ✅ | logged with `pino` then exit 1 for a clean restart by the process manager |
| Request correlation IDs | ✅ | `X-Request-Id` honoured/generated, echoed, attached to structured request logs |
| Structured error logging with secret redaction | ✅ | central error middleware + pino redaction paths |
| Upload retention cleanup job | ✅ | daily; deletes only uploads **not referenced by any dataset** after `UPLOAD_RETENTION_DAYS` (default 90) |
| Export retention cleanup job | ✅ | daily; deletes generated files after `EXPORT_RETENTION_DAYS` (default 14) |
| Rate limiting (API-wide + login-specific) & account lockout | ✅ | 300/min/IP; 30 logins/15 min/IP; 5 failures → 15 min lock |
| Migration rollback verified | ✅ | executed on SQLite, PostgreSQL 16, MySQL 8.4; also a CI step |
| Backup instructions | 📋 | `DEPLOYMENT_HOSTINGER.md` §8 (daily DB dump + uploads archive, ≥30-day retention, quarterly restore test) |
| Rollback instructions | 📋 | `DEPLOYMENT_HOSTINGER.md` §9 (tagged releases, migrate:rollback or DB restore) |
| Branch protection recommendation | 📋 | `BRANCH_PROTECTION.md` |

## Environment variables (validated at startup in production)

Required: `NODE_ENV=production`, `JWT_SECRET` (≥32 chars), `DB_CLIENT` (`pg`|`mysql2`),
`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `CORS_ORIGIN`.
Optional: `PORT`, `JWT_EXPIRES_IN`, `MAX_UPLOAD_MB`, `UPLOAD_RETENTION_DAYS`,
`EXPORT_RETENTION_DAYS`, `AI_PROVIDER`+key, `LOG_LEVEL`. Template: `.env.example`.

## Known follow-ups (not blocking staging)

- ⏳ JWT revocation before expiry (token-version claim) — mitigated by 8 h expiry.
- ⏳ Plant/warehouse row-level data scoping — single-organisation deployment assumed for v1.
- ⏳ Background job queue for very large uploads (current pipeline is synchronous and bounded by the 50 MB limit).
- ⏳ `decimal`-typed value columns if ledger-exact financial aggregation is required.
