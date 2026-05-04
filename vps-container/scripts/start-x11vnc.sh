#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data/vnc
VNC_PASSWORD="${VNC_PASSWORD:-change-me-now}"
PASSFILE=/data/vnc/passwd

if [ ! -f "$PASSFILE" ] || [ "${FORCE_RESET_VNC_PASSWORD:-false}" = "true" ]; then
  x11vnc -storepasswd "$VNC_PASSWORD" "$PASSFILE" >/dev/null
  chmod 600 "$PASSFILE"
fi

exec /usr/bin/x11vnc -display :1 -forever -shared -rfbport 5900 -rfbauth "$PASSFILE" -listen 127.0.0.1
