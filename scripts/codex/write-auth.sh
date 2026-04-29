#!/usr/bin/env bash
set -euo pipefail

codex_home="${CODEX_HOME:-${HOME}/.codex}"

declare -a candidates=()
declare -A seen=()

add_candidate() {
  local value="${1:-}"
  if [ -z "${value}" ] || [ -n "${seen["${value}"]+x}" ]; then
    return
  fi

  candidates+=("${value}")
  seen["${value}"]=1
}

add_candidate "${CODEX_AUTH_JSON:-}"
add_candidate "${CODEX_AUTH_JSON_1:-}"
add_candidate "${CODEX_AUTH_JSON_2:-}"

if [ "${#candidates[@]}" -eq 0 ]; then
  echo "Expected CODEX_AUTH_JSON or CODEX_AUTH_JSON_1/CODEX_AUTH_JSON_2 to be set" >&2
  exit 1
fi

selected_index=0
if [ "${#candidates[@]}" -gt 1 ]; then
  random_number="$(od -An -N4 -tu4 /dev/urandom | tr -d '[:space:]')"
  selected_index=$((random_number % ${#candidates[@]}))
fi

mkdir -p "${codex_home}"
(umask 077 && printf '%s' "${candidates[${selected_index}]}" > "${codex_home}/auth.json")
