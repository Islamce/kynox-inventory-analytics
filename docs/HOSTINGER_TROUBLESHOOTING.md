# Hostinger Deployment Troubleshooting

Diagnose from **hPanel deployment/runtime logs**. Symptoms → cause → fix.

## Plan / platform
- **No “Node.js Web App” under Add Website** → the plan doesn’t support managed
  Node apps. Options: upgrade to Business Web Hosting, upgrade to Cloud Hosting,
  deploy to a Hostinger VPS, or use another managed Node platform. Do **not**
  serve the API as static hosting.
- **GitHub repo not selectable / private repo not visible** → the Hostinger
  GitHub connection uses a different account. One plan links one GitHub account
  at a time; connect an account with access to `Islamce/kynox-inventory-analytics`.
  Assess WMS impact before changing an existing connection.

## Install failures
- **`better-sqlite3` native build error** → it is an **optional** dependency;
  `npm ci` should continue past it and production uses MySQL (`DB_CLIENT=mysql2`),
  which never loads it. If the install still hard-fails, confirm Node 22/20 and
  that the failure is truly the optional package (the log line names it), then
  proceed — the API does not require SQLite in production.
- **`xlsx` install fails** → it installs from the SheetJS CDN tarball (pinned
  `0.20.3`) which requires outbound network during install; retry the deploy;
  if the managed host blocks the CDN, mirror the tarball and update the
  dependency URL.
- **Wrong lockfile / peer errors** → ensure the build uses the **root**
  `package-lock.json` and `npm ci` (not `npm install`).

## Build failures
- **`Cannot find module '@kynox/*'` during typecheck/build** → shared packages
  weren’t built first. The root `npm run build` builds packages before API/web;
  ensure the build command is exactly `npm run build` at repo root.
- **Out-of-memory / killed build** → the SPA build is the heaviest step; retry;
  if it persists, the plan’s build resources are too low — consider Cloud
  Hosting. (Tests/coverage are **not** run during deploy — they stay in CI.)
- **Frontend not found at runtime** → the API serves `apps/web/dist`; confirm
  `npm run build` produced it and that the app runs the server entry, not a
  static output directory.

## Startup failures
- **Process exits 1 with “Refusing to start…”** → production startup validation
  found a problem; the log names each: weak/missing `JWT_SECRET`, `DB_CLIENT`
  is SQLite, missing MySQL vars, or missing `CORS_ORIGIN`. Fix the env vars and
  redeploy.
- **“Compiled server not found at apps/api/dist/server.js”** → the build didn’t
  run or failed; check the build log; ensure entry file is `app.js` and build
  command is `npm run build`.
- **App up but `/api/readiness` = 503** → MySQL not reachable: verify
  `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD`, that the user has rights on the
  DB, and `DB_SSL` matches the server’s requirement.

## Runtime
- **CORS errors in the browser** → `CORS_ORIGIN` must include the exact origin
  you’re loading (temporary domain during testing, then `analytics.kynox.io`).
  Comma-separate multiple; never `*`.
- **413 on upload** → file exceeds `MAX_UPLOAD_MB` (default 50) or the proxy
  body limit; adjust `MAX_UPLOAD_MB` and redeploy.
- **Uploads disappear after a redeploy** → expected if local storage isn’t
  persistent; see `HOSTINGER_STORAGE_ASSESSMENT.md`.
- **AI returns 503** → correct when `AI_PROVIDER=none`; the platform never
  fabricates analysis. Enable AI only after governance sign-off.

## Env changes not taking effect
Environment-variable changes require a **Redeploy/Restart** in hPanel.
