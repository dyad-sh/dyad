#!/bin/bash
# pnpm-install-retry.sh
# Retry pnpm install up to 3 times to handle intermittent EBUSY/EPERM errors on Windows.
# These errors are caused by file locking from antivirus or indexing services.

set -e

MAX_ATTEMPTS=3
RETRY_DELAY=10

rm -rf node_modules || true

for i in $(seq 1 $MAX_ATTEMPTS); do
  if pnpm install --frozen-lockfile; then
    exit 0
  fi
  echo "pnpm install attempt $i failed, retrying in ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
  rm -rf node_modules || true
done

echo "pnpm install failed after $MAX_ATTEMPTS attempts"
exit 1
