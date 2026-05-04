#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data/apps /data/userData /data/downloads /data/filebrowser
chown -R dyad:dyad /data

DB=/data/filebrowser/filebrowser.db
ROOT=/data

if [ ! -f "$DB" ]; then
  filebrowser config init --database "$DB" >/dev/null 2>&1 || true
  filebrowser config set --database "$DB" --address 127.0.0.1 --port 8081 --root "$ROOT" --baseurl /files >/dev/null
  filebrowser users add "${FILEBROWSER_USER:-admin}" "${FILEBROWSER_PASSWORD:-change-me-now}" --database "$DB" --perm.admin >/dev/null || true
fi

exec filebrowser --database "$DB" --address 127.0.0.1 --port 8081 --root "$ROOT" --baseurl /files
