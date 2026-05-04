#!/usr/bin/env bash
gosu_if_available() {
  if command -v gosu >/dev/null 2>&1; then exec gosu dyad "$@"; fi
  if [ "$(id -u)" = "0" ]; then exec runuser -u dyad -- "$@"; fi
  exec "$@"
}

set -euo pipefail

export DISPLAY="${DISPLAY:-:1}"
export HOME=/home/dyad
export USER=dyad
export XDG_CONFIG_HOME=/data/userData/.config
export XDG_DATA_HOME=/data/userData/.local/share
export XDG_CACHE_HOME=/data/cache
export ELECTRON_DISABLE_SANDBOX=1
export NO_AT_BRIDGE=1

mkdir -p /data/userData/.config /data/userData/.local/share /data/apps /data/cache /data/downloads
chown -R dyad:dyad /data

# Wait for X server.
for i in $(seq 1 60); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

cd /opt/dyad

# Prefer packaged Electron output built during Docker image build.
if [ -x /opt/dyad/out/dyad-linux-x64/dyad ]; then
  exec gosu_if_available /opt/dyad/out/dyad-linux-x64/dyad --no-sandbox --disable-gpu
fi

exec npm start -- --no-sandbox --disable-gpu
