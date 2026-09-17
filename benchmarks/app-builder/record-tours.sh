#!/bin/bash
# Record a DEMO tour video for one (model, app) cell.
#
# Like record-cujs.sh (clone the checkpoint DB snapshot, build, serve) but runs
# the tolerant *tour* spec instead of the scoring suite, at demo pacing: 1.5x CSS
# zoom inside every page (video size == viewport), browser slowMo, longer dwell,
# opening/closing title cards rendered in-page. Output: one mp4 per cell.
#
# Usage: ./record-tours.sh <cellId> <app> <appPort> "<title>" "<subtitle>"
#   e.g. ./record-tours.sh gpt-5.6-sol-relay-crm relay-crm 3200 \
#          "GPT 5.6 Sol" "Relay CRM — milestone 3"
# Env: CHECKPOINT (default 3), TOUR_ZOOM (1.5), TOUR_PACE (2.5), TOUR_SLOWMO (250)
set -uo pipefail

BENCH="$(cd "$(dirname "$0")" && pwd)"
CELL="${1:?cellId}"; APP="${2:?app}"; PORT="${3:?port}"
TITLE="${4:-$CELL}"; SUBTITLE="${5:-$APP}"
OUT="$BENCH/results/videos"
WORK="/tmp/claude-501/tour-$CELL"
mkdir -p "$OUT"; rm -rf "$WORK"; mkdir -p "$WORK"

SUM="$BENCH/results/s-cell/$CELL.summary.json"
CHECKOUT="$BENCH/results/s-cell/checkouts/$CELL"
[[ -f "$SUM" && -d "$CHECKOUT" ]] || { echo "[tour] missing artifacts for $CELL"; exit 1; }

CK="${CHECKPOINT:-3}"
SNAP=$(node -e "const s=require('$SUM');console.log(s.milestones.find(m=>m.m===$CK)?.snapshotDb??'')")
[[ -n "$SNAP" ]] || { echo "[tour] no snapshot for ckpt$CK"; exit 1; }
LABEL="sim_tour_$(echo "$CELL" | tr -c 'a-z0-9' '_' | sed 's/_*$//')_${CK}"
dropdb --if-exists "$LABEL" 2>/dev/null
CLONE=$(curl -sf -X POST http://127.0.0.1:7788/__sim/clone -H 'content-type: application/json' \
  -d "{\"snapshot\":\"$SNAP\",\"label\":\"$LABEL\"}") || { echo "[tour] clone failed"; exit 1; }
DBURL=$(node -e "console.log(JSON.parse(process.argv[1]).connection_uri)" "$CLONE")
AUTHURL=$(node -e "console.log(JSON.parse(process.argv[1]).auth_base_url)" "$CLONE")

APP_DIR="$WORK/app"
git clone --quiet "$CHECKOUT" "$APP_DIR"
git -C "$APP_DIR" checkout --quiet "checkpoint-m$CK"
printf 'DATABASE_URL=%s\nPOSTGRES_URL=%s\nNEON_AUTH_BASE_URL=%s\nNEON_AUTH_COOKIE_SECRET=%s\n' \
  "$DBURL" "$DBURL" "$AUTHURL" "$(openssl rand -hex 32)" > "$APP_DIR/.env.local"

export CI=true PLAYWRIGHT_SKIP_BROWSER_GC=1
echo "[tour] $CELL: installing + building ckpt$CK"
(cd "$APP_DIR" && pnpm install --prefer-offline >/dev/null 2>&1) || { echo "[tour] install failed"; exit 1; }
(cd "$APP_DIR" && NODE_EXTRA_CA_CERTS="$BENCH/neon-sim/certs/ca.pem" npx next build --no-lint >"$WORK/build.log" 2>&1) \
  || { echo "[tour] build failed (see $WORK/build.log)"; exit 1; }

NODE_EXTRA_CA_CERTS="$BENCH/neon-sim/certs/ca.pem" \
  bash -c "cd '$APP_DIR' && exec npx next start -p $PORT" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!
cleanup() {
  [[ -n "${SERVER_PID:-}" ]] && { pkill -P "$SERVER_PID" 2>/dev/null; kill "$SERVER_PID" 2>/dev/null; }
  curl -sf -X POST http://127.0.0.1:7788/__sim/release -H 'content-type: application/json' \
    -d "{\"label\":\"$LABEL\"}" >/dev/null 2>&1 || true
  dropdb --if-exists "$LABEL" 2>/dev/null || true
}
trap cleanup EXIT
for _ in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://localhost:$PORT/auth/sign-in" || true)
  [[ "$code" == "200" ]] && break
  sleep 1
done
[[ "$code" == "200" ]] || { echo "[tour] app never came up (last code $code)"; exit 1; }

echo "[tour] recording tour at zoom=${TOUR_ZOOM:-1.5} pace=${TOUR_PACE:-2.5} slowMo=${TOUR_SLOWMO:-250}"
VID_RAW="$WORK/clips"; mkdir -p "$VID_RAW"
(cd "$BENCH/cuj-tests" && \
  APP_URL="http://localhost:$PORT" VIDEO_DIR="$VID_RAW" TOUR_OUT="$WORK/tour-out" \
  TOUR_ZOOM="${TOUR_ZOOM:-1.5}" TOUR_PACE="${TOUR_PACE:-2.5}" TOUR_SLOWMO="${TOUR_SLOWMO:-250}" \
  TOUR_TITLE="$TITLE" TOUR_SUBTITLE="$SUBTITLE" \
  NODE_EXTRA_CA_CERTS="$BENCH/neon-sim/certs/ca.pem" \
  npx playwright test "tours/checkpoint-tour-$APP.spec.ts" --config playwright.tour.config.mjs \
  >"$WORK/tour.log" 2>&1) || true
grep -E "PASS|FAIL|steps completed" "$WORK/tour.log" | sed 's/^/[tour]   /'

WEBM=$(find "$VID_RAW" -name "*.webm" | head -1)
[[ -n "$WEBM" ]] || { echo "[tour] no video produced (see $WORK/tour.log)"; exit 1; }
MP4="$OUT/demo-$CELL.mp4"
# Native recorded size (1600x1000, CSS zoom inside the page); 24fps for smooth cursor
# motion; crf 24 keeps text crisp.
ffmpeg -y -i "$WEBM" -vf "fps=24,scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  -c:v libx264 -crf 24 -preset veryfast -pix_fmt yuv420p -movflags +faststart \
  "$MP4" >"$WORK/ffmpeg.log" 2>&1 || { echo "[tour] ffmpeg failed (see $WORK/ffmpeg.log)"; exit 1; }
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$MP4" 2>/dev/null | cut -d. -f1)
SIZE=$(du -h "$MP4" | cut -f1 | tr -d ' ')
echo "[tour] DONE $CELL -> $MP4 (${DUR}s, $SIZE)"
