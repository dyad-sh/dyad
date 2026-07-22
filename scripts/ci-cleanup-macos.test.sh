#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

export HOME="$TEST_ROOT/home"
export RUNNER_DIR="$HOME/actions-runner"
export GITHUB_WORKSPACE="$RUNNER_DIR/_work/dyad/dyad"
export CI_NIGHTLY_CLEANUP=1

mkdir -p \
  "$GITHUB_WORKSPACE" \
  "$RUNNER_DIR/_work/stale-repo/stale-repo" \
  "$RUNNER_DIR/_work/_PipelineMapping" \
  "$HOME/Library/Caches"

# A top-level repository directory can retain an old mtime even while files in
# its active workspace are changing.
touch -t 202001010000 "$RUNNER_DIR/_work/dyad"
touch -t 202001010000 "$RUNNER_DIR/_work/stale-repo"
touch -t 202001010000 "$RUNNER_DIR/_work/_PipelineMapping"

cd "$GITHUB_WORKSPACE"
bash "$SCRIPT_DIR/ci-cleanup-macos.sh" >"$TEST_ROOT/output.log"

test -d "$GITHUB_WORKSPACE"
test -d "$RUNNER_DIR/_work/_PipelineMapping"
test ! -e "$RUNNER_DIR/_work/stale-repo"
grep -q "Keeping active _work dir: $RUNNER_DIR/_work/dyad" "$TEST_ROOT/output.log"
grep -q "Keeping runner-owned _work dir: $RUNNER_DIR/_work/_PipelineMapping" "$TEST_ROOT/output.log"
grep -q "Removing stale _work dir: $RUNNER_DIR/_work/stale-repo" "$TEST_ROOT/output.log"

echo "ci-cleanup-macos tests passed"
