#!/usr/bin/env bash
# Pre-deployment validation. Run before every staging deployment.
# Exit non-zero on any problem; prints no secret values.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

log "Preflight: starting checks for ${DEPLOY_ROOT}"

# 1. Node version
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')" || fail "Node.js not found"
[ "${NODE_MAJOR}" -ge 20 ] || fail "Node.js >= 20 required, found $(node -v)"
log "Preflight: Node.js $(node -v) OK"

# 2. Directory structure
mkdir -p "${RELEASES_DIR}" "${SHARED_DIR}/uploads" "${SHARED_DIR}/exports" "${LOG_DIR}" "${BACKUP_DIR}"
log "Preflight: directory structure OK"

# 3. Environment file completeness (names only, never values)
load_env
for v in NODE_ENV PORT CORS_ORIGIN JWT_SECRET DB_CLIENT DB_HOST DB_NAME DB_USER DB_PASSWORD UPLOAD_DIR EXPORT_DIR; do
  require_var "$v"
done
[ "${#JWT_SECRET}" -ge 32 ] || fail "JWT_SECRET is shorter than 32 characters"
[ "${NODE_ENV}" = "production" ] || fail "NODE_ENV must be 'production' (staging runs with production safety checks)"
log "Preflight: environment file complete (values not shown)"

# 4. Database connectivity
db_env
case "${DB_CLIENT}" in
  pg)    psql -tAc 'select 1' >/dev/null || fail "PostgreSQL connection failed" ;;
  mysql2) mysql -h "${DB_HOST}" -P "${DB_PORT:-3306}" -u "${DB_USER}" "${DB_NAME}" -e 'select 1' >/dev/null || fail "MySQL connection failed" ;;
esac
log "Preflight: database connection OK (${DB_CLIENT})"

# 5. Disk space (require >= 2 GB free)
FREE_KB="$(df -Pk "${DEPLOY_ROOT}" | awk 'NR==2 {print $4}')"
[ "${FREE_KB}" -ge 2097152 ] || fail "Less than 2 GB free disk space at ${DEPLOY_ROOT}"
log "Preflight: disk space OK ($((FREE_KB / 1024)) MB free)"

# 6. Writable shared directories
for d in "${SHARED_DIR}/uploads" "${SHARED_DIR}/exports" "${LOG_DIR}" "${BACKUP_DIR}"; do
  touch "${d}/.preflight" && rm -f "${d}/.preflight" || fail "Directory not writable: ${d}"
done
log "Preflight: shared directories writable"

log "Preflight: ALL CHECKS PASSED"
