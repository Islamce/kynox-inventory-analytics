# Hostinger VPS Deployment Guide — analytics.kynox.io (APPENDIX — not the primary path)

> **NOT APPLICABLE to the current managed Hostinger hosting plan.** The primary,
> supported deployment path is **Hostinger Managed Node.js Web App + Hostinger
> MySQL** — see **`docs/HOSTINGER_MANAGED_DEPLOYMENT.md`** and
> **`docs/HOSTINGER_HPanel_CHECKLIST.md`**. This document (pm2 / Nginx / Certbot
> / symlink releases / PostgreSQL) is retained only as **optional future VPS
> guidance** should the platform later move to a Hostinger VPS. Do not follow it
> for the managed Node.js Web App deployment.

---


This deployment is fully independent of `www.kynox.io` and the existing WMS.
Nothing here touches their files, databases or DNS records other than adding
one new subdomain.

## Prerequisites

- Hostinger plan with **Node.js support** (VPS recommended; shared hosting with
  Node.js app support also works)
- Node.js **20+** selected for the app
- A MySQL database (all Hostinger plans) or PostgreSQL (VPS) — **do not reuse
  the WMS database**; create a dedicated one

## 1. Subdomain

1. hPanel → Domains → `kynox.io` → **Subdomains** → create `analytics`.
2. Point it at a dedicated directory, e.g. `/home/USER/domains/analytics.kynox.io/app`.
3. Enable **SSL** for `analytics.kynox.io` (hPanel → SSL → install; verify the
   padlock after deployment). Force HTTPS.

## 2. Directory layout

```
/home/USER/domains/analytics.kynox.io/
└── app/                    # this repository
    ├── apps/api/dist/      # built API (entry: apps/api/dist/server.js)
    ├── apps/web/dist/      # built SPA (served by the API)
    ├── uploads/            # uploaded source files (writable)
    ├── exports/            # generated reports (writable)
    └── .env                # production environment (never in git)
```

## 3. Database setup

hPanel → Databases → create database + user, grant all privileges.
Then in `.env`:

```
DB_CLIENT=mysql2            # or pg on VPS
DB_HOST=localhost
DB_PORT=3306
DB_NAME=..._kynox_analytics
DB_USER=...
DB_PASSWORD=...
```

## 4. Build & first deployment

```bash
git clone <repo> app && cd app
npm ci
cp .env.example .env        # fill in DB, JWT_SECRET (openssl rand -base64 48),
                            # ADMIN_INITIAL_PASSWORD, CORS_ORIGIN=https://analytics.kynox.io
npm run build               # packages + api + web
npm run migrate             # creates schema
npm run seed                # admin user + default config (first time only)
```

## 5. Node application configuration

**hPanel Node.js app** (shared): set application root to `app`, startup file
`apps/api/dist/server.js`, Node 20+, and add the `.env` variables in the panel
(or keep the `.env` file — dotenv loads it).

**VPS (recommended)** — run under a process manager:

```bash
npm install -g pm2
pm2 start apps/api/dist/server.js --name kynox-analytics
pm2 save && pm2 startup     # restart on reboot
```

Reverse proxy assumption: Hostinger's LiteSpeed/Apache (or your Nginx on VPS)
terminates TLS on `analytics.kynox.io` and proxies to the Node port. The app
sets `trust proxy`, serves the SPA itself, and exposes everything under one
origin — so **no extra CORS configuration is needed** beyond
`CORS_ORIGIN=https://analytics.kynox.io`.

Nginx VPS example:

```nginx
server {
    server_name analytics.kynox.io;
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 60m;      # uploads
    }
}
```

## 6. Verify

```bash
curl https://analytics.kynox.io/api/health      # {"status":"ok"}
curl https://analytics.kynox.io/api/readiness   # {"status":"ready"}  (DB reachable)
curl https://analytics.kynox.io/api/version
```

Open `https://analytics.kynox.io`, log in with the admin account, change the
password (Administration → Users), create real users, upload a first report.

## 7. Updating a deployment

```bash
cd app
git pull
npm ci
npm run build
npm run migrate            # runs only new migrations; migrations are additive
pm2 restart kynox-analytics    # or restart via hPanel
curl -s https://analytics.kynox.io/api/readiness   # smoke test
```

## 8. Backup plan

Daily (cron or hPanel backup):

```bash
# MySQL
mysqldump -u$DB_USER -p$DB_PASSWORD $DB_NAME | gzip > backup/db-$(date +%F).sql.gz
# Uploaded source files (originals are the system of record for traceability)
tar czf backup/uploads-$(date +%F).tar.gz uploads/
```

Retain ≥ 30 days. Test a restore quarterly:
`gunzip < backup/db-DATE.sql.gz | mysql -u$DB_USER -p $DB_NAME`.

## 9. Rollback plan

1. `pm2 stop kynox-analytics`
2. `git checkout <previous-tag-or-commit> && npm ci && npm run build`
3. If the failing release included a migration:
   `npm run migrate:rollback` (rolls back the latest batch), or restore the DB
   backup taken before the deployment.
4. `pm2 start kynox-analytics` and re-run the health checks.

Tag every production release (`git tag vX.Y.Z && git push --tags`) so step 2 is
deterministic.

## 10. Logs

- Application: pm2 → `pm2 logs kynox-analytics` (or hPanel Node.js log view).
  JSON lines (pino); auth headers and secrets are redacted at the logger.
- Audit trail: in-app (Audit & Governance page) — this is the business-level log.

## 11. What this deployment never does

- No writes outside its own directory, database, `uploads/` and `exports/`.
- No connection to the WMS or `www.kynox.io` databases.
- No secrets in git, logs, or client responses.
