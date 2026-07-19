#!/usr/bin/env bash
# Restores a backup produced by backup-db.sh.
#
# Usage:
#   restore-db.sh <backup-file.sql.gz>                      # restore into the configured DB (DESTRUCTIVE)
#   restore-db.sh <backup-file.sql.gz> --validate <tempdb>  # restore into a temporary validation DB and
#                                                           # verify core tables are readable (non-destructive)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

BACKUP_FILE="${1:?Usage: restore-db.sh <backup-file.sql.gz> [--validate <tempdb>]}"
MODE="${2:-}"
VALIDATE_DB="${3:-}"

require_file "${BACKUP_FILE}"
load_env
db_env

TARGET_DB="${DB_NAME}"
if [ "${MODE}" = "--validate" ]; then
  [ -n "${VALIDATE_DB}" ] || fail "--validate requires a temporary database name"
  TARGET_DB="${VALIDATE_DB}"
fi

if [ "${MODE}" != "--validate" ]; then
  log "WARNING: restoring into the LIVE database '${TARGET_DB}' in 5 seconds (Ctrl-C to abort)"
  sleep 5
fi

case "${DB_CLIENT}" in
  pg)
    if [ "${MODE}" = "--validate" ]; then
      dropdb --if-exists "${TARGET_DB}" || true
      createdb "${TARGET_DB}" || fail "Could not create validation database ${TARGET_DB}"
    fi
    gunzip -c "${BACKUP_FILE}" | psql -v ON_ERROR_STOP=1 -d "${TARGET_DB}" >/dev/null || fail "psql restore failed"
    ROWS="$(psql -d "${TARGET_DB}" -tAc 'select (select count(*) from users) + (select count(*) from datasets)')" || fail "Restored data not readable"
    ;;
  mysql2)
    if [ "${MODE}" = "--validate" ]; then
      mysql -h "${DB_HOST}" -P "${DB_PORT:-3306}" -u "${DB_USER}" -e "DROP DATABASE IF EXISTS \`${TARGET_DB}\`; CREATE DATABASE \`${TARGET_DB}\`;" || fail "Could not create validation database"
    fi
    gunzip -c "${BACKUP_FILE}" | mysql -h "${DB_HOST}" -P "${DB_PORT:-3306}" -u "${DB_USER}" "${TARGET_DB}" || fail "mysql restore failed"
    ROWS="$(mysql -h "${DB_HOST}" -P "${DB_PORT:-3306}" -u "${DB_USER}" "${TARGET_DB}" -N -e 'select (select count(*) from users) + (select count(*) from datasets)')" || fail "Restored data not readable"
    ;;
esac

log "Restore into '${TARGET_DB}' OK — users+datasets row count: ${ROWS}"

if [ "${MODE}" = "--validate" ]; then
  log "Validation restore complete. Drop the temporary DB when done: ${TARGET_DB}"
fi
