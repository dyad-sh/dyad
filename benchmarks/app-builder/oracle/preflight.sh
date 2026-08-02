#!/bin/bash
# Pre-flight gate: prove the harness is sane BEFORE any model cell is scored.
#
#   reference app  -> must score 100% on the checkpoint (positive control)
#   broken twin    -> every security probe must FAIL (negative control)
#
# A benchmark with no controls cannot tell "the model is bad" from "the harness
# is broken" — this session produced five distinct harness defects that each
# looked like a model result. Run this first; if it fails, do not score.
#
# Usage: ./preflight.sh <app> <checkpoint> <port>
#   e.g. ./preflight.sh portalis 3 3900
set -uo pipefail

BENCH="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:?app}"; CK="${2:?checkpoint}"; PORT="${3:-3900}"
REF="$BENCH/oracle/$APP/reference"
TWIN="$BENCH/oracle/$APP/broken"
OUT="$BENCH/results/preflight"
mkdir -p "$OUT"

fail() { echo "[preflight] FAIL: $*"; echo "$*" > "$OUT/$APP-ckpt$CK.FAILED"; exit 1; }

[[ -d "$REF" ]] || fail "no reference at $REF"

echo "[preflight] $APP ckpt$CK — positive control (reference must be 100%)"
REF_OUT=$("$BENCH/oracle/run-suite.sh" "$REF" "$APP" "$CK" "$PORT" 2>&1 | tail -30)
REF_LINE=$(echo "$REF_OUT" | grep -E "^\[oracle\] [0-9]+/[0-9]+ passed" | tail -1)
[[ -n "$REF_LINE" ]] || { echo "$REF_OUT" | tail -8; fail "reference produced no score"; }
REF_PASS=$(echo "$REF_LINE" | sed -E 's/.* ([0-9]+)\/([0-9]+) passed.*/\1/')
REF_TOTAL=$(echo "$REF_LINE" | sed -E 's/.* ([0-9]+)\/([0-9]+) passed.*/\2/')
echo "[preflight]   reference: $REF_PASS/$REF_TOTAL"
[[ "$REF_PASS" == "$REF_TOTAL" ]] || fail "reference scored $REF_PASS/$REF_TOTAL, expected 100% — the harness is broken, not the models ($REF_LINE)"

if [[ -d "$TWIN" ]]; then
  echo "[preflight] $APP ckpt$CK — negative control (twin's probes must all fail)"
  TWIN_OUT=$("$BENCH/oracle/run-suite.sh" "$TWIN" "$APP" "$CK" "$((PORT + 50))" 2>&1 | tail -30)
  TWIN_LINE=$(echo "$TWIN_OUT" | grep -E "^\[oracle\] [0-9]+/[0-9]+ passed" | tail -1)
  [[ -n "$TWIN_LINE" ]] || { echo "$TWIN_OUT" | tail -8; fail "twin produced no score"; }
  TWIN_PASS=$(echo "$TWIN_LINE" | sed -E 's/.* ([0-9]+)\/([0-9]+) passed.*/\1/')
  echo "[preflight]   twin: $TWIN_LINE"
  FAILING=$(echo "$TWIN_LINE" | sed -E 's/.*FAILING: //')
  echo "[preflight]   twin failures: $FAILING"
  # EVERY probe at this checkpoint must fail against a deliberately vulnerable
  # app. "Some probe tripped" is not enough: a probe nobody has ever seen fire
  # is not evidence of security, and 25% of the quality score rides on them.
  case "$APP" in
    relay-crm) PROBE_RE='-s[0-9]' ;;
    deskhero)  PROBE_RE='-p-' ;;
    portalis)  PROBE_RE='^S[0-9]-' ;;
    *)         PROBE_RE='' ;;
  esac
  if [[ -n "$PROBE_RE" ]]; then
    ALL_PROBES=$(cd "$BENCH/cuj-tests" && npx playwright test "$APP/checkpoint-$CK.spec.ts" --list 2>/dev/null \
      | sed -E 's/.*› //' | awk '{print $1}' | grep -E -- "$PROBE_RE" | sort -u)
    MISSED=""
    for probe in $ALL_PROBES; do
      echo "$FAILING" | grep -q "$probe" || MISSED="$MISSED $probe"
    done
    [[ -z "$MISSED" ]] || fail "probes that did NOT detect the vulnerable twin:$MISSED (they pass everything — treat as unvalidated)"
    echo "[preflight]   all $(echo "$ALL_PROBES" | wc -w | tr -d ' ') probes tripped"
  fi
else
  echo "[preflight] (no twin for $APP — positive control only)"
fi

printf '%s ckpt%s: reference %s/%s, twin %s\n' "$APP" "$CK" "$REF_PASS" "$REF_TOTAL" "${TWIN_LINE:-n/a}" \
  > "$OUT/$APP-ckpt$CK.PASSED"
rm -f "$OUT/$APP-ckpt$CK.FAILED"
echo "[preflight] PASS — $APP ckpt$CK is safe to score"
