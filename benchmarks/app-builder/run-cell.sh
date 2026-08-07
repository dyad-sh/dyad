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
# Must match the cell id appbench_cell.eval.ts composes, or the proxy's
# per-cell request log lands under a different name than the cell summary.
CELL="$(echo "${MODEL##*/}" | tr -c 'a-zA-Z0-9.-' '_' | sed 's/_$//')-${APPBENCH_APP:-relay-crm}${APPBENCH_EFFORT:+-$APPBENCH_EFFORT}"

if [[ -f "$REPO/.env" ]]; then
  set -a
  source "$REPO/.env"
  set +a
fi
: "${DYAD_PRO_KEY:?DYAD_PRO_KEY must be set (env or $REPO/.env)}"

cleanup() {
  [[ "${APPBENCH_EXTERNAL_SERVICES:-0}" == "1" ]] && return 0
  [[ -n "${SIM_PID:-}" ]] && kill "$SIM_PID" 2>/dev/null || true
  [[ -n "${PROXY_PID:-}" ]] && kill "$PROXY_PID" 2>/dev/null || true
}
trap cleanup EXIT

# The code-explorer worker bundle must exist for the headless utilityProcess
# shim (electron_mock) — deep context is part of the measured product.
if [[ ! -f "$REPO/dist/code_explorer_worker.js" ]]; then
  echo "[run-cell] building code explorer worker bundle…"
  (cd "$REPO" && npx vite build --config vite.code-explorer-worker.config.mts >/dev/null 2>&1) \
    || { echo "worker bundle build failed"; exit 1; }
fi

# Engine drain check: leaked server-side requests from a previous (killed) run
# queue behind per-key serialization and poison the new run with 300s stalls.
# Refuse to start until a tiny request answers quickly.
ENGINE_URL="${DYAD_ENGINE_UPSTREAM:-https://engine.dyad.sh/v1}"
echo "[run-cell] engine drain check…"
# Probe with the model this cell will actually use, and inspect the STREAM BODY,
# not the status line. The engine answers HTTP 200 and reports failures inside
# the SSE stream: a bogus model name yields 200 plus
#   event: error  {"error":{"message":"... Invalid model name ..."}}
# so a status-only check would let a whole 3-milestone cell run against a model
# that never responds. Verified against this engine on 2026-08-07.
#
# The accepted model string differs by provider — direct providers take a bare
# name ("gpt-5.6-luna") while OpenRouter models keep their full path
# ("openrouter/deepseek/deepseek-v4-flash-0731"). Rather than encode that rule,
# try the spec as given and then with its leading provider segment stripped,
# and only fail when neither is accepted.
ENGINE_PROBE_SPEC="${APPBENCH_MODEL:-openai/gpt-5.6-luna}"
engine_probe() {
  curl -s --max-time 20 -X POST "$ENGINE_URL/chat/completions" \
    -H "authorization: Bearer $DYAD_PRO_KEY" -H 'content-type: application/json' \
    -d "{\"model\":\"$1\",\"stream\":true,\"max_tokens\":1,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" || true
}
for i in $(seq 1 30); do
  ok=0
  for candidate in "$ENGINE_PROBE_SPEC" "${ENGINE_PROBE_SPEC#*/}"; do
    body=$(engine_probe "$candidate")
    [[ -z "$body" ]] && continue
    if grep -q 'event: error' <<<"$body"; then
      last_err=$(grep -o '"message":"[^"]*' <<<"$body" | head -1 | cut -c12-200)
      continue
    fi
    echo "[run-cell] engine responsive (model string: $candidate)."
    ok=1; break
  done
  (( ok )) && break
  if [[ -n "${last_err:-}" ]]; then
    echo "[run-cell] engine REJECTED both forms of $ENGINE_PROBE_SPEC:"
    echo "           $last_err"
    exit 1
  fi
  echo "  engine unreachable, waiting 30s ($i/30)…"
  sleep 30
  [[ $i == 30 ]] && { echo "engine never drained; aborting"; exit 1; }
done

if [[ "${APPBENCH_EXTERNAL_SERVICES:-0}" == "1" ]]; then
  echo "[run-cell] external services mode: skipping server lifecycle"
else
# A previous sim instance surviving on 7788 (or a stale proxy on 7789) makes
# the new start fail to bind while health checks pass against STALE code —
# observed live (a day-old sim served pre-fix clone responses). Clear the
# ports by PID before starting.
for port in 7788 "${APPBENCH_PROXY_PORT:-7789}"; do
  stale=$(lsof -ti :$port -sTCP:LISTEN 2>/dev/null || true)
  [[ -n "$stale" ]] && { echo "[run-cell] killing stale listener on :$port (pid $stale)"; kill -9 $stale 2>/dev/null || true; sleep 1; }
done

echo "[run-cell] starting neon-sim…"
(cd "$BENCH/neon-sim" && node server.mjs > "$BENCH/neon-sim/server.log" 2>&1) &
SIM_PID=$!
echo "[run-cell] starting engine proxy (cell=$CELL)…"
APPBENCH_CELL_CEILING_USD="${APPBENCH_CELL_CEILING_USD:-40}" \
  APPBENCH_EFFORT="${APPBENCH_EFFORT:-}" \
  node "$BENCH/proxy/engine-proxy.mjs" --port "${APPBENCH_PROXY_PORT:-7789}" --cell "$CELL" \
  > "$BENCH/proxy/engine-proxy.log" 2>&1 &
PROXY_PID=$!

for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:7788/__sim/state >/dev/null 2>&1 \
    && curl -sf "http://127.0.0.1:${APPBENCH_PROXY_PORT:-7789}/healthz" >/dev/null 2>&1 && break
  sleep 1
  [[ $i == 30 ]] && { echo "servers failed to start"; exit 1; }
done
if [[ "${APPBENCH_RESET:-0}" == "1" ]]; then
  echo "[run-cell] APPBENCH_RESET=1: wiping all sim_* databases (snapshots included)…"
  curl -sf -X POST http://127.0.0.1:7788/__sim/reset >/dev/null || {
    echo "sim reset failed"; exit 1;
  }
fi
fi
echo "[run-cell] Running cell: $MODEL"

cd "$REPO"
APPBENCH_CELL=1 \
APPBENCH_EFFORT="${APPBENCH_EFFORT:-}" \
APPBENCH_MODEL="$MODEL" \
NODE_EXTRA_CA_CERTS="$BENCH/neon-sim/certs/ca.pem" \
E2E_TEST_BUILD= \
npx vitest run --config vitest.eval.config.ts \
  src/__tests__/evals/appbench_cell.eval.ts

echo "[run-cell] done. Results: $BENCH/results/s-cell/ + $BENCH/proxy/logs/requests-$CELL.jsonl"
