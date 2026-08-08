#!/bin/bash
#
# Double-click this file to launch Meta Human OS (the latest local build).
# It opens the most recently packaged app in ./out and then gets out of the way.
#
# If no build exists yet, build one first with:  npm run package
#
PROJECT_DIR="/Users/ace/Desktop/dyad"
APP="$(/bin/ls -dt "$PROJECT_DIR/out/"*/"Meta Human OS.app" 2>/dev/null | head -1)"

if [ -z "$APP" ]; then
  echo "No packaged build found in $PROJECT_DIR/out"
  echo "Build one first:  cd \"$PROJECT_DIR\" && npm run package"
  read -n 1 -s -r -p "Press any key to close…"
  exit 1
fi

echo "Launching: $APP"
# Clear the quarantine flag in case the build was ever copied/downloaded, then
# open it. Auto-update and the move-to-Applications prompt are disabled for
# local builds, so the app stays put and stays open.
/usr/bin/xattr -dr com.apple.quarantine "$APP" 2>/dev/null
open "$APP"
