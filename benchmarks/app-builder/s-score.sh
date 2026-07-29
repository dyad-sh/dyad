#!/bin/bash
# S-SCORE spike: score a cell's checkpoint-1 from its archived checkout +
# DB snapshot, twice (fresh clone per attempt) to check determinism.
#
# Usage: ./s-score.sh <cellId>   e.g. ./s-score.sh claude-sonnet-5-relay-crm
set -euo pipefail

BENCH="$(cd "$(dirname "$0")" && pwd)"
CELL="${1:?cellId required}"
SUM="$BENCH/results/s-cell/$CELL.summary.json"
CHECKOUT="$BENCH/results/s-cell/checkouts/$CELL"
OUT_DIR="$BENCH/results/s-score"
mkdir -p "$OUT_DIR"

SNAP=$(node -e "console.log(require('$SUM').milestones[0].snapshotDb)")
[[ -n "$SNAP" && "$SNAP" != "undefined" ]] || { echo "no snapshotDb in $SUM"; exit 1; }
[[ -d "$CHECKOUT" ]] || { echo "no archived checkout at $CHECKOUT"; exit 1; }

if ! curl -sf http://127.0.0.1:7788/__sim/state >/dev/null 2>&1; then
  echo "[s-score] starting neon-sim…"
  (cd "$BENCH/neon-sim" && node server.mjs > "$BENCH/neon-sim/server-score.log" 2>&1) &
  SIM_PID=$!
  trap '[[ -n "${SIM_PID:-}" ]] && kill $SIM_PID 2>/dev/null || true' EXIT
  for i in $(seq 1 20); do
    curl -sf http://127.0.0.1:7788/__sim/state >/dev/null 2>&1 && break
    sleep 1
  done
fi

for ATTEMPT in 1 2; do
  LABEL="sim_score_$(echo "$CELL" | tr -c 'a-z0-9' '_' | sed 's/_*$//')_a$ATTEMPT"
  echo "[s-score] attempt $ATTEMPT: cloning $SNAP -> $LABEL"
  CLONE_JSON=$(curl -sf -X POST http://127.0.0.1:7788/__sim/clone \
    -H 'content-type: application/json' \
    -d "{\"snapshot\":\"$SNAP\",\"label\":\"$LABEL\"}")
  DATABASE_URL=$(node -e "console.log(JSON.parse(process.argv[1]).connection_uri)" "$CLONE_JSON")
  AUTH_URL=$(node -e "console.log(JSON.parse(process.argv[1]).auth_base_url)" "$CLONE_JSON")

  APP_DIR="$OUT_DIR/app-$CELL-a$ATTEMPT"
  rm -rf "$APP_DIR"
  git clone --quiet "$CHECKOUT" "$APP_DIR"
  git -C "$APP_DIR" checkout --quiet checkpoint-m1

  APP_DIR="$APP_DIR" \
  SCORE_OUT="$OUT_DIR/$CELL-ckpt1-a$ATTEMPT.json" \
  SPEC=relay-crm/checkpoint-1.spec.ts \
  APP_PORT=3000 \
  DATABASE_URL="$DATABASE_URL" \
  NEON_AUTH_BASE_URL="$AUTH_URL" \
  NEON_AUTH_COOKIE_SECRET="$(openssl rand -hex 32)" \
  NODE_EXTRA_CA_CERTS="$BENCH/neon-sim/certs/ca.pem" \
  "$BENCH/cuj-tests/score-checkpoint.sh"

  echo "[s-score] attempt $ATTEMPT result:"
  cat "$OUT_DIR/$CELL-ckpt1-a$ATTEMPT.json"
  echo
done

node -e "
const a=require('$OUT_DIR/$CELL-ckpt1-a1.json'), b=require('$OUT_DIR/$CELL-ckpt1-a2.json');
const same = a.cujPassed===b.cujPassed && JSON.stringify(a.failures)===JSON.stringify(b.failures);
console.log('[s-score] determinism:', same ? 'IDENTICAL (' + a.cujPassed + '/' + a.cujTotal + ')' : 'DIVERGED', JSON.stringify({a1:{p:a.cujPassed,f:a.failures},a2:{p:b.cujPassed,f:b.failures}}));
"
