#!/bin/bash
# Launches the dev server in a Terminal window, which is what keeps it alive:
# npm run dev dies when the calling tool shell exits.
#
# No `exec`, deliberately. With exec, the shell is replaced and the window dies
# with the server, leaving a dead window that cannot be reused — which is how
# eight of them accumulated. Without it the shell survives, so the same window
# can be reused for the next restart.
cd "/Users/ace/Desktop/Mos V2" || exit 1
npm run dev
echo
echo "Dev server stopped. This window can be reused for the next launch."
