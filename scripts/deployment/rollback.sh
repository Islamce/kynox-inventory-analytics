#!/usr/bin/env bash
# Rolls the `current` symlink back to the previous release (or a named one)
# and restarts the process. Database rollback is a separate, deliberate step.
#
# Usage:
#   rollback.sh                 # roll back to the most recent non-current release
#   rollback.sh <release-id>    # roll back to a specific releases/<release-id>
#
# Limitations (documented, by design):
# - This restores CODE only. If the deployment that is being rolled back ran a
#   schema migration, restore the matching pre-migration backup with
#   restore-db.sh, or run `npm run migrate:rollback -w @kynox/api` from the
#   rolled-back release if the migration is reversible.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

PM2_APP="${PM2_APP:-kynox-analytics-staging}"
TARGET_ID="${1:-}"

CURRENT_TARGET="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
[ -n "${CURRENT_TARGET}" ] || fail "No current release to roll back from"

if [ -n "${TARGET_ID}" ]; then
  TARGET="${RELEASES_DIR}/${TARGET_ID}"
else
  TARGET="$(ls -1dt "${RELEASES_DIR}"/*/ | sed 's:/$::' | grep -vFx "${CURRENT_TARGET}" | head -1 || true)"
fi
[ -n "${TARGET}" ] && [ -d "${TARGET}" ] || fail "No rollback target release found"
[ "$(readlink -f "${TARGET}")" != "${CURRENT_TARGET}" ] || fail "Target equals the current release"

log "Rolling back: ${CURRENT_TARGET} -> ${TARGET}"
ln -sfn "${TARGET}" "${CURRENT_LINK}.tmp" && mv -Tf "${CURRENT_LINK}.tmp" "${CURRENT_LINK}"

if command -v pm2 >/dev/null 2>&1; then
  DEPLOY_ROOT="${DEPLOY_ROOT}" pm2 startOrRestart "${CURRENT_LINK}/ecosystem.config.cjs" --only "${PM2_APP}" >>"${LOG_DIR}/deployment.log" 2>&1 || fail "pm2 restart failed"
fi

sleep 3
DEPLOY_ROOT="${DEPLOY_ROOT}" "${SCRIPT_DIR}/smoke-test.sh" || fail "Rollback smoke tests failed — investigate immediately"

log "ROLLBACK SUCCEEDED: current -> ${TARGET}"
log "Reminder: if the rolled-back deployment had run a schema migration, restore the pre-migration DB backup (restore-db.sh) or run migrate:rollback."
