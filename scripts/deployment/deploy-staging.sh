#!/usr/bin/env bash
# Symlink-based staging deployment.
#
# Usage:
#   DEPLOY_ROOT=/home/USER/domains/staging-analytics.kynox.io \
#   REPO_URL=<git-url> \
#   GIT_REF=v0.1.0-rc.1 \
#     ./deploy-staging.sh
#
# Flow: new release dir -> checkout approved commit -> npm ci -> build ->
# preflight -> DB backup -> migrate -> switch symlink -> restart -> smoke test.
# On smoke-test failure the previous release is restored automatically.
# The current release is NEVER overwritten in place.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

: "${REPO_URL:?REPO_URL must be set (git URL or local path of the repository)}"
: "${GIT_REF:?GIT_REF must be set to the approved tag or commit SHA (e.g. v0.1.0-rc.1)}"
PM2_APP="${PM2_APP:-kynox-analytics-staging}"

RELEASE_ID="$(date -u +%Y%m%d-%H%M%S)-${GIT_REF//\//-}"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"
PREV_TARGET="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"

log "Deploying ${GIT_REF} to ${RELEASE_DIR} (previous: ${PREV_TARGET:-none})"

# 1. Create the release directory and check out the exact approved commit.
mkdir -p "${RELEASE_DIR}"
git clone --no-checkout "${REPO_URL}" "${RELEASE_DIR}" >>"${LOG_DIR}/deployment.log" 2>&1 || fail "git clone failed"
git -C "${RELEASE_DIR}" checkout --detach "${GIT_REF}" >>"${LOG_DIR}/deployment.log" 2>&1 || fail "checkout of ${GIT_REF} failed"
DEPLOYED_SHA="$(git -C "${RELEASE_DIR}" rev-parse HEAD)"
log "Checked out ${DEPLOYED_SHA}"

# Guard: refuse a dirty working tree (deploys must come from committed code).
[ -z "$(git -C "${RELEASE_DIR}" status --porcelain)" ] || fail "Release checkout is not clean"

# 2. Link shared state into the release (env, uploads, exports).
ln -sfn "${ENV_FILE}" "${RELEASE_DIR}/.env"
rm -rf "${RELEASE_DIR}/uploads" "${RELEASE_DIR}/exports"
ln -sfn "${SHARED_DIR}/uploads" "${RELEASE_DIR}/uploads"
ln -sfn "${SHARED_DIR}/exports" "${RELEASE_DIR}/exports"

# 3. Install and build.
log "npm ci ..."
(cd "${RELEASE_DIR}" && npm ci --no-audit --no-fund) >>"${LOG_DIR}/deployment.log" 2>&1 || fail "npm ci failed"
log "npm run build ..."
(cd "${RELEASE_DIR}" && npm run build) >>"${LOG_DIR}/deployment.log" 2>&1 || fail "build failed"

# 4. Preflight (env completeness, DB connectivity, disk, permissions).
DEPLOY_ROOT="${DEPLOY_ROOT}" "${SCRIPT_DIR}/preflight.sh" || fail "preflight failed"

# 5. Backup before migrating.
BACKUP_FILE="$(DEPLOY_ROOT="${DEPLOY_ROOT}" "${SCRIPT_DIR}/backup-db.sh" | tail -1)"
log "Pre-migration backup: ${BACKUP_FILE}"

# 6. Migrations (additive; rollback path is scripts/deployment/rollback.sh).
log "Running migrations ..."
(cd "${RELEASE_DIR}" && npm run migrate -w @kynox/api) >>"${LOG_DIR}/deployment.log" 2>&1 || fail "migrations failed"

# First deployment only: seed the staging administrator + default config.
if [ "${RUN_SEED:-false}" = "true" ]; then
  log "Running seed (first deployment) ..."
  (cd "${RELEASE_DIR}" && npm run seed -w @kynox/api) >>"${LOG_DIR}/deployment.log" 2>&1 || fail "seed failed"
fi

# 7. Switch the current symlink atomically.
ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}.tmp" && mv -Tf "${CURRENT_LINK}.tmp" "${CURRENT_LINK}"
log "Symlink switched: current -> ${RELEASE_DIR}"

# 8. Restart the process.
if command -v pm2 >/dev/null 2>&1; then
  DEPLOY_ROOT="${DEPLOY_ROOT}" pm2 startOrRestart "${CURRENT_LINK}/ecosystem.config.cjs" --only "${PM2_APP}" >>"${LOG_DIR}/deployment.log" 2>&1 || fail "pm2 restart failed"
  log "pm2 restarted ${PM2_APP}"
else
  log "pm2 not found — restart the Node process via the hosting panel, then re-run smoke-test.sh"
fi

# 9. Smoke tests with automatic rollback of the symlink on failure.
sleep 3
if ! DEPLOY_ROOT="${DEPLOY_ROOT}" "${SCRIPT_DIR}/smoke-test.sh"; then
  log "SMOKE TESTS FAILED — rolling back symlink"
  if [ -n "${PREV_TARGET}" ] && [ -d "${PREV_TARGET}" ]; then
    ln -sfn "${PREV_TARGET}" "${CURRENT_LINK}.tmp" && mv -Tf "${CURRENT_LINK}.tmp" "${CURRENT_LINK}"
    if command -v pm2 >/dev/null 2>&1; then
      DEPLOY_ROOT="${DEPLOY_ROOT}" pm2 startOrRestart "${CURRENT_LINK}/ecosystem.config.cjs" --only "${PM2_APP}" >>"${LOG_DIR}/deployment.log" 2>&1 || true
    fi
    log "Rolled back to ${PREV_TARGET}. If the failing migration changed the schema, restore the DB: restore-db.sh ${BACKUP_FILE}"
  else
    log "No previous release to roll back to."
  fi
  exit 1
fi

# 10. Keep only the last 5 releases.
ls -1dt "${RELEASES_DIR}"/*/ 2>/dev/null | tail -n +6 | while read -r old; do
  [ "$(readlink -f "$old")" = "$(readlink -f "${CURRENT_LINK}")" ] && continue
  rm -rf "$old"
  log "Pruned old release: $old"
done

log "DEPLOYMENT SUCCEEDED: ${GIT_REF} (${DEPLOYED_SHA}) is live as ${RELEASE_ID}"
