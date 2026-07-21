# Backup and Restore — Managed Hosting (MySQL)

Do **not** rely on application-directory backup as the only MySQL backup. The
database is the system of record for all analysis results, datasets, audit
trail, users and configuration.

## Backups

### A. Hostinger native backups
- hPanel → **Files/Databases → Backups**: confirm the plan’s automatic backup
  schedule and retention; enable if available. Note that app-directory backups
  may **not** include runtime-generated files.

### B. On-demand SQL export (before every migration/release)
From phpMyAdmin (hPanel → Databases → phpMyAdmin) **Export**, or via CLI where
available:

```bash
mysqldump -h <DB_HOST> -P 3306 -u <DB_USER> -p \
  --single-transaction --routines --no-tablespaces <DB_NAME> \
  | gzip > kynox_analytics-$(date -u +%Y%m%d-%H%M%S).sql.gz
```

- `--single-transaction` gives a consistent InnoDB snapshot without locking.
- Store the dump **off the app directory** (download it, or push to
  Backblaze B2 with Analytics-scoped credentials).
- **No migration runs against production without a fresh backup available.**

### C. Uploaded source files
If `HOSTINGER_STORAGE_ASSESSMENT.md` verification shows local uploads are
non-durable, back up `uploads/` (download or sync to B2) or move source-file
storage to object storage.

## Restore

### Validate into a SEPARATE database first (never overwrite production)
```bash
# create a temporary validation DB (e.g. kynox_analytics_validate) in hPanel, then:
gunzip -c kynox_analytics-YYYYMMDD-HHMMSS.sql.gz \
  | mysql -h <DB_HOST> -P 3306 -u <DB_USER> -p kynox_analytics_validate
# verify readability:
mysql -h <DB_HOST> -P 3306 -u <DB_USER> -p kynox_analytics_validate \
  -e "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM datasets) AS datasets;"
```
Confirm the admin user and datasets are present, then **drop the temporary
database**. Do not claim backup readiness until a restore validation succeeds.

### Emergency restore into production
Only after a confirmed-good dump and a decision to roll back data:
```bash
gunzip -c <good-dump>.sql.gz | mysql -h <DB_HOST> -P 3306 -u <DB_USER> -p <DB_NAME>
```

## Rollback relationship
- **Code rollback** = redeploy the previous release commit in hPanel.
- **Schema rollback** = `npm run migrate:rollback` (reverses the latest batch)
  or restore the pre-migration SQL dump. Code rollback alone does not undo a
  schema migration — pair it with the matching backup.

## Recommended cadence
- SQL dump: daily + immediately before any migration/release.
- Retain ≥ 30 days. Test a restore into a validation DB at least quarterly.
- Prefer an **offsite** copy (Backblaze B2, Analytics-scoped credentials).
