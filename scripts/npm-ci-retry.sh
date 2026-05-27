#!/bin/bash
# npm-ci-retry.sh
# Retry npm ci up to 3 times to handle intermittent EBUSY/EPERM errors on Windows.
# These errors are caused by file locking from antivirus or indexing services.
#
# Electron 42+ no longer has a postinstall hook, so we must explicitly invoke
# our own install-electron-binary.mjs script after npm ci.

set -e

MAX_ATTEMPTS=3
RETRY_DELAY=10

verify_electron() {
  node -e 'console.log(require("electron"))'
}

# Where @electron/get caches downloaded zips.
electron_cache_dir() {
  case "$(uname -s)" in
    Darwin) echo "$HOME/Library/Caches/electron" ;;
    Linux) echo "${XDG_CACHE_HOME:-$HOME/.cache}/electron" ;;
    MINGW* | MSYS* | CYGWIN*) echo "$LOCALAPPDATA/electron/Cache" ;;
    *) echo "" ;;
  esac
}

clear_electron_cache() {
  local cache_dir
  cache_dir=$(electron_cache_dir)
  if [ -n "$cache_dir" ] && [ -d "$cache_dir" ]; then
    echo "Clearing @electron/get cache at $cache_dir"
    rm -rf "$cache_dir" || true
  fi
}

install_electron_binary() {
  # Run our own installer (bypasses electron's install.js which silently
  # exits 0 on some self-hosted runners).
  env -u ELECTRON_SKIP_BINARY_DOWNLOAD node scripts/install-electron-binary.mjs
}

for i in $(seq 1 $MAX_ATTEMPTS); do
  echo "===== Attempt $i / $MAX_ATTEMPTS ====="
  rm -rf node_modules || true
  unset ELECTRON_SKIP_BINARY_DOWNLOAD
  clear_electron_cache

  if env -u ELECTRON_SKIP_BINARY_DOWNLOAD npm ci --no-audit --no-fund --progress=false --ignore-scripts=false; then
    if install_electron_binary && verify_electron; then
      exit 0
    fi
    echo "Electron install/verify failed on attempt $i."
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
