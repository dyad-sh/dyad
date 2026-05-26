#!/bin/bash
# npm-ci-retry.sh
# Retry npm ci up to 3 times to handle intermittent EBUSY/EPERM errors on Windows.
# These errors are caused by file locking from antivirus or indexing services.

set -e

MAX_ATTEMPTS=3
RETRY_DELAY=10

verify_electron() {
  node -e 'require("electron")' >/dev/null 2>&1
}

install_electron_binary() {
  rm -rf node_modules/electron/dist node_modules/electron/path.txt
  env -u ELECTRON_SKIP_BINARY_DOWNLOAD force_no_cache=true npx install-electron
}

for i in $(seq 1 $MAX_ATTEMPTS); do
  rm -rf node_modules || true
  unset ELECTRON_SKIP_BINARY_DOWNLOAD

  if env -u ELECTRON_SKIP_BINARY_DOWNLOAD npm ci --no-audit --no-fund --progress=false --ignore-scripts=false; then
    install_electron_binary

    if verify_electron; then
      exit 0
    fi

    echo "Electron verification failed after install-electron, rebuilding Electron..."
    if env -u ELECTRON_SKIP_BINARY_DOWNLOAD force_no_cache=true npm rebuild electron --ignore-scripts=false && verify_electron; then
      exit 0
    fi

    echo "Electron verification failed after rebuild, running install-electron again..."
    if install_electron_binary && verify_electron; then
      exit 0
    fi

    echo "Electron verification failed after install-electron."
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
