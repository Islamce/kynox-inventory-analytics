# Migration and Seed Strategy — Managed Hosting

**The application does NOT run migrations automatically on startup.** Managed
hosting may restart or redeploy the process at any time; auto-migrations could
run repeatedly, race a partial deploy, lock tables, or start the app against an
incomplete schema. Migrations are a **separate, controlled command**, always
preceded by a backup.

## Golden rules
- Always **back up the MySQL database first** (`HOSTINGER_BACKUP_AND_RESTORE.md`).
- Run `knex migrate:latest` **once per release**, not on every restart.
- Migrations are **additive**; a reverse (`migrate:rollback`) exists and is
  CI-verified on MySQL.
- The seed is **idempotent**: it creates the first administrator only if none
  exists and **never resets an existing admin password**; no default
  credentials ship.

## Method A (preferred) — Hostinger app terminal / deployment command
If hPanel exposes a terminal or a post-deploy command for the app, run from the
app root (env vars already present in the managed environment):

```bash
# 1. Back up first (see backup doc).
# 2. Migrate.
npm run migrate            # = knex migrate:latest --knexfile knexfile.js (in apps/api)
# 3. First deployment only — seed the admin once.
npm run seed
```

## Method B — one-shot secured migration from CI (only if remote DB access is allowed)
If Hostinger permits a restricted remote MySQL connection, run migrations from a
**manually-triggered** GitHub Actions job whose DB credentials live in GitHub
Encrypted Secrets (never in the repo). Requirements: back up first, run
`migrate:latest`, capture output, fail clearly, never echo secrets, do not
re-run seeds. (Enable only if remote access can be IP-restricted/secured.)

## Verifying
```bash
# migration state / that the app can read the schema
curl -fsS https://<domain>/api/readiness      # {"status":"ready"} means MySQL reachable + schema usable
```

## Rollback of a bad migration
```bash
npm run migrate:rollback   # reverses the latest batch
# OR restore the pre-migration backup (HOSTINGER_BACKUP_AND_RESTORE.md) if the
# migration is not cleanly reversible.
```

## Seed safety
`apps/api/src/db/seeds/001_admin_user.js`:
- inserts the admin only when the email doesn’t already exist;
- takes the password from `ADMIN_INITIAL_PASSWORD` (or generates a random one
  printed **once** to the deploy log if unset);
- inserts default configuration only when missing.
Re-running it is safe (idempotent) and never overwrites an existing admin.
**Change the temporary admin password immediately after first login.**
