#!/usr/bin/env bash
set -euo pipefail

ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-change-me-now}"
HTPASSWD_FILE=/etc/nginx/.htpasswd

if [ "$ADMIN_PASSWORD" = "change-me-now" ]; then
  echo "WARNING: ADMIN_PASSWORD is still the default. Change it before public deployment." >&2
fi

htpasswd -bc "$HTPASSWD_FILE" "$ADMIN_USER" "$ADMIN_PASSWORD" >/dev/null
chmod 640 "$HTPASSWD_FILE"

exec /usr/sbin/nginx -g "daemon off;"
