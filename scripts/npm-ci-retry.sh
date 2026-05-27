#!/bin/bash
# npm-ci-retry.sh
# Retry npm ci up to 3 times to handle intermittent EBUSY/EPERM errors on Windows.
# These errors are caused by file locking from antivirus or indexing services.
#
# Electron 42+ no longer has a postinstall hook, so we must explicitly invoke
# install.js after npm ci to download the binary.

set -e

MAX_ATTEMPTS=3
RETRY_DELAY=10

verify_electron() {
  node -e 'console.log(require("electron"))'
}

# Where @electron/get caches downloaded zips. A corrupted entry here causes
# install.js to silently "succeed" without writing path.txt.
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
  # Force fresh download (bypass any cached zip). install.js reads
  # `force_no_cache` from env and passes it as `force: true` to @electron/get.
  env -u ELECTRON_SKIP_BINARY_DOWNLOAD force_no_cache=true \
    node node_modules/electron/install.js
}

for i in $(seq 1 $MAX_ATTEMPTS); do
  rm -rf node_modules || true
  unset ELECTRON_SKIP_BINARY_DOWNLOAD
  clear_electron_cache

  if env -u ELECTRON_SKIP_BINARY_DOWNLOAD npm ci --no-audit --no-fund --progress=false --ignore-scripts=false; then
    # Electron 42 has no postinstall, so npm ci leaves the binary uninstalled.
    echo "Running Electron install.js (force_no_cache=true)..."
    if install_electron_binary && [ -f node_modules/electron/path.txt ] && verify_electron; then
      exit 0
    fi

    echo "Electron install.js did not produce a working install (path.txt missing or require failed)."
    echo "Rebuilding electron and retrying..."
    if env -u ELECTRON_SKIP_BINARY_DOWNLOAD force_no_cache=true npm rebuild electron --ignore-scripts=false \
        && install_electron_binary \
        && [ -f node_modules/electron/path.txt ] \
        && verify_electron; then
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
