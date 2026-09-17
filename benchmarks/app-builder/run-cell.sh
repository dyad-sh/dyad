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
CELL="$(echo "${MODEL##*/}" | tr -c 'a-zA-Z0-9.-' '_' | sed 's/_$//')-${APPBENCH_APP:-relay-crm}${APPBENCH_EFFORT:+-$APPBENCH_EFFORT}${APPBENCH_RUN_LABEL:+-$APPBENCH_RUN_LABEL}"

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
# The cell now runs the app's dev server, so `pnpm install` executes inside the
# generated app — and if that app depends on a different Playwright, its
# postinstall garbage-collects browser builds the SCORER needs. That already
# cost three cells a 0/54 "harness_error" once, and recurred here: the scorer
# asked for chromium build 1234 and found only 1217/1223. The scorer sets this
# too; set it for the build phase as well so nothing in the pipeline can
# delete a browser another stage depends on.
export PLAYWRIGHT_SKIP_BROWSER_GC=1

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
# $MODEL is the cell's spec (argv[1]); APPBENCH_MODEL is only exported later
# for the eval, so reading it here silently probed gpt-5.6-luna for every cell.
ENGINE_PROBE_SPEC="$MODEL"
engine_probe() { # model-string token-param-name
  curl -s --max-time 20 -X POST "$ENGINE_URL/chat/completions" \
    -H "authorization: Bearer $DYAD_PRO_KEY" -H 'content-type: application/json' \
    -d "{\"model\":\"$1\",\"stream\":true,\"$2\":16,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" || true
  # 16 tokens, not 1: OpenRouter refuses a 1-token budget for reasoning models
  # (muse-spark-1.3 answered 400), which read as "model rejected". The param
  # NAME is tried both ways: gpt-6-astra rejects max_tokens outright
  # ("Use 'max_completion_tokens' instead") while older paths only know
  # max_tokens. The cell's real requests don't go through this shape at all.
}
for i in $(seq 1 30); do
  ok=0
  # Third form: providers with a gateway prefix (google/vertex -> "gemini/",
  # anthropic -> "anthropic/") are addressed by that prefix on the engine.
  case "${ENGINE_PROBE_SPEC%%/*}" in
    google|vertex) PROBE_GATEWAY="gemini/${ENGINE_PROBE_SPEC#*/}" ;;
    anthropic)     PROBE_GATEWAY="anthropic/${ENGINE_PROBE_SPEC#*/}" ;;
    *)             PROBE_GATEWAY="" ;;
  esac
  for candidate in "$ENGINE_PROBE_SPEC" "${ENGINE_PROBE_SPEC#*/}" ${PROBE_GATEWAY:+"$PROBE_GATEWAY"}; do
    for tokparam in max_tokens max_completion_tokens; do
      body=$(engine_probe "$candidate" "$tokparam")
      [[ -z "$body" ]] && continue
      if grep -q 'event: error' <<<"$body"; then
        last_err=$(grep -o '"message":"[^"]*' <<<"$body" | head -1 | cut -c12-200)
        continue
      fi
      echo "[run-cell] engine responsive (model string: $candidate, $tokparam)."
      ok=1; break 2
    done
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
  # The effort override is applied by the PROXY from its own env. In this mode
  # the driver started the proxy, so verify it carries the same effort this
  # cell was asked to run — a driver that forgot APPBENCH_EFFORT once produced
  # an entire mislabeled arm at the product default.
  if [[ -n "${APPBENCH_EFFORT:-}" ]]; then
    PROXY_EFFORT=$(curl -sf "http://127.0.0.1:${APPBENCH_PROXY_PORT:-7789}/healthz" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).effort??'')}catch{console.log('')}})")
    if [[ "$PROXY_EFFORT" != "$APPBENCH_EFFORT" ]]; then
      echo "[run-cell] FATAL: cell wants effort '$APPBENCH_EFFORT' but proxy reports '${PROXY_EFFORT:-none}' — start the proxy with APPBENCH_EFFORT set"
      exit 1
    fi
    echo "[run-cell] proxy effort verified: $PROXY_EFFORT"
  fi
  # The proxy serves a PINNED catalog. A model missing from it resolves to no
  # maxOutputTokens and the Anthropic provider path then caps output at 4096 —
  # observed as claude-fable-5-1 silently truncating every large write. Refuse.
  MODEL_PROVIDER="${MODEL%%/*}"; MODEL_API="${MODEL#*/}"
  IN_CATALOG=$(curl -sf "http://127.0.0.1:${APPBENCH_PROXY_PORT:-7789}/catalog" | node -e "
    let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const c=JSON.parse(d);
      const ms=(c.modelsByProvider||{})[process.argv[1]]||[];
      console.log(ms.some(m=>m.apiName===process.argv[2])?'yes':'no')}catch{console.log('err')}})" "$MODEL_PROVIDER" "$MODEL_API")
  if [[ "$IN_CATALOG" != "yes" ]]; then
    echo "[run-cell] FATAL: $MODEL_API is not in the pinned catalog the proxy serves (provider $MODEL_PROVIDER, result=$IN_CATALOG). Start the proxy with APPBENCH_CATALOG=<newer pin> — otherwise maxOutputTokens resolves to nothing and Anthropic-path output is capped at 4096."
    exit 1
  fi
  echo "[run-cell] model present in pinned catalog"
else
# A previous sim instance surviving on 7788 (or a stale proxy on 7789) makes
# the new start fail to bind while health checks pass against STALE code —
# observed live (a day-old sim served pre-fix clone responses). Clear the
# ports by PID before starting.
for port in 7788 "${APPBENCH_PROXY_PORT:-7789}"; do
  stale=$(lsof -ti :$port -sTCP:LISTEN 2>/dev/null || true)
  [[ -n "$stale" ]] && { echo "[run-cell] killing stale listener on :$port (pid $stale)"; kill -9 $stale 2>/dev/null || true; sleep 1; }
done
fi

# The cell now runs the app's real dev server (so restart_app / read_logs
# work). A hard-killed previous run leaks `next dev` on the app port and its
# proxy worker on the proxy port; both must be free or the new run's readiness
# wait fails. Ports come from shared/ports.ts: base = 32100 + block*2050,
# app = base + appId%1000 (the harness always creates app id 1), proxy =
# base + 1000 + appId%1000, proxy fallback band = base + 2000…
APPBENCH_PORT_BLOCK="${APPBENCH_PORT_BLOCK:-4}"
export APPBENCH_PORT_BLOCK
PORT_BLOCK_BASE=$(( 32100 + APPBENCH_PORT_BLOCK * 2050 ))
for port in $(( PORT_BLOCK_BASE + 1 )) $(( PORT_BLOCK_BASE + 1001 )); do
  stale=$(lsof -ti :$port -sTCP:LISTEN 2>/dev/null || true)
  [[ -n "$stale" ]] && { echo "[run-cell] killing stale app/preview listener on :$port (pid $stale)"; kill -9 $stale 2>/dev/null || true; }
done

# pnpm must be on PATH: without it the app's default run command silently
# degrades to `npm install --legacy-peer-deps`, which fights the template's
# pnpm lockfile.
command -v pnpm >/dev/null || { echo "[run-cell] pnpm not found on PATH"; exit 1; }

if [[ "${APPBENCH_EXTERNAL_SERVICES:-0}" != "1" ]]; then

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
NODE_OPTIONS="--max-old-space-size=12288" \
npx vitest run --config vitest.eval.config.ts \
  src/__tests__/evals/appbench_cell.eval.ts

echo "[run-cell] done. Results: $BENCH/results/s-cell/ + $BENCH/proxy/logs/requests-$CELL.jsonl"
