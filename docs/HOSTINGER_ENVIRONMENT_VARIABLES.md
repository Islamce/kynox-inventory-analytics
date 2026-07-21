# Hostinger Environment Variables Register

Enter these in hPanel → your Node.js app → Environment Variables. **Names and
placeholders only — never commit real values.** Changing any variable requires
a **Redeploy** to take effect. Secret classification: 🔴 secret · 🟡 sensitive ·
⚪ non-secret.

| Variable | Req? | Example / format | Purpose | Class | Redeploy? |
|---|---|---|---|---|---|
| `NODE_ENV` | required | `production` | Enables production behaviour + startup validation | ⚪ | yes |
| `APP_ENV` | required | `production` | Environment label in `/api/version` and logs | ⚪ | yes |
| `APP_URL` | required | `https://analytics.kynox.io` | Canonical app URL | ⚪ | yes |
| `CORS_ORIGIN` | required | `https://analytics.kynox.io` (comma-sep allowed) | Allowed browser origins (never `*`) | ⚪ | yes |
| `PORT` | auto | assigned by Hostinger | App listen port — do not hardcode | ⚪ | n/a |
| `DB_CLIENT` | required | `mysql2` | Database driver (MySQL in production) | ⚪ | yes |
| `DB_HOST` | required | value shown in hPanel | MySQL host (not always `localhost`) | 🟡 | yes |
| `DB_PORT` | required | `3306` | MySQL port | ⚪ | yes |
| `DB_NAME` | required | `..._kynox_analytics` | Dedicated Analytics DB | 🟡 | yes |
| `DB_USER` | required | `..._kynox_app` | Least-privilege app user | 🟡 | yes |
| `DB_PASSWORD` | required | — | DB password | 🔴 | yes |
| `DB_SSL` | optional | `false` | Set `true` only if Hostinger requires TLS to MySQL | ⚪ | yes |
| `JWT_SECRET` | required | `openssl rand -base64 48` (≥ 32 chars) | Signs session tokens | 🔴 | yes |
| `JWT_EXPIRES_IN` | optional | `8h` | Token lifetime | ⚪ | yes |
| `ADMIN_EMAIL` | required (seed) | `admin@kynox.io` | First admin login | 🟡 | before seed |
| `ADMIN_INITIAL_PASSWORD` | required (seed) | strong temp password | First admin password (change after login) | 🔴 | before seed |
| `UPLOAD_DIR` | required | `./uploads` | Upload storage path (relative) — see storage note | ⚪ | yes |
| `EXPORT_DIR` | required | `./exports` | Generated-report path (relative) | ⚪ | yes |
| `MAX_UPLOAD_MB` | optional | `50` | Upload size cap | ⚪ | yes |
| `UPLOAD_RETENTION_DAYS` | optional | `90` | Retention for unreferenced uploads | ⚪ | yes |
| `EXPORT_RETENTION_DAYS` | optional | `14` | Retention for generated exports | ⚪ | yes |
| `LOG_LEVEL` | optional | `info` | pino log level | ⚪ | yes |
| `RELEASE_SHA` | optional | the deployed commit SHA | Shown by `/api/version` | ⚪ | yes |
| `ENABLE_INPROCESS_CLEANUP` | optional | `false` on managed hosting | Disables the best-effort in-process timer | ⚪ | yes |
| `MAINTENANCE_TOKEN` | optional | `openssl rand -base64 32` (≥ 16 chars) | Enables `POST /api/maintenance/cleanup` for an external scheduler | 🔴 | yes |
| `AI_PROVIDER` | required | `none` (initially) | AI provider; stays `none` until governance sign-off | ⚪ | yes |
| `AI_MODEL` | optional | e.g. `claude-sonnet-5` | Model id (only when AI enabled) | ⚪ | yes |
| `ANTHROPIC_API_KEY` | optional | — | Only when `AI_PROVIDER=anthropic` | 🔴 | yes |
| `OPENAI_API_KEY` | optional | — | Only when `AI_PROVIDER=openai` | 🔴 | yes |
| `AI_MAX_PROMPT_CHARS` | optional | `2000` | Max user prompt size | ⚪ | yes |
| `AI_MAX_EVIDENCE_RECORDS` | optional | `40` | Data-minimisation cap on evidence sent to provider | ⚪ | yes |
| `AI_MAX_RESPONSE_TOKENS` | optional | `4096` | Response token cap | ⚪ | yes |
| `AI_TIMEOUT_MS` | optional | `60000` | Provider request timeout | ⚪ | yes |
| `AI_RETRY_COUNT` | optional | `1` | Bounded retries on 429/5xx | ⚪ | yes |
| `AI_USER_DAILY_LIMIT` | optional | `50` | Per-user daily AI requests | ⚪ | yes |
| `AI_ORG_DAILY_LIMIT` | optional | `500` | Org-wide daily AI requests | ⚪ | yes |
| `AI_ORG_DAILY_TOKEN_LIMIT` | optional | `2000000` | Org-wide daily token budget | ⚪ | yes |

## Notes

- **Do not upload a `.env` file with secrets to GitHub.** Use hPanel’s
  Environment Variables UI. `.gitignore` already excludes `.env*` (only
  `*.example` templates are committed).
- **`UPLOAD_DIR` / `EXPORT_DIR` are relative** (`./uploads`, `./exports`) so no
  absolute Hostinger path is assumed. **Persistence across redeploys is not yet
  verified** — read `HOSTINGER_STORAGE_ASSESSMENT.md` before relying on local
  file durability.
- Production startup validation refuses to boot if `JWT_SECRET` is missing/weak,
  `DB_CLIENT` is SQLite, MySQL vars are incomplete, or `CORS_ORIGIN` is missing.
