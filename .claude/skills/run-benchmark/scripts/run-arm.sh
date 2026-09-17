#!/bin/bash
# Run one ARM of the app-builder benchmark: build the 3 apps in parallel for
# one model at one effort tier, then score them sequentially (CUJ suite +
# security probes + LLM judge). One arm at a time keeps a 16 GB machine and a
# rate-limited upstream happy; use different port bases to run a second arm
# concurrently if headroom allows.
#
# Usage:
#   run-arm.sh <engine-model-spec> <catalog-pin> [--effort low|high|xhigh] \
#              [--label r2] [--proxy-base 7789] [--block-base 4] [--score-port 3000] \
#              [--apps relay-crm,deskhero,portalis] [--ceiling 40] [--sequential]
#
#   engine-model-spec  as appbench_cell.eval.ts expects: openai/gpt-6-astra,
#                      anthropic/claude-fable-5-1, google/gemini-3.8-flash,
#                      openrouter/meta/muse-spark-1.3
#   catalog-pin        file name under benchmarks/app-builder/catalog/ that
#                      CONTAINS this model (run-cell refuses otherwise)
#   --effort           omit for the product default (unsuffixed cell ids);
#                      a tier suffixes every cell id (<model>-<app>-<tier>)
#   --label            APPBENCH_RUN_LABEL for a rerun of the same config
#   --sequential       build the apps one at a time (throttled providers)
#
# Env: BENCH (default: benchmarks/app-builder under the repo that has it).
# Logs: $LOG_DIR (default /tmp/claude-501/appbench/<slug>[-<effort>][-<label>]).
set -uo pipefail
MODEL="${1:?engine model spec}"; PIN="${2:?catalog pin file}"; shift 2
EFFORT=""; LABEL=""; PROXY_BASE=7789; BLOCK_BASE=4; SCORE_PORT=3000
APPS="relay-crm,deskhero,portalis"; CEILING=40; SEQUENTIAL=0
while [[ $# -gt 0 ]]; do case "$1" in
  --effort) EFFORT="$2"; shift 2;; --label) LABEL="$2"; shift 2;;
  --proxy-base) PROXY_BASE="$2"; shift 2;; --block-base) BLOCK_BASE="$2"; shift 2;;
  --score-port) SCORE_PORT="$2"; shift 2;; --apps) APPS="$2"; shift 2;;
  --ceiling) CEILING="$2"; shift 2;; --sequential) SEQUENTIAL=1; shift;;
  *) echo "unknown arg $1"; exit 2;; esac; done

BENCH="${BENCH:-$(cd "$(dirname "$0")/../../../.." 2>/dev/null && pwd)/benchmarks/app-builder}"
[[ -f "$BENCH/run-cell.sh" ]] || { echo "BENCH=$BENCH has no run-cell.sh — set BENCH to the checkout that holds benchmarks/app-builder"; exit 1; }
[[ -f "$BENCH/catalog/$PIN" ]] || { echo "no catalog pin $BENCH/catalog/$PIN"; exit 1; }
curl -sf http://127.0.0.1:7788/__sim/state >/dev/null || { echo "neon-sim is not up on :7788 (cd $BENCH/neon-sim && node server.mjs &)"; exit 1; }

# Cell id exactly as appbench_cell.eval.ts derives it: provider stripped, the
# rest with non [a-z0-9.-] -> "_", then -<app>[-<effort>][-<label>].
NAME="${MODEL#*/}"; SLUG="$(echo "$NAME" | sed 's/[^a-zA-Z0-9.-]/_/g')"
TAG="${EFFORT:+-$EFFORT}${LABEL:+-$LABEL}"
LOG_DIR="${LOG_DIR:-/tmp/claude-501/appbench/$SLUG$TAG}"; mkdir -p "$LOG_DIR"
echo "[arm] model=$MODEL slug=$SLUG effort=${EFFORT:-default} label=${LABEL:-} pin=$PIN logs=$LOG_DIR"

build() { # app index
  local APP=$1 I=$2 PORT=$((PROXY_BASE + 2*I)) BLOCK=$((BLOCK_BASE + I)) CELL="$SLUG-$1$TAG"
  APPBENCH_EFFORT="$EFFORT" APPBENCH_CATALOG="$PIN" APPBENCH_CELL_CEILING_USD="$CEILING" \
    node "$BENCH/proxy/engine-proxy.mjs" --port "$PORT" --cell "$CELL" > "$LOG_DIR/proxy-$APP.log" 2>&1 &
  local PP=$!; sleep 3
  echo "[arm] $CELL build start $(date +%H:%M:%S) proxy=$PORT block=$BLOCK"
  APPBENCH_EFFORT="$EFFORT" APPBENCH_RUN_LABEL="$LABEL" APPBENCH_EXTERNAL_SERVICES=1 \
    APPBENCH_APP="$APP" APPBENCH_PROXY_PORT="$PORT" APPBENCH_PORT_BLOCK="$BLOCK" \
    "$BENCH/run-cell.sh" "$MODEL" > "$LOG_DIR/build-$APP.log" 2>&1
  echo "[arm] $CELL build exit=$? $(date +%H:%M:%S)"
  kill "$PP" 2>/dev/null
}

I=0
for APP in ${APPS//,/ }; do
  if (( SEQUENTIAL )); then build "$APP" "$I"; else build "$APP" "$I" & fi
  I=$((I+1))
done
wait
echo "[arm] builds done $(date +%H:%M:%S)"

for APP in ${APPS//,/ }; do
  CELL="$SLUG-$APP$TAG"
  echo "[arm] $CELL score start $(date +%H:%M:%S)"
  APPBENCH_APP="$APP" APP_PORT="$SCORE_PORT" CI=true PLAYWRIGHT_SKIP_BROWSER_GC=1 \
    "$BENCH/s-score.sh" "$CELL" > "$LOG_DIR/score-$APP.log" 2>&1
  echo "[arm] $CELL score exit=$? $(date +%H:%M:%S)"
done
echo "[arm] ALL DONE $(date +%H:%M:%S)"
