#!/bin/bash
# Keep packages already downloaded when retrying transient registry failures.
set -euo pipefail

cd -- "$1"
for attempt in 1 2 3; do
  if pnpm install; then
    exit 0
  fi
  if [ "$attempt" -lt 3 ]; then
    echo "pnpm install attempt $attempt failed; retrying in 10s..."
    sleep 10
  fi
done

echo "pnpm install failed after 3 attempts" >&2
exit 1
