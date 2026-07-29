#!/bin/bash
# Score one checkpoint of a built app against a CUJ suite.
#
# Env/args:
#   APP_DIR      (required) git checkout at a checkpoint tag
#   SCORE_OUT    (required) path for the summary JSON
#   DATABASE_URL, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET
#                (required) pre-provisioned by the caller from a neon-sim clone
#   APP_PORT     (default 3000)
#   SPEC         (default relay-crm/checkpoint-1.spec.ts)
#   NODE_EXTRA_CA_CERTS  passed through to the app server so the serverless
#                driver can reach neon-sim's TLS edge
#
# Always exits 0 unless the scorer itself breaks: failed builds and failed CUJs
# are recorded as data in SCORE_OUT, not treated as CI failures.
set -uo pipefail

CUJ_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${APP_DIR:?APP_DIR required}"
SCORE_OUT="${SCORE_OUT:?SCORE_OUT required}"
APP_PORT="${APP_PORT:-3000}"
SPEC="${SPEC:-relay-crm/checkpoint-1.spec.ts}"
: "${DATABASE_URL:?DATABASE_URL required}"
: "${NEON_AUTH_BASE_URL:?NEON_AUTH_BASE_URL required}"
: "${NEON_AUTH_COOKIE_SECRET:?NEON_AUTH_COOKIE_SECRET required}"

mkdir -p "$(dirname "$SCORE_OUT")" "$CUJ_DIR/results"
BUILD_LOG="$(dirname "$SCORE_OUT")/build-$(basename "$SCORE_OUT" .json).log"
CUJ_JSON="$(dirname "$SCORE_OUT")/cuj-$(basename "$SCORE_OUT")"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    pkill -P "$SERVER_PID" 2>/dev/null || true
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

write_summary() {
  # $1 buildStatus  $2 cujPassed  $3 cujTotal  $4 failures-json-array
  node -e "
    require('fs').writeFileSync(process.argv[1], JSON.stringify({
      buildStatus: process.argv[2],
      cujPassed: Number(process.argv[3]),
      cujTotal: Number(process.argv[4]),
      failures: JSON.parse(process.argv[5]),
      spec: process.argv[6],
      appDir: process.argv[7],
      scoredAt: new Date().toISOString(),
    }, null, 2))
  " "$SCORE_OUT" "$1" "$2" "$3" "$4" "$SPEC" "$APP_DIR"
  echo "[score] $1: $2/$3 -> $SCORE_OUT"
}

count_total() {
  (cd "$CUJ_DIR" && npx playwright test "$SPEC" --list 2>/dev/null | grep -cE '›|\.spec\.ts:') || echo 0
}

# Env file: the checkout does not carry .env.local (gitignored in templates).
cat > "$APP_DIR/.env.local" <<EOF
DATABASE_URL=$DATABASE_URL
POSTGRES_URL=$DATABASE_URL
NEON_AUTH_BASE_URL=$NEON_AUTH_BASE_URL
NEON_AUTH_COOKIE_SECRET=$NEON_AUTH_COOKIE_SECRET
EOF

echo "[score] pnpm install in $APP_DIR"
if ! (cd "$APP_DIR" && pnpm install --prefer-offline >> "$BUILD_LOG" 2>&1); then
  write_summary "install_failed" 0 "$(count_total)" "[]"
  exit 0
fi

echo "[score] next build (lint skipped: the build gate is compile/type errors;"
echo "        template eslint import-resolver false-positives are not model quality)"
if ! (cd "$APP_DIR" && npx next build --no-lint >> "$BUILD_LOG" 2>&1); then
  write_summary "build_failed" 0 "$(count_total)" "[]"
  exit 0
fi

echo "[score] starting app on :$APP_PORT"
(cd "$APP_DIR" && exec npx next start -p "$APP_PORT" >> "$BUILD_LOG" 2>&1) &
SERVER_PID=$!

# Readiness taxonomy: "server_not_ready" = the port never answered at all
# (infra suspicion — retryable); "server_error" = the server IS listening but
# the pinned route never returned 200 (model-quality failure, scored as such).
ready=""
listening=""
for _ in $(seq 1 120); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://localhost:$APP_PORT/auth/sign-in" || true)
  if [[ "$code" == "200" ]]; then ready=1; break; fi
  # Any HTTP status (even 000-with-body-later, 404, 500) means something is
  # bound to the port; curl reports 000 only on connection failure.
  if [[ "$code" != "000" ]]; then listening=1; fi
  sleep 1
done
if [[ -z "$ready" ]]; then
  if [[ -n "$listening" ]]; then
    write_summary "server_error" 0 "$(count_total)" "[]"
  else
    write_summary "server_not_ready" 0 "$(count_total)" "[]"
  fi
  exit 0
fi

echo "[score] running CUJ suite $SPEC"
(cd "$CUJ_DIR" && APP_URL="http://localhost:$APP_PORT" CUJ_RESULTS="$CUJ_JSON" \
  npx playwright test "$SPEC" > /dev/null 2>&1) || true

if [[ ! -f "$CUJ_JSON" ]]; then
  write_summary "cuj_runner_failed" 0 "$(count_total)" "[]"
  exit 0
fi

read -r PASSED TOTAL FAILURES < <(node -e "
  const r = require('$CUJ_JSON');
  const tests = [];
  const walk = (s) => { (s.suites||[]).forEach(walk); (s.specs||[]).forEach(sp => tests.push(sp)); };
  (r.suites||[]).forEach(walk);
  const passed = tests.filter(t => t.ok).length;
  const failures = tests.filter(t => !t.ok).map(t => t.title.split(' ')[0]);
  console.log(passed, tests.length, JSON.stringify(failures));
")
write_summary "ok" "$PASSED" "$TOTAL" "$FAILURES"
