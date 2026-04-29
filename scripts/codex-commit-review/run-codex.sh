#!/usr/bin/env bash
set -euo pipefail

test -n "${PROMPT_PATH:-}"
prompt="$(cat "${PROMPT_PATH}")"

log_file="$(mktemp "${RUNNER_TEMP:-/tmp}/codex-commit-review.XXXXXX.log")"
cleanup() {
  rm -f "${log_file}"
}
trap cleanup EXIT

echo "Codex output suppressed. Session logs are uploaded separately."
if codex exec --dangerously-bypass-approvals-and-sandbox \
  "$prompt" >"${log_file}" 2>&1; then
  echo "Codex completed successfully."
  exit 0
else
  status=$?
fi

echo "Codex exited with code ${status}. Full output follows."
cat "${log_file}"
exit "${status}"
