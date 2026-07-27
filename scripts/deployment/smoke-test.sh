#!/usr/bin/env bash
# Post-deployment smoke tests. Non-destructive; safe to run repeatedly.
# BASE_URL defaults to the local port from shared/.env.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

load_env
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
FAILURES=0

check() {
  local name="$1" url="$2" expect="$3"
  local body status
  status="$(curl -sS -o /tmp/smoke-body.$$ -w '%{http_code}' --max-time 15 "${url}" || echo 000)"
  body="$(cat /tmp/smoke-body.$$ 2>/dev/null || true)"
  rm -f /tmp/smoke-body.$$
  if [ "${status}" = "200" ] && echo "${body}" | grep -q "${expect}"; then
    log "SMOKE PASS: ${name}"
  else
    log "SMOKE FAIL: ${name} (status ${status})"
    FAILURES=$((FAILURES + 1))
  fi
}

log "Smoke tests against ${BASE_URL}"

# 1. Health (no auth, no sensitive data)
check "health endpoint" "${BASE_URL}/api/health" '"status":"ok"'

# 2. Readiness (real DB connectivity)
check "readiness endpoint (DB connectivity)" "${BASE_URL}/api/readiness" '"status":"ready"'

# 3. Version
check "version endpoint" "${BASE_URL}/api/version" '"version"'

# 4. SPA served
check "SPA index served" "${BASE_URL}/" '<div id="root">'

# 5. SPA deep-route fallback
check "SPA deep route fallback" "${BASE_URL}/inventory" '<div id="root">'

# 6. Auth is enforced (expect 401, not 200/500)
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "${BASE_URL}/api/datasets" || echo 000)"
if [ "${STATUS}" = "401" ]; then
  log "SMOKE PASS: unauthenticated API access rejected (401)"
else
  log "SMOKE FAIL: expected 401 for unauthenticated /api/datasets, got ${STATUS}"
  FAILURES=$((FAILURES + 1))
fi

# 7. Response time: health must answer in under 2 seconds
T="$(curl -sS -o /dev/null -w '%{time_total}' --max-time 15 "${BASE_URL}/api/health" || echo 99)"
if awk "BEGIN{exit !(${T} < 2.0)}"; then
  log "SMOKE PASS: health response time ${T}s"
else
  log "SMOKE FAIL: health response time ${T}s (>= 2s)"
  FAILURES=$((FAILURES + 1))
fi

if [ "${FAILURES}" -gt 0 ]; then
  fail "Smoke tests failed: ${FAILURES} failure(s)"
fi
log "SMOKE TESTS: ALL PASSED"
