#!/bin/bash
# npm-ci-retry.sh
# Retry npm ci up to 3 times to handle intermittent EBUSY/EPERM errors on Windows.
# These errors are caused by file locking from antivirus or indexing services.

set -e

MAX_ATTEMPTS=3
RETRY_DELAY=10

verify_electron() {
  node -e 'require("electron")' >/dev/null
}

for i in $(seq 1 $MAX_ATTEMPTS); do
  rm -rf node_modules || true
  unset ELECTRON_SKIP_BINARY_DOWNLOAD

  if npm ci --no-audit --no-fund --progress=false --ignore-scripts=false; then
    if verify_electron; then
      exit 0
    fi

    echo "Electron verification failed after npm ci, rebuilding Electron..."
    if force_no_cache=true npm rebuild electron && verify_electron; then
      exit 0
    fi

    echo "Electron verification failed after rebuild."
  else
    echo "npm ci attempt $i failed."
  fi

  if [ "$i" -lt "$MAX_ATTEMPTS" ]; then
    echo "Retrying in ${RETRY_DELAY}s..."
    sleep $RETRY_DELAY
  fi
done

echo "npm ci and Electron verification failed after $MAX_ATTEMPTS attempts"
exit 1
