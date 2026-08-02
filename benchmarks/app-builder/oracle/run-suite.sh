#!/bin/bash
# Run one app's CUJ suite against an arbitrary app directory on a FRESH
# database built from that app's schema.sql. This is the oracle loop: the
# reference implementation must score 100%, and the broken twin must fail the
# security probes.
#
# Usage: ./run-suite.sh <appDir> <app> <checkpoint> <port> [grep]
#   e.g. ./run-suite.sh oracle/relay-crm/reference relay-crm 3 3600
# Requires neon-sim running (see ../neon-sim/README.md).
set -uo pipefail

BENCH="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$(cd "${1:?appDir}" && pwd)"
APP="${2:?app}"
CK="${3:?checkpoint}"
PORT="${4:?port}"
GREP="${5:-}"
SIM="http://127.0.0.1:7788"

# Two runs sharing one app directory corrupt each other's .next output (Next
# writes build manifests in place), which shows up as a bogus ENOENT build
# failure and silently invalid scores. Serialize per app directory with an
# atomic mkdir lock rather than trusting callers to coordinate.
LOCKDIR="$APP_DIR/.oracle-lock"
for attempt in $(seq 1 240); do
  if mkdir "$LOCKDIR" 2>/dev/null; then break; fi
  if (( attempt == 1 )); then echo "[oracle] another run holds $APP_DIR; waiting…"; fi
  if (( attempt == 240 )); then echo "[oracle] lock timeout on $APP_DIR (stale? rm -rf $LOCKDIR)"; exit 1; fi
  sleep 5
done
# ONE EXIT handler only: bash keeps a single handler per signal, so a second
# `trap ... EXIT` later in the file would silently replace this one and leak
# the lock on every successful run.
cleanup() {
  kill "${SERVER:-}" 2>/dev/null || true
  [[ -n "${LABEL:-}" ]] && dropdb --if-exists "$LABEL" 2>/dev/null
  rmdir "$LOCKDIR" 2>/dev/null || true
}
trap cleanup EXIT

[[ -f "$APP_DIR/schema.sql" ]] || { echo "[oracle] $APP_DIR/schema.sql missing"; exit 1; }

# Milestones legitimately change behaviour (e.g. deskhero M1 allows an owner to
# close/reopen, which the M2 transition matrix forbids), so a single tree cannot
# satisfy every checkpoint. Mirror the real scorer: if the app is a git repo
# carrying checkpoint tags, score each checkpoint against its own tag.
# The tree must be its OWN repository. Testing "is this path inside any repo"
# is not the same test: five oracle trees have no .git of their own, so
# \`git -C "$APP_DIR"\` resolves to the OUTER dyad repo. That silently skipped
# the checkout (scoring all three checkpoints against one tree, which is exactly
# what per-checkpoint tags exist to prevent), and had the outer repo ever owned a
# tag named checkpoint-mN it would have checked that tag out across the whole
# dyad working tree.
if [[ -e "$APP_DIR/.git" ]] && git -C "$APP_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  if git -C "$APP_DIR" rev-parse -q --verify "refs/tags/checkpoint-m$CK" >/dev/null; then
    git -C "$APP_DIR" checkout -q "checkpoint-m$CK" 2>/dev/null \
      && echo "[oracle] checked out checkpoint-m$CK" \
      || echo "[oracle] WARNING: could not check out checkpoint-m$CK (dirty tree?)"
  else
    echo "[oracle] WARNING: $APP_DIR has no checkpoint-m$CK tag — scoring the working tree as-is"
  fi
else
  echo "[oracle] WARNING: $APP_DIR is not its own git repo — every checkpoint is being scored"
  echo "[oracle]          against this single tree. Milestones may legitimately differ."
fi

# Fresh, uniquely-named database each run: no state leaks between iterations.
LABEL="sim_oracle_$(echo "${APP}_${CK}_$$" | tr -c 'a-z0-9_' '_')"
dropdb --if-exists "$LABEL" 2>/dev/null
PROJ=$(curl -sf -X POST "$SIM/api/v2/projects" -H 'content-type: application/json' \
  -H 'authorization: Bearer oracle' \
  -d "{\"project\":{\"name\":\"$LABEL\"}}") || { echo "[oracle] project create failed"; exit 1; }
PID=$(node -e "console.log(JSON.parse(process.argv[1]).project.id)" "$PROJ")
BID=$(node -e "console.log(JSON.parse(process.argv[1]).branch.id)" "$PROJ")
DBURL=$(node -e "console.log(JSON.parse(process.argv[1]).connection_uris[0].connection_uri)" "$PROJ")
AUTH=$(curl -sf -X POST "$SIM/api/v2/projects/$PID/branches/$BID/auth" \
  -H 'content-type: application/json' -H 'authorization: Bearer oracle' \
  -d '{"auth_provider":"better-auth"}')
AUTHURL=$(node -e "const a=JSON.parse(process.argv[1]);console.log(a.base_url??a.auth_base_url)" "$AUTH")

# Apply the reference schema to the fresh branch database.
DBNAME=$(node -e "console.log(new URL(process.argv[1]).pathname.slice(1))" "$DBURL")
psql -q -d "$DBNAME" -f "$APP_DIR/schema.sql" > /tmp/oracle-schema-$$.log 2>&1 || {
  echo "[oracle] schema.sql failed to apply:"; tail -5 /tmp/oracle-schema-$$.log; exit 1; }
# psql applies as the OS user, but the app connects as simuser: without this
# every query dies with "permission denied for table ...". Granting here keeps
# schema.sql portable instead of requiring each reference to carry GRANTs.
psql -q -d "$DBNAME" -c "GRANT USAGE ON SCHEMA public TO PUBLIC;" \
  -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO PUBLIC;" \
  -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;" >> /tmp/oracle-schema-$$.log 2>&1 || true

printf 'DATABASE_URL=%s\nPOSTGRES_URL=%s\nNEON_AUTH_BASE_URL=%s\nNEON_AUTH_COOKIE_SECRET=%s\n' \
  "$DBURL" "$DBURL" "$AUTHURL" "$(openssl rand -hex 32)" > "$APP_DIR/.env.local"

export PLAYWRIGHT_SKIP_BROWSER_GC=1
export NODE_EXTRA_CA_CERTS="$BENCH/neon-sim/certs/ca.pem"

(cd "$APP_DIR" && pnpm install --prefer-offline > /tmp/oracle-install-$$.log 2>&1) || {
  echo "[oracle] install failed"; tail -5 /tmp/oracle-install-$$.log; exit 1; }
(cd "$APP_DIR" && npx next build --no-lint > /tmp/oracle-build-$$.log 2>&1) || {
  echo "[oracle] BUILD FAILED:"; grep -E "Error|error" /tmp/oracle-build-$$.log | head -5; exit 1; }

(cd "$APP_DIR" && exec npx next start -p "$PORT" > /tmp/oracle-server-$$.log 2>&1) &
SERVER=$!
for _ in $(seq 1 90); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$PORT/auth/sign-in")" == "200" ]] && break
  sleep 1
done

ARGS=("$APP/checkpoint-$CK.spec.ts")
[[ -n "$GREP" ]] && ARGS+=(-g "$GREP")
(cd "$BENCH/cuj-tests" && APP_URL="http://localhost:$PORT" \
  APPBENCH_DATABASE_URL="${DATABASE_URL:-$DBURL}" \
  CUJ_RESULTS="/tmp/oracle-cuj-$$.json" npx playwright test "${ARGS[@]}" 2>&1 | tail -25)

node -e "
const r=require('/tmp/oracle-cuj-$$.json');
const t=[];const walk=s=>{(s.suites||[]).forEach(walk);(s.specs||[]).forEach(x=>t.push(x))};
(r.suites||[]).forEach(walk);
const st=x=>x.tests?.[0]?.results?.[0]?.status??'missing';
const pass=t.filter(x=>st(x)==='passed').length;
const fail=t.filter(x=>st(x)!=='passed').map(x=>x.title.split(' ')[0]);
console.log('[oracle] '+pass+'/'+t.length+' passed'+(fail.length?'  FAILING: '+fail.join(', '):'  ALL PASS'));
"
echo "[oracle] server log: /tmp/oracle-server-$$.log"
