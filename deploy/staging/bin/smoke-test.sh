#!/usr/bin/env bash
# Staging smoke test — verifies core functionality after deployment.
# Usage: bash deploy/staging/bin/smoke-test.sh [BASE_URL]
set -euo pipefail

BASE_URL="${1:-https://staging.webcli.royding.ai}"
PASS=0
FAIL=0

check() {
  local label="$1"
  shift
  if eval "$*" >/dev/null 2>&1; then
    echo "  ✓ ${label}"
    PASS=$((PASS + 1))
  else
    echo "  ✗ ${label}"
    FAIL=$((FAIL + 1))
  fi
}

echo "Smoke testing ${BASE_URL}"
echo ""

# 1. Health check
echo "[Health]"
HEALTH=$(curl -sS --connect-timeout 10 "${BASE_URL}/api/health")
check "health returns ok" "echo '${HEALTH}' | python3 -c 'import sys,json; assert json.load(sys.stdin)[\"status\"] == \"ok\"'"
check "runtime connected" "echo '${HEALTH}' | python3 -c 'import sys,json; assert json.load(sys.stdin)[\"runtime\"][\"connected\"] == True'"

# 2. Frontend
echo "[Frontend]"
HTTP_CODE=$(curl -sS --connect-timeout 10 -o /dev/null -w '%{http_code}' "${BASE_URL}")
check "frontend returns 200" "[ '${HTTP_CODE}' = '200' ]"

FRONTEND=$(curl -sS --connect-timeout 10 "${BASE_URL}")
check "HTML has doctype" "echo '${FRONTEND}' | grep -q 'doctype'"
check "loads JS bundle" "echo '${FRONTEND}' | grep -q '/assets/index-'"

# 3. Session API
echo "[Session API]"
CREATE_RESP=$(curl -sS --connect-timeout 10 -X POST "${BASE_URL}/api/sessions" -H "Content-Type: application/json" -d '{}')
SESSION_ID=$(echo "${CREATE_RESP}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["sessionId"])')
check "create session" "[ -n '${SESSION_ID}' ]"

LIST_CODE=$(curl -sS --connect-timeout 10 -o /dev/null -w '%{http_code}' "${BASE_URL}/api/sessions")
check "list sessions returns 200" "[ '${LIST_CODE}' = '200' ]"

DEL_CODE=$(curl -sS --connect-timeout 10 -o /dev/null -w '%{http_code}' -X DELETE "${BASE_URL}/api/sessions/${SESSION_ID}")
check "delete session returns 204" "[ '${DEL_CODE}' = '204' ]"

# 4. WebSocket
echo "[WebSocket]"
WS_SESSION=$(curl -sS --connect-timeout 10 -X POST "${BASE_URL}/api/sessions" -H "Content-Type: application/json" -d '{}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["sessionId"])')
WS_URL=$(echo "${BASE_URL}" | sed 's|^https://|wss://|; s|^http://|ws://|')

WS_RESULT=$(node -e "
const WebSocket = require('ws');
const ws = new WebSocket('${WS_URL}/ws/sessions/${WS_SESSION}');
ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'client.call', id: 'smoke-1',
    method: 'thread.list', params: { archived: false, limit: 1 }
  }));
});
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.id === 'smoke-1') { console.log('rpc_ok'); ws.close(); }
});
ws.on('error', () => { console.log('ws_error'); process.exit(1); });
setTimeout(() => { console.log('ws_timeout'); process.exit(1); }, 8000);
" 2>&1 || true)

check "WebSocket connects and RPC works" "echo '${WS_RESULT}' | grep -q 'rpc_ok'"

# 5. Bootstrap
echo "[Bootstrap]"
BOOT_CODE=$(curl -sS --connect-timeout 10 -o /dev/null -w '%{http_code}' "${BASE_URL}/api/bootstrap")
check "bootstrap returns 200" "[ '${BOOT_CODE}' = '200' ]"

BOOTSTRAP=$(curl -sS --connect-timeout 10 "${BASE_URL}/api/bootstrap")
check "bootstrap has models" "echo '${BOOTSTRAP}' | python3 -c 'import sys,json; assert len(json.load(sys.stdin)[\"models\"]) > 0'"

# Summary
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "${FAIL}" -eq 0 ] || exit 1
