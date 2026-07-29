#!/bin/bash
# S-CELL runner: one (model × Relay CRM × 3 milestones) cell through the
# patched headless harness against neon-sim + the engine recording proxy.
#
# Usage: ./run-cell.sh [engine-model-spec]   (default openai/gpt-5.6-luna)
# Reads DYAD_PRO_KEY from the repo .env.
set -euo pipefail

BENCH="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$BENCH/../.." && pwd)"
MODEL="${1:-openai/gpt-5.6-luna}"
CELL="$(echo "${MODEL##*/}" | tr -c 'a-zA-Z0-9.-' '_' | sed 's/_$//')-relay-crm"

if [[ -f "$REPO/.env" ]]; then
  set -a
  source "$REPO/.env"
  set +a
fi
: "${DYAD_PRO_KEY:?DYAD_PRO_KEY must be set (env or $REPO/.env)}"

cleanup() {
  [[ -n "${SIM_PID:-}" ]] && kill "$SIM_PID" 2>/dev/null || true
  [[ -n "${PROXY_PID:-}" ]] && kill "$PROXY_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Engine drain check: leaked server-side requests from a previous (killed) run
# queue behind per-key serialization and poison the new run with 300s stalls.
# Refuse to start until a tiny request answers quickly.
ENGINE_URL="${DYAD_ENGINE_UPSTREAM:-https://engine.dyad.sh/v1}"
echo "[run-cell] engine drain check…"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -X POST "$ENGINE_URL/chat/completions" \
    -H "authorization: Bearer $DYAD_PRO_KEY" -H 'content-type: application/json' \
    -d '{"model":"gpt-5.6-luna","stream":true,"max_tokens":1,"messages":[{"role":"user","content":"hi"}]}' || true)
  [[ "$code" == "200" ]] && { echo "[run-cell] engine responsive."; break; }
  echo "  engine busy/unreachable (code=$code), waiting 30s ($i/30)…"
  sleep 30
  [[ $i == 30 ]] && { echo "engine never drained; aborting"; exit 1; }
done

echo "[run-cell] starting neon-sim…"
(cd "$BENCH/neon-sim" && node server.mjs > "$BENCH/neon-sim/server.log" 2>&1) &
SIM_PID=$!
echo "[run-cell] starting engine proxy (cell=$CELL)…"
APPBENCH_CELL_CEILING_USD="${APPBENCH_CELL_CEILING_USD:-40}" \
  node "$BENCH/proxy/engine-proxy.mjs" --cell "$CELL" \
  > "$BENCH/proxy/engine-proxy.log" 2>&1 &
PROXY_PID=$!

for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:7788/__sim/state >/dev/null 2>&1 \
    && curl -sf http://127.0.0.1:7789/healthz >/dev/null 2>&1 && break
  sleep 1
  [[ $i == 30 ]] && { echo "servers failed to start"; exit 1; }
done
if [[ "${APPBENCH_RESET:-0}" == "1" ]]; then
  echo "[run-cell] APPBENCH_RESET=1: wiping all sim_* databases (snapshots included)…"
  curl -sf -X POST http://127.0.0.1:7788/__sim/reset >/dev/null || {
    echo "sim reset failed"; exit 1;
  }
fi
echo "[run-cell] Running cell: $MODEL"

cd "$REPO"
APPBENCH_CELL=1 \
APPBENCH_MODEL="$MODEL" \
NODE_EXTRA_CA_CERTS="$BENCH/neon-sim/certs/ca.pem" \
E2E_TEST_BUILD= \
npx vitest run --config vitest.eval.config.ts \
  src/__tests__/evals/appbench_cell.eval.ts

echo "[run-cell] done. Results: $BENCH/results/s-cell/ + $BENCH/proxy/logs/requests-$CELL.jsonl"
