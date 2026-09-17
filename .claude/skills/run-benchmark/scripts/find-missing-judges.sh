#!/bin/bash
# List scored checkpoints (buildStatus ok) that have NO judge verdict, and the
# judge debug files that came back empty. report.mjs silently scores a missing
# verdict as judge=0 (up to ~4 composite points), so run this after every
# scoring pass. With --fix, re-run the judge for each missing verdict.
#
#   find-missing-judges.sh [--bench <dir>] [--fix]
set -uo pipefail
BENCH="$(pwd)/benchmarks/app-builder"; FIX=0
while [[ $# -gt 0 ]]; do case "$1" in --bench) BENCH="$2"; shift 2;; --fix) FIX=1; shift;; *) shift;; esac; done
cd "$BENCH" || exit 1
missing=()
for f in results/s-score/*-ckpt[123]-a1.json; do
  b=$(basename "$f" -a1.json); cell=${b%-ckpt*}; k=${b##*-ckpt}
  [[ $(node -e "console.log(require('./$f').buildStatus)") == ok ]] || continue
  [[ -f results/judge/$cell-m$k.json ]] || missing+=("$cell m$k")
done
echo "scored checkpoints without a judge verdict: ${#missing[@]}"
printf '  %s\n' "${missing[@]}"
empty=$(find results/judge -name 'debug-*.txt' -size 0 2>/dev/null | wc -l | tr -d ' ')
echo "empty judge debug files (judge returned no body): $empty"
if (( FIX )) && (( ${#missing[@]} )); then
  for entry in "${missing[@]}"; do
    cell=${entry% m*}; k=${entry##* m}; app=$(grep -o "relay-crm\|deskhero\|portalis" <<<"$cell" | head -1)
    echo "== judging $cell m$k ($app)"
    [[ -d results/s-cell/checkouts/$cell ]] || { echo "   no checkout on disk — unrecoverable"; continue; }
    APPBENCH_APP=$app node judge/judge.mjs --cell "$cell" --milestone "$k" 2>&1 | grep "score=\|FAILED" | cut -c1-160
  done
fi
