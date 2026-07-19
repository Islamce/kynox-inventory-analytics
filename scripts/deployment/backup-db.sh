#!/usr/bin/env bash
# Database backup into shared/backups with timestamped filenames and
# retention pruning. Used standalone and automatically before migrations.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

load_env
db_env

STAMP="$(date -u +%Y%m%d-%H%M%S)"
case "${DB_CLIENT}" in
  pg)
    OUT="${BACKUP_DIR}/db-${DB_NAME}-${STAMP}.sql.gz"
    pg_dump --no-owner --no-privileges | gzip > "${OUT}" || fail "pg_dump failed"
    ;;
  mysql2)
    OUT="${BACKUP_DIR}/db-${DB_NAME}-${STAMP}.sql.gz"
    mysqldump -h "${DB_HOST}" -P "${DB_PORT:-3306}" -u "${DB_USER}" --single-transaction --routines "${DB_NAME}" | gzip > "${OUT}" || fail "mysqldump failed"
    ;;
esac

SIZE="$(du -h "${OUT}" | cut -f1)"
log "Backup written: ${OUT} (${SIZE})"

# Basic sanity: a dump below 1 KB is almost certainly broken.
BYTES="$(stat -c%s "${OUT}")"
[ "${BYTES}" -ge 1024 ] || fail "Backup file suspiciously small (${BYTES} bytes)"

# Retention pruning
DELETED="$(find "${BACKUP_DIR}" -name 'db-*.sql.gz' -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)"
[ "${DELETED}" -gt 0 ] && log "Pruned ${DELETED} backup(s) older than ${RETENTION_DAYS} days"

echo "${OUT}"
