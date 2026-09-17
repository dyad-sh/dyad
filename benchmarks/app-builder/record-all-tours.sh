#!/bin/bash
# Record demo tours for the sol + fable-5.1 cells (all 3 apps), two at a time
# on distinct app ports, then rebuild the gallery. Skips cells whose mp4 exists.
set -uo pipefail
BENCH="$(cd "$(dirname "$0")" && pwd)"
LOG=/tmp/claude-501/tours
mkdir -p "$LOG"

rec() { # cell app port title subtitle
  local CELL="$1" APP="$2" PORT="$3" TITLE="$4" SUB="$5"
  if [[ -f "$BENCH/results/videos/demo-$CELL.mp4" ]]; then echo "[all] SKIP $CELL (exists)"; return; fi
  echo "[all] $CELL start $(date +%H:%M:%S)"
  "$BENCH/record-tours.sh" "$CELL" "$APP" "$PORT" "$TITLE" "$SUB" > "$LOG/$CELL.log" 2>&1
  echo "[all] $CELL done exit=$? $(date +%H:%M:%S): $(grep -E 'DONE|failed|never came up|no video' "$LOG/$CELL.log" | tail -1)"
}

# pairs: (sol, fable) per app on ports 3200/3201; apps sequential
for APP in relay-crm deskhero portalis; do
  case $APP in
    relay-crm) L="Relay CRM";; deskhero) L="Deskhero";; portalis) L="Portalis";;
  esac
  rec "gpt-5.6-sol-$APP"      "$APP" 3200 "GPT 5.6 Sol"      "$L · full app after milestone 3" &
  P1=$!
  rec "claude-fable-5-1-$APP" "$APP" 3201 "Claude Fable 5.1" "$L · full app after milestone 3" &
  P2=$!
  wait "$P1" "$P2"
done
"$BENCH/make-gallery.sh"
echo "ALL TOURS COMPLETE $(date +%H:%M:%S)"
