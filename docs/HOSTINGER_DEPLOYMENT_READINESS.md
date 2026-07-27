# Hostinger Deployment Readiness

Deployment model: **Hostinger Managed Node.js Web App + Hostinger MySQL.**
Scope: Analytics only. `www.kynox.io` and `wms.kynox.io` untouched. PR #1
remains open + Draft.

Legend: ✅ done in code/CI · ⏳ owner hPanel action · N/A.

| Gate | Status | Evidence | Owner action |
|---|---|---|---|
| Hostinger plan verified | ⏳ | — | Confirm **Websites → Add Website → Node.js Web App** exists; record plan name |
| Node.js Web App available | ⏳ | — | Same as above |
| GitHub connected | ⏳ | — | Import `Islamce/kynox-inventory-analytics` with an account that can read the private repo |
| MySQL database created | ⏳ | — | Create dedicated `kynox_analytics` + `kynox_app` (least privilege) |
| Build settings prepared | ✅ | Node 22, `npm run build`, entry `app.js`, `npm start`, root `/` — documented in `HOSTINGER_MANAGED_DEPLOYMENT.md` | Enter in hPanel |
| Entry file verified | ✅ | root `app.js` loads `apps/api/dist/server.js`, respects `process.env.PORT`; started successfully on MySQL locally + in CI | — |
| Environment variables prepared | ✅ | register in `HOSTINGER_ENVIRONMENT_VARIABLES.md` (names/placeholders only) | Enter real values in hPanel |
| Temporary-domain deployment | ⏳ | — | Deploy to Hostinger temp domain first |
| Migration completed | ⏳ | controlled procedure in `HOSTINGER_MIGRATION_AND_SEED.md`; verified on MySQL 8.4 (CI + local) | Run once per release after backup |
| Seed completed | ⏳ | idempotent seed verified | Run once; change temp admin password |
| Storage persistence verified | ⏳ | risk + procedure in `HOSTINGER_STORAGE_ASSESSMENT.md` | Upload → redeploy → confirm persistence |
| Smoke tests passed | ⏳ | checklist in `HOSTINGER_UAT_CHECKLIST.md`; health/readiness/version/SPA/401 verified in CI + local | Run on temp domain |
| Analytics reconciled | ✅ (rehearsed) / ⏳ (on host) | reconciled on Postgres rehearsal; MySQL 44-test suite green | Re-run on host with `uat-data/` |
| Backup created | ⏳ | procedure in `HOSTINGER_BACKUP_AND_RESTORE.md` | Take SQL dump before migration |
| Restore tested | ⏳ | validation-DB procedure documented | Restore into a temp DB, verify rows |
| Custom domain connected | ⏳ | — | Connect `analytics.kynox.io` via hPanel |
| SSL valid | ⏳ | — | Enable Hostinger-managed SSL; verify HTTPS + redirect |
| Production accepted | ⏳ | — | After all above + no Critical/High defect |

## Code-side readiness (this branch)
- ✅ Root `app.js` entry; `npm start` → `node app.js`; `process.env.PORT` respected.
- ✅ `engines` = `>=20 <23`, `npm >=10`.
- ✅ `better-sqlite3` moved to `optionalDependencies` (never loaded under MySQL); production uses `mysql2`.
- ✅ Production startup validation refuses SQLite/weak-JWT/missing-CORS/incomplete-DB (verified exit 1).
- ✅ Migrations are a separate command (not on startup); seed idempotent.
- ✅ `/api/version` reports release SHA + environment; `/api/health` + `/api/readiness` (real MySQL check).
- ✅ Retention cleanup callable via secured `POST /api/maintenance/cleanup` (token-gated, disabled without `MAINTENANCE_TOKEN`); in-process timer dis(able via `ENABLE_INPROCESS_CLEANUP=false`).
- ✅ Relative `UPLOAD_DIR`/`EXPORT_DIR`; comma-separated `CORS_ORIGIN`; no VPS assumptions on the managed path.
- ✅ CI job **“Hostinger managed-hosting build + start (MySQL)”**: clean `npm ci` → `npm run build` → controlled migrate → `node app.js` on MySQL 8.4 → health/readiness/version/SPA/401 probes.
- ✅ VPS artefacts (pm2/nginx/symlink scripts, `docs/DEPLOYMENT_HOSTINGER.md`) demoted to an appendix marked *not applicable to managed hosting*.

## Final recommendation
**Code ready for Hostinger hPanel deployment.** Remaining items are owner
hPanel actions (plan verification, DB creation, env entry, deploy to temp
domain, migrate/seed, storage-persistence check, UAT, domain + SSL). Not a
production-accepted claim — that requires the temporary-domain UAT and the
gates above to pass on the live host.
