# Staging Deployment Runbook — staging-analytics.kynox.io

Target: **staging only**. Production (`analytics.kynox.io`) is out of scope of
this runbook. Nothing here touches `www.kynox.io` or `wms.kynox.io`.

## Release candidate

Deploy only a tag/commit that passed CI in full. The RC identity (SHA, tag,
CI run) is recorded in PR #1's staging section. Never deploy uncommitted files
— `deploy-staging.sh` clones the repository and refuses dirty checkouts by
construction.

## One-time host preparation (staging owner)

1. **Subdomain**: hPanel → Domains → `kynox.io` → Subdomains → create
   `staging-analytics` → directory `~/domains/staging-analytics.kynox.io` →
   enable SSL and force HTTPS.
2. **Runtime**: Node.js **22 LTS** (Node 20 acceptable if the panel lacks 22 —
   CI validates both).
3. **Database** (dedicated; never shared with WMS/production):
   ```sql
   -- PostgreSQL (preferred, VPS)
   CREATE DATABASE kynox_staging;
   CREATE USER kynox_staging_app WITH PASSWORD '<generated>';
   GRANT ALL PRIVILEGES ON DATABASE kynox_staging TO kynox_staging_app;
   \c kynox_staging
   GRANT ALL ON SCHEMA public TO kynox_staging_app;
   ```
   The app user owns only this database (least privilege). A separate
   migration user is unnecessary at this scale — migrations run as the app
   user inside its own database; revisit if DDL rights must be split later.
   MySQL fallback: create `kynox_staging` + user with rights on that schema only.
4. **Directory skeleton**:
   ```bash
   export DEPLOY_ROOT=$HOME/domains/staging-analytics.kynox.io
   mkdir -p $DEPLOY_ROOT/{releases,shared/{uploads,exports,logs,backups}}
   ```
5. **Environment**: copy `.env.staging.example` → `$DEPLOY_ROOT/shared/.env`,
   fill in the secrets (see "Secrets the owner must provide" below),
   `chmod 600 $DEPLOY_ROOT/shared/.env`.
6. **pm2**: `npm i -g pm2 && pm2 startup` (follow the printed command).
7. **Reverse proxy**: point the subdomain at the app port (`PORT` in shared/.env,
   e.g. 4100) exactly as in `docs/DEPLOYMENT_HOSTINGER.md` §5, with
   `client_max_body_size 60m`.

## Secrets the owner must provide (never committed anywhere)

| Variable | How to produce |
|---|---|
| `JWT_SECRET` | `openssl rand -base64 48` |
| `DB_PASSWORD` | database user password from step 3 |
| `ADMIN_INITIAL_PASSWORD` | strong password for the seeded staging admin (rotate after first login) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | only when enabling AI, after the `docs/AI_GOVERNANCE.md` §data-exposure review; AI stays disabled (`AI_PROVIDER=none`) until then |

## Deploying a release

```bash
export DEPLOY_ROOT=$HOME/domains/staging-analytics.kynox.io
export REPO_URL=https://github.com/Islamce/kynox-inventory-analytics.git
export GIT_REF=v0.1.0-rc.1          # the approved RC tag
RUN_SEED=true \                      # first deployment only
  $DEPLOY_ROOT/current/scripts/deployment/deploy-staging.sh 2>/dev/null \
  || bash <(git archive --remote=$REPO_URL $GIT_REF scripts/deployment/deploy-staging.sh | tar -xO)  # bootstrap when no 'current' exists yet
```

Simplest first-time bootstrap: clone once manually, then always use the script:

```bash
git clone $REPO_URL /tmp/kynox-bootstrap && \
DEPLOY_ROOT=$DEPLOY_ROOT REPO_URL=$REPO_URL GIT_REF=v0.1.0-rc.1 RUN_SEED=true \
  /tmp/kynox-bootstrap/scripts/deployment/deploy-staging.sh
```

The script performs, in order: release dir → exact-commit checkout → `npm ci`
→ build → preflight (env/DB/disk/permissions) → **DB backup** → migrations →
atomic symlink switch → pm2 restart → smoke tests → **automatic symlink
rollback on smoke failure** → old-release pruning. All steps append to
`shared/logs/deployment.log` with UTC timestamps; secrets are never printed.

## Verifying

```bash
DEPLOY_ROOT=$DEPLOY_ROOT ./scripts/deployment/smoke-test.sh                 # local port
BASE_URL=https://staging-analytics.kynox.io DEPLOY_ROOT=$DEPLOY_ROOT ./scripts/deployment/smoke-test.sh  # through TLS
```

## Backup / restore / rollback

```bash
DEPLOY_ROOT=$DEPLOY_ROOT ./scripts/deployment/backup-db.sh
DEPLOY_ROOT=$DEPLOY_ROOT ./scripts/deployment/restore-db.sh shared/backups/db-...sql.gz --validate kynox_staging_validate
DEPLOY_ROOT=$DEPLOY_ROOT ./scripts/deployment/rollback.sh          # code rollback to previous release
```

Rollback limitation (also printed by the script): `rollback.sh` restores code
only. If the rolled-back deployment ran a schema migration, restore the
pre-migration backup or run `npm run migrate:rollback -w @kynox/api` from the
rolled-back release. Backups are pruned after `BACKUP_RETENTION_DAYS` (14).

## Isolation guarantees

- Dedicated DB + DB user; nothing references WMS/production credentials.
- Dedicated `shared/{uploads,exports,logs,backups}` under the staging domain
  directory only.
- `CORS_ORIGIN=https://staging-analytics.kynox.io` — production origin not allowed.
- The deployment scripts operate exclusively under `$DEPLOY_ROOT`.
