#!/usr/bin/env bash
# ci-cleanup-macos.sh — Frees disk space on self-hosted macOS CI runners.
#
# Intended to run as a post-job step in GitHub Actions workflows that use
# self-hosted macOS ARM64 runners. Safe to run multiple times (idempotent).
#
# What it cleans:
#   1. Build outputs           (out/, out-macos.tar)
#   2. Blob reports            (blob-report/)
#   3. Cloned template repos   (nextjs-template/)
#   4. Old Playwright browsers (keeps only the current version)
#   5. npm cache artifacts     (_cacache, _logs)
#   6. Old runner diagnostics  (_diag/*.log older than 7 days)

set -euo pipefail

echo "=== CI Cleanup (macOS self-hosted) ==="
df -h / | tail -1 | awk '{print "Disk before cleanup: "$4" available ("$5" used)"}'

bytes_before=$(df -k / | tail -1 | awk '{print $4}')

# ---------------------------------------------------------------------------
# 1. Build outputs in the workspace
# ---------------------------------------------------------------------------
for f in out out-macos.tar; do
  if [ -e "$f" ]; then
    echo "Removing build output: $f"
    rm -rf "$f"
  fi
done

# ---------------------------------------------------------------------------
# 2. Blob reports / playwright reports
# ---------------------------------------------------------------------------
for d in blob-report all-blob-reports playwright-report test-results; do
  if [ -d "$d" ]; then
    echo "Removing test artifacts: $d/"
    rm -rf "$d"
  fi
done

# ---------------------------------------------------------------------------
# 3. Cloned template repos (re-cloned every run)
# ---------------------------------------------------------------------------
if [ -d "nextjs-template" ]; then
  echo "Removing cloned nextjs-template/"
  rm -rf nextjs-template
fi

# ---------------------------------------------------------------------------
# 4. Old Playwright browser versions
#    Playwright stores browsers under ~/Library/Caches/ms-playwright.
#    Keep only the version that matches the current project's playwright.
# ---------------------------------------------------------------------------
PW_CACHE="${HOME}/Library/Caches/ms-playwright"
if [ -d "$PW_CACHE" ]; then
  # Detect the expected chromium revision from the installed playwright
  CURRENT_CHROMIUM=""
  if command -v node &>/dev/null && { [ -f "node_modules/.package-lock.json" ] || [ -d "node_modules/playwright-core" ]; }; then
    CURRENT_CHROMIUM=$(node -e "const b=require('./node_modules/playwright-core/browsers.json').browsers.find(x=>x.name==='chromium'); console.log(b.revision)" 2>/dev/null || true)
  fi

  removed_browsers=0
  for browser_dir in "$PW_CACHE"/chromium-*; do
    [ -d "$browser_dir" ] || continue
    dir_name=$(basename "$browser_dir")
    if [ -n "$CURRENT_CHROMIUM" ] && echo "$dir_name" | grep -q "$CURRENT_CHROMIUM"; then
      echo "Keeping current browser: $dir_name"
    else
      # Remove browser dirs older than 1 day (stale from previous runs)
      if [ "$(find "$browser_dir" -maxdepth 0 -mtime +0 -print 2>/dev/null)" ]; then
        echo "Removing old browser: $dir_name"
        rm -rf "$browser_dir"
        removed_browsers=$((removed_browsers + 1))
      fi
    fi
  done

  # Also clean up old non-chromium browsers (firefox, webkit) if present
  for browser_dir in "$PW_CACHE"/firefox-* "$PW_CACHE"/webkit-*; do
    [ -d "$browser_dir" ] || continue
    echo "Removing unused browser: $(basename "$browser_dir")"
    rm -rf "$browser_dir"
    removed_browsers=$((removed_browsers + 1))
  done

  if [ "$removed_browsers" -gt 0 ]; then
    echo "Removed $removed_browsers old browser installation(s)"
  fi
fi

# ---------------------------------------------------------------------------
# 5. npm cache bloat (_cacache, _logs inside ~/.npm)
# ---------------------------------------------------------------------------
NPM_CACHE="${HOME}/.npm"
if [ -d "$NPM_CACHE/_cacache" ]; then
  cache_size=$(du -sh "$NPM_CACHE/_cacache" 2>/dev/null | cut -f1 || echo "?")
  echo "Clearing npm cache (${cache_size})..."
  rm -rf "$NPM_CACHE/_cacache"
fi
if [ -d "$NPM_CACHE/_logs" ]; then
  echo "Removing npm logs"
  rm -rf "$NPM_CACHE/_logs"
fi

# ---------------------------------------------------------------------------
# 6. Runner diagnostic logs older than 7 days
# ---------------------------------------------------------------------------
RUNNER_DIR="${RUNNER_DIR:-${HOME}/actions-runner}"
if [ -d "$RUNNER_DIR/_diag" ]; then
  old_logs=$(find "$RUNNER_DIR/_diag" -name '*.log' -mtime +7 2>/dev/null | wc -l | tr -d ' ')
  if [ "$old_logs" -gt 0 ]; then
    echo "Removing $old_logs old runner diagnostic log(s)"
    find "$RUNNER_DIR/_diag" -name '*.log' -mtime +7 -delete 2>/dev/null || true
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
bytes_after=$(df -k / | tail -1 | awk '{print $4}')
freed_kb=$((bytes_after - bytes_before))
if [ "$freed_kb" -gt 1024 ]; then
  freed_mb=$((freed_kb / 1024))
  echo "Freed ~${freed_mb} MB"
else
  echo "Freed ~${freed_kb} KB"
fi

df -h / | tail -1 | awk '{print "Disk after cleanup:  "$4" available ("$5" used)"}'
echo "=== Cleanup complete ==="
