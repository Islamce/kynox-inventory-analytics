# Hostinger Managed Node.js Web App — Primary Deployment Guide

**This is the primary, supported deployment path for Kynox Supply Chain
Intelligence Analytics.** It targets a Hostinger **Managed Node.js Web App +
Hostinger MySQL**. It does **not** use VPS, SSH, PM2, Nginx, Docker, Certbot,
systemd, symlink release directories, or PostgreSQL — those are not part of
this hosting model. (The older VPS scripts under `scripts/deployment/` and
`docs/DEPLOYMENT_HOSTINGER.md` / `docs/STAGING_DEPLOYMENT.md` are kept only as
an optional future appendix, clearly marked *not applicable to the current
managed Hostinger hosting plan*.)

Scope: **Analytics only.** Do not touch `www.kynox.io` or `wms.kynox.io`.

## Architecture

```
GitHub private repo (Islamce/kynox-inventory-analytics)
        ↓  Hostinger GitHub import
Hostinger Managed Node.js Web App  (Node 22, npm)
        ↓  npm ci  →  npm run build  →  node app.js
ONE Node process
        ├── Express API (/api/*)
        └── serves built React SPA (apps/web/dist) + SPA fallback
        ↓
Hostinger MySQL (DB_CLIENT=mysql2)
        ↓
analytics.kynox.io  (Hostinger-managed SSL + reverse proxy)
```

One process serves the API **and** the SPA. There is no separate frontend
process and no clustering.

## Exact hPanel build/start settings

| Setting | Value |
|---|---|
| Framework preset | **Express.js** (or **Other** if the monorepo isn't auto-detected) |
| Repository | `Islamce/kynox-inventory-analytics` |
| Branch / commit | the approved release commit `3dbc9531d…` (see release policy) |
| Repository root | `/` (repo root — **not** `apps/web`) |
| Node.js version | **22.x** (fallback **20.x** only if 22 fails and CI is green on 20) |
| Package manager | **npm** |
| Install command | `npm ci` (uses the committed root `package-lock.json`) |
| Build command | `npm run build` |
| Entry file | `app.js` (repo root) |
| Start command | `npm start` (runs `node app.js`) |
| Output directory | leave as the app runtime; if a field is mandatory use `apps/web/dist`, but the Express server must remain the runtime entry — **do not** serve the app as static-only |

`npm run build` compiles in the correct dependency order: shared-types →
analytics-engine → data-quality → ai-engine → API → web. `app.js` then loads
`apps/api/dist/server.js`, which listens on `process.env.PORT` (assigned by
Hostinger — never hardcoded).

## Root entry file (`app.js`)

Committed at the repo root. It verifies the compiled server exists (failing
with a clear, secret-free message in the deployment log otherwise) and then
`require`s `apps/api/dist/server.js`. It does **not** run migrations, spawn a
second process, or read secrets.

## What runs where

- **Managed by Hostinger:** the Node runtime, process lifecycle, restarts
  (Redeploy/Restart), reverse proxy, SSL, and log capture.
- **Managed by you (code/CI):** the build, the single entry file, DB
  migrations (a **separate controlled command**, never on startup — see
  `HOSTINGER_MIGRATION_AND_SEED.md`), and the environment-variable register
  (`HOSTINGER_ENVIRONMENT_VARIABLES.md`).

## Verified locally + in CI

A managed-host-style flow (clean `npm ci` → `npm run build` → controlled
`npm run migrate` → `node app.js` on **MySQL 8.4**) is executed on every push
by the CI job **“Hostinger managed-hosting build + start (MySQL)”** and was
run locally against MySQL 8.4.10, confirming: `/api/health` → `{"status":"ok"}`,
`/api/readiness` → `{"status":"ready"}` (real MySQL connectivity),
`/api/version` (with release SHA + environment), the SPA root and deep routes,
and unauthenticated `/api/datasets` → 401.

## Owner procedure

Follow `HOSTINGER_HPanel_CHECKLIST.md` step by step. Deploy first to the
Hostinger **temporary domain**, validate, then connect `analytics.kynox.io`
and enable managed SSL.
