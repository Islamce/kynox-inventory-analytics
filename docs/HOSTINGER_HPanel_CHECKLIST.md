# hPanel Owner Checklist — Analytics Deployment

Precise owner actions in hPanel. No passwords are requested or stored here.
Code preparation is complete (see `HOSTINGER_DEPLOYMENT_READINESS.md`); the
steps below are the **owner hPanel actions**.

## Step 1 — Verify the plan supports Node.js Web Apps
hPanel → **Websites → Add Website**. Confirm **Node.js Web App** is offered.
Record the visible plan name.
> If **Node.js Web App is not available**: the current Hostinger plan does not
> expose Managed Node.js Web Apps. An upgrade to Business Web Hosting, Cloud
> Hosting, or a VPS may be required (see `HOSTINGER_TROUBLESHOOTING.md` §Plan).
> Do **not** attempt to run the API as static hosting.

## Step 2 — Create the dedicated MySQL database
hPanel → **Websites → Manage → Databases → Management**. Create a **dedicated**
Analytics database + user (e.g. `kynox_analytics` / `kynox_app`). **Do not reuse
WMS/website credentials.** Record host, database name, user, port (3306), and
DB version if shown. **Never write the password into Git or docs.**
Details: `HOSTINGER_MYSQL_SETUP.md`.

## Step 3 — Create the Node.js application from GitHub
**Add Website → Node.js Web App → Import Git Repository** → authorize the
GitHub account that can access `Islamce/kynox-inventory-analytics` (private).
> One Hostinger plan connects to one GitHub account at a time. If the WMS
> already uses a different GitHub account here, assess impact before changing —
> do not disconnect the WMS account blindly.

## Step 4 — Configure runtime (exact values)
- Node.js: **22**
- Framework: **Express.js** (or **Other**)
- Package manager: **npm**
- Repository root: **/**
- Build command: **`npm run build`**
- Entry file: **`app.js`**
- Start command: **`npm start`**

## Step 5 — Add environment variables
Enter every variable from `HOSTINGER_ENVIRONMENT_VARIABLES.md` (names + your
real values). Generate secrets **in hPanel/your machine**, never commit them.
Keep `AI_PROVIDER=none` for now. Changing env vars later requires a redeploy.

## Step 6 — Deploy to the temporary domain
Deploy. **Do not connect `analytics.kynox.io` yet.** Use the Hostinger
temporary preview domain first.

## Step 7 — Review deployment logs
Confirm in hPanel logs: dependency install, package build, server startup,
MySQL connection, and no missing entry file. Troubleshooting map:
`HOSTINGER_TROUBLESHOOTING.md`.

## Step 8 — Run the controlled migration
Run migrations via the controlled procedure in
`HOSTINGER_MIGRATION_AND_SEED.md` (back up first; `knex migrate:latest`). **Do
not** rely on startup migrations — the app does not run them automatically.

## Step 9 — Seed the initial administrator once
Run the seed once (idempotent: creates the admin only if none exists; never
resets an existing password). Log in and **immediately change the temporary
password**.

## Step 10 — Smoke tests on the temporary domain
Test: SPA root, a deep route, `/api/health`, `/api/readiness`, `/api/version`,
login, an unauthorized request (401), file upload, data import, export, audit
log. Full list: `HOSTINGER_UAT_CHECKLIST.md`.

## Step 11 — Connect the custom domain
Use Hostinger’s domain-connection workflow to attach `analytics.kynox.io`.
Follow Hostinger’s guidance for DNS — do not hand-craft records unless the
panel instructs it for this managed app. Do not modify `www`/`wms` records.

## Step 12 — Enable managed SSL
Enable Hostinger-managed SSL for `analytics.kynox.io`. Verify HTTPS and the
HTTP→HTTPS redirect.

## Step 13 — Final redeploy with production URLs
Set `APP_URL=https://analytics.kynox.io` and
`CORS_ORIGIN=https://analytics.kynox.io` (drop the temporary domain from CORS
once cutover is done). **Redeploy** so the changes take effect.

## Step 14 — Post-cutover smoke tests
Repeat Step 10 on `https://analytics.kynox.io`.

Record outcomes in the readiness table in
`HOSTINGER_DEPLOYMENT_READINESS.md`.
