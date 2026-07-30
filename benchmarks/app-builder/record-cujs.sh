#!/bin/bash
# Record a CUJ walkthrough video for one (model, app) cell.
#
# Stands the cell's checkpoint app up exactly as the scorer does (clone the
# checkpoint DB snapshot, build, serve), runs that checkpoint's CUJ suite with
# Playwright video capture, then stitches the per-test clips into one mp4.
#
# Usage: ./record-cujs.sh <cellId> <app> <appPort>
#   e.g. ./record-cujs.sh gpt-5.6-sol-portalis portalis 3200
# Env: CHECKPOINT (default 3; falls back automatically if that build fails)
set -uo pipefail

BENCH="$(cd "$(dirname "$0")" && pwd)"
CELL="${1:?cellId}"; APP="${2:?app}"; PORT="${3:?port}"
OUT="$BENCH/results/videos"
WORK="/tmp/claude-501/rec-$CELL"
mkdir -p "$OUT"
rm -rf "$WORK"; mkdir -p "$WORK"

SUM="$BENCH/results/s-cell/$CELL.summary.json"
CHECKOUT="$BENCH/results/s-cell/checkouts/$CELL"
[[ -f "$SUM" && -d "$CHECKOUT" ]] || { echo "[rec] missing artifacts for $CELL"; exit 1; }

# Pick the highest checkpoint whose scoring build succeeded — a cell whose m3
# does not build (e.g. luna/portalis) still gets a video of what does run.
CK="${CHECKPOINT:-3}"
while (( CK > 1 )); do
  st=$(node -e "try{console.log(require('$BENCH/results/s-score/$CELL-ckpt$CK-a1.json').buildStatus)}catch(e){console.log('missing')}")
  [[ "$st" == "ok" ]] && break
  echo "[rec] ckpt$CK buildStatus=$st — falling back"
  CK=$((CK-1))
done
echo "[rec] $CELL: recording checkpoint $CK"

SNAP=$(node -e "const s=require('$SUM');console.log(s.milestones.find(m=>m.m===$CK)?.snapshotDb??'')")
[[ -n "$SNAP" ]] || { echo "[rec] no snapshot for ckpt$CK"; exit 1; }
LABEL="sim_vid_$(echo "$CELL" | tr -c 'a-z0-9' '_' | sed 's/_*$//')_${CK}"
dropdb --if-exists "$LABEL" 2>/dev/null
CLONE=$(curl -sf -X POST http://127.0.0.1:7788/__sim/clone -H 'content-type: application/json' \
  -d "{\"snapshot\":\"$SNAP\",\"label\":\"$LABEL\"}") || { echo "[rec] clone failed"; exit 1; }
DBURL=$(node -e "console.log(JSON.parse(process.argv[1]).connection_uri)" "$CLONE")
AUTHURL=$(node -e "console.log(JSON.parse(process.argv[1]).auth_base_url)" "$CLONE")

APP_DIR="$WORK/app"
git clone --quiet "$CHECKOUT" "$APP_DIR"
git -C "$APP_DIR" checkout --quiet "checkpoint-m$CK"
printf 'DATABASE_URL=%s\nPOSTGRES_URL=%s\nNEON_AUTH_BASE_URL=%s\nNEON_AUTH_COOKIE_SECRET=%s\n' \
  "$DBURL" "$DBURL" "$AUTHURL" "$(openssl rand -hex 32)" > "$APP_DIR/.env.local"

echo "[rec] installing + building"
(cd "$APP_DIR" && pnpm install --prefer-offline >/dev/null 2>&1) || { echo "[rec] install failed"; exit 1; }
(cd "$APP_DIR" && NODE_EXTRA_CA_CERTS="$BENCH/neon-sim/certs/ca.pem" npx next build --no-lint >"$WORK/build.log" 2>&1) \
  || { echo "[rec] build failed (see $WORK/build.log)"; exit 1; }

NODE_EXTRA_CA_CERTS="$BENCH/neon-sim/certs/ca.pem" \
  bash -c "cd '$APP_DIR' && exec npx next start -p $PORT" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!
trap '[[ -n "${SERVER_PID:-}" ]] && kill $SERVER_PID 2>/dev/null; dropdb --if-exists "$LABEL" 2>/dev/null' EXIT

for _ in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://localhost:$PORT/auth/sign-in" || true)
  [[ "$code" == "200" ]] && break
  sleep 1
done

echo "[rec] running CUJ suite with video capture"
VID_RAW="$WORK/clips"
(cd "$BENCH/cuj-tests" && APP_URL="http://localhost:$PORT" VIDEO_DIR="$VID_RAW" \
  NODE_EXTRA_CA_CERTS="$BENCH/neon-sim/certs/ca.pem" \
  CUJ_VIDEO_DIR="$VID_RAW" npx playwright test "$APP/checkpoint-$CK.spec.ts" --config playwright.video.config.mjs \
  >"$WORK/cuj.log" 2>&1) || true

# macOS ships bash 3.2, which has no mapfile.
LIST="$WORK/list.txt"; : > "$LIST"
NCLIPS=0
while IFS= read -r c; do
  printf "file '%s'\n" "$c" >> "$LIST"
  NCLIPS=$((NCLIPS + 1))
done < <(find "$VID_RAW" -name "*.webm" | sort)
if (( NCLIPS == 0 )); then echo "[rec] no clips produced"; exit 1; fi
echo "[rec] stitching $NCLIPS clips"
# Re-encode (clips vary in duration/keyframes); crf 30 keeps files small while
# staying legible for UI walkthroughs.
ffmpeg -y -f concat -safe 0 -i "$LIST" \
  -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=10" \
  -c:v libx264 -crf 30 -preset veryfast -pix_fmt yuv420p \
  "$OUT/$CELL-ckpt$CK.mp4" >"$WORK/ffmpeg.log" 2>&1 \
  || { echo "[rec] ffmpeg failed (see $WORK/ffmpeg.log)"; exit 1; }

SIZE=$(du -h "$OUT/$CELL-ckpt$CK.mp4" | cut -f1 | tr -d ' ')
echo "[rec] DONE $CELL -> $OUT/$CELL-ckpt$CK.mp4 ($SIZE, $NCLIPS clips)"
