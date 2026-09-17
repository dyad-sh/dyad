#!/bin/bash
# Serve results/videos over the tailnet: a local static server on :8090 fronted
# by `tailscale serve` (HTTPS on the machine's MagicDNS name). Idempotent.
set -uo pipefail
BENCH="$(cd "$(dirname "$0")" && pwd)"
DIR="$BENCH/results/videos"
PORT=8090
T=/Applications/Tailscale.app/Contents/MacOS/Tailscale
"$BENCH/make-gallery.sh"
if ! lsof -ti :$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  (cd "$DIR" && nohup python3 -m http.server $PORT --bind 0.0.0.0 > /tmp/claude-501/gallery-http.log 2>&1 &)
  sleep 1
fi
curl -sf -o /dev/null "http://127.0.0.1:$PORT/index.html" && echo "[gallery] local :$PORT ok" || { echo "[gallery] local server failed"; exit 1; }
# :443 is held by neon-sim while recordings run; 8443 avoids the conflict.
"$T" serve --bg --https=8443 "$PORT" 2>&1 | tail -3
"$T" serve status 2>&1 | head -6
