#!/bin/bash
# Score a cell: for each captured milestone checkpoint, clone its DB snapshot,
# check out its git tag, run that checkpoint's CUJ suite, then the LLM judge.
#
# Usage: ./s-score.sh <cellId> [attempts]   (attempts default 1; spike used 2
# to prove determinism — proven IDENTICAL on 2026-07-29, so default is 1)
set -uo pipefail

BENCH="$(cd "$(dirname "$0")" && pwd)"
CELL="${1:?cellId required}"
ATTEMPTS="${2:-1}"
SUM="$BENCH/results/s-cell/$CELL.summary.json"
CHECKOUT="$BENCH/results/s-cell/checkouts/$CELL"
OUT_DIR="$BENCH/results/s-score"
mkdir -p "$OUT_DIR"

[[ -f "$SUM" ]] || { echo "no summary at $SUM"; exit 1; }
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

MILESTONES=$(node -e "console.log(require('$SUM').milestones.map(x=>x.m).join(' '))")
for M in $MILESTONES; do
  SNAP=$(node -e "const s=require('$SUM');console.log(s.milestones.find(x=>x.m===$M)?.snapshotDb ?? '')")
  if [[ -z "$SNAP" ]]; then echo "[s-score] m$M: no snapshot, skipping"; continue; fi
  for ATTEMPT in $(seq 1 "$ATTEMPTS"); do
    LABEL="sim_score_$(echo "$CELL" | tr -c 'a-z0-9' '_' | sed 's/_*$//')_m${M}_a$ATTEMPT"
    dropdb --if-exists "$LABEL" 2>/dev/null || true
    echo "[s-score] m$M attempt $ATTEMPT: cloning $SNAP -> $LABEL"
    CLONE_JSON=$(curl -sf -X POST http://127.0.0.1:7788/__sim/clone \
      -H 'content-type: application/json' \
      -d "{\"snapshot\":\"$SNAP\",\"label\":\"$LABEL\"}") || { echo "clone failed"; continue; }
    DATABASE_URL=$(node -e "console.log(JSON.parse(process.argv[1]).connection_uri)" "$CLONE_JSON")
    AUTH_URL=$(node -e "console.log(JSON.parse(process.argv[1]).auth_base_url)" "$CLONE_JSON")

    APP_DIR="$OUT_DIR/app-$CELL-m$M-a$ATTEMPT"
    rm -rf "$APP_DIR"
    git clone --quiet "$CHECKOUT" "$APP_DIR"
    git -C "$APP_DIR" checkout --quiet "checkpoint-m$M" || {
      echo "[s-score] m$M: tag checkout failed"; continue; }

    APP_DIR="$APP_DIR" \
    SCORE_OUT="$OUT_DIR/$CELL-ckpt$M-a$ATTEMPT.json" \
    SPEC="relay-crm/checkpoint-$M.spec.ts" \
    APP_PORT=3000 \
    DATABASE_URL="$DATABASE_URL" \
    NEON_AUTH_BASE_URL="$AUTH_URL" \
    NEON_AUTH_COOKIE_SECRET="$(openssl rand -hex 32)" \
    NODE_EXTRA_CA_CERTS="$BENCH/neon-sim/certs/ca.pem" \
    "$BENCH/cuj-tests/score-checkpoint.sh"

    echo "[s-score] m$M attempt $ATTEMPT:"
    cat "$OUT_DIR/$CELL-ckpt$M-a$ATTEMPT.json"; echo
    rm -rf "$APP_DIR"
  done

  echo "[s-score] judging m$M"
  node "$BENCH/judge/judge.mjs" --cell "$CELL" --milestone "$M" \
    || echo "[s-score] judge m$M failed (non-fatal)"
done
echo "[s-score] $CELL complete"
