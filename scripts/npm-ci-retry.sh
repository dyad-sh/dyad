#!/bin/bash
# npm-ci-retry.sh
# Retry npm ci up to 3 times to handle intermittent EBUSY/EPERM errors on Windows.
# These errors are caused by file locking from antivirus or indexing services.

set -e

MAX_ATTEMPTS=3
RETRY_DELAY=10

for i in $(seq 1 $MAX_ATTEMPTS); do
  if npm ci --no-audit --no-fund --progress=false; then
    exit 0
  fi
  echo "npm ci attempt $i failed, retrying in ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
  rm -rf node_modules || true
done

echo "npm ci failed after $MAX_ATTEMPTS attempts"
exit 1
