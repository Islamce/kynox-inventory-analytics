#!/usr/bin/env bash
# Shared helpers for the Kynox deployment scripts.
# Sourced, not executed. Never prints secret values.

set -euo pipefail

: "${DEPLOY_ROOT:?DEPLOY_ROOT must be set (e.g. /home/USER/domains/staging-analytics.kynox.io)}"

SHARED_DIR="${DEPLOY_ROOT}/shared"
RELEASES_DIR="${DEPLOY_ROOT}/releases"
CURRENT_LINK="${DEPLOY_ROOT}/current"
LOG_DIR="${SHARED_DIR}/logs"
BACKUP_DIR="${SHARED_DIR}/backups"
ENV_FILE="${SHARED_DIR}/.env"

mkdir -p "${LOG_DIR}" "${BACKUP_DIR}"

timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

log() {
  # Timestamped log line to stdout and the deployment log.
  echo "[$(timestamp)] $*" | tee -a "${LOG_DIR}/deployment.log"
}

fail() {
  log "ERROR: $*"
  exit 1
}

require_file() {
  [ -f "$1" ] || fail "Required file missing: $1"
}

# Loads shared/.env into the environment WITHOUT echoing values.
load_env() {
  require_file "${ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
}

# Validates that a variable is set and non-empty, without printing its value.
require_var() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "Required environment variable ${name} is not set in ${ENV_FILE}"
}

# Database CLI helpers (Postgres via PG* env, MySQL via MYSQL_PWD) so
# passwords never appear in process listings or logs.
db_env() {
  require_var DB_CLIENT
  case "${DB_CLIENT}" in
    pg)
      export PGHOST="${DB_HOST}" PGPORT="${DB_PORT:-5432}" PGUSER="${DB_USER}" PGPASSWORD="${DB_PASSWORD}" PGDATABASE="${DB_NAME}"
      ;;
    mysql2)
      export MYSQL_PWD="${DB_PASSWORD}"
      ;;
    *)
      fail "Unsupported DB_CLIENT '${DB_CLIENT}' for deployment scripts (use pg or mysql2)"
      ;;
  esac
}
