#!/usr/bin/env bash
set -euo pipefail

BASE_REPO="${PR_PUSH_BASE_REPO:-dyad-sh/dyad}"
BASE_BRANCH="${PR_PUSH_BASE_BRANCH:-main}"
DEFAULT_REMOTE="${PR_PUSH_REMOTE:-origin}"
REVIEW_LABEL="needs-human:review-issue"
CREATED_BRANCH=""
IGNORED_FILES=()
COMMITTED_FILES=()
LINT_CHANGED="no"
PUSH_REMOTE=""
PUSH_OWNER_REPO=""
PR_URL=""
PR_NUMBER=""
PR_CREATION_LINK=""
SUGGESTED_TITLE=""
SUGGESTED_BODY=""
CREATED_COMMIT="no"

log() {
  printf '==> %s\n' "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

repo_root() {
  git rev-parse --show-toplevel
}

current_branch() {
  git branch --show-current
}

has_changes() {
  [[ -n "$(git status --porcelain -uall)" ]]
}

is_ignored_file() {
  local file="$1"

  case "$file" in
    .env | .env.* | */.env | */.env.* | credentials.* | */credentials.* | *.secret | *.key | *.pem | .DS_Store | */.DS_Store | *.log | node_modules/* | */node_modules/*)
      return 0
      ;;
  esac

  return 1
}

path_is_dirty() {
  local file="$1"
  [[ -n "$(git status --porcelain -uall -- "$file")" ]]
}

package_json_dirty() {
  path_is_dirty "package.json"
}

restore_spurious_package_lock() {
  if path_is_dirty "package-lock.json" && ! package_json_dirty; then
    log "Discarding package-lock.json because package.json is unchanged"
    git restore --staged package-lock.json 2>/dev/null || true
    git restore package-lock.json
    IGNORED_FILES+=("package-lock.json (spurious without package.json)")
  fi
}

stage_relevant_changes() {
  restore_spurious_package_lock

  local status path
  while IFS= read -r status; do
    path="${status:3}"
    [[ -z "$path" ]] && continue

    if is_ignored_file "$path"; then
      IGNORED_FILES+=("$path")
      continue
    fi

    git add -- "$path"
  done < <(git status --porcelain -uall)
}

staged_file_list() {
  git diff --cached --name-only
}

default_branch_name() {
  local files joined
  files="$(git status --porcelain -uall | awk '{print $2}' | head -5 | tr '\n' ' ')"

  case "$files" in
    *".claude/skills/pr-push"*) joined="fast-pr-push-skill" ;;
    *".github/workflows"*) joined="update-workflows" ;;
    *"rules/"* | *"AGENTS.md"*) joined="update-agent-docs" ;;
    *"src/"*) joined="update-app-code" ;;
    *) joined="codex-pr-push" ;;
  esac

  printf '%s-%s' "$joined" "$(date +%Y%m%d%H%M%S)"
}

ensure_feature_branch() {
  local branch
  branch="$(current_branch)"

  [[ -n "$branch" ]] || die "Detached HEAD is not supported"

  if [[ "$branch" == "main" || "$branch" == "master" ]]; then
    CREATED_BRANCH="$(default_branch_name)"
    log "On $branch; creating feature branch $CREATED_BRANCH"
    git checkout -b "$CREATED_BRANCH"
  else
    log "Using existing feature branch $branch"
  fi
}

commit_message_from_staged_files() {
  if [[ -n "${PR_PUSH_COMMIT_MESSAGE:-}" ]]; then
    printf '%s\n' "$PR_PUSH_COMMIT_MESSAGE"
    return
  fi

  local files
  files="$(staged_file_list | tr '\n' ' ')"

  case "$files" in
    *".claude/skills/pr-push"*) printf 'chore: speed up pr push skill\n' ;;
    *"rules/"* | *"AGENTS.md"*) printf 'docs: record session learnings\n' ;;
    *".github/workflows"*) printf 'ci: update workflows\n' ;;
    *) printf 'chore: update project files\n' ;;
  esac
}

commit_if_needed() {
  if ! has_changes; then
    log "No uncommitted changes to commit"
    return
  fi

  stage_relevant_changes

  if [[ -z "$(staged_file_list)" ]]; then
    log "No relevant changes staged"
    return
  fi

  while IFS= read -r file; do
    COMMITTED_FILES+=("$file")
  done < <(staged_file_list)
  local message
  message="$(commit_message_from_staged_files)"
  log "Committing staged changes: $message"
  git commit -m "$message"
  CREATED_COMMIT="yes"
}

run_checks() {
  log "Running formatter"
  npm run fmt

  log "Running lint fix"
  npm run lint:fix

  log "Running typecheck"
  npm run ts

  log "Running tests"
  npm test
}

amend_or_commit_check_changes() {
  if ! has_changes; then
    log "Checks did not modify tracked files"
    return
  fi

  LINT_CHANGED="yes"
  stage_relevant_changes

  if [[ -z "$(staged_file_list)" ]]; then
    log "Checks only touched ignored files"
    return
  fi

  if [[ "$CREATED_COMMIT" == "yes" ]]; then
    log "Amending automated check changes into previous commit"
    git commit --amend --no-edit
  else
    log "Committing automated check changes"
    git commit -m "chore: apply automated fixes"
    CREATED_COMMIT="yes"
  fi
}

remote_owner_repo() {
  local remote="$1"
  local url
  url="$(git remote get-url --push "$remote" 2>/dev/null || git remote get-url "$remote")"

  url="${url%.git}"
  case "$url" in
    git@github.com:*) printf '%s\n' "${url#git@github.com:}" ;;
    https://github.com/*) printf '%s\n' "${url#https://github.com/}" ;;
    https://*@github.com/*) printf '%s\n' "${url#*@github.com/}" ;;
    *) printf '%s\n' "$url" ;;
  esac
}

push_with_fallback() {
  local upstream push_output

  if upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
    PUSH_REMOTE="${upstream%%/*}"
    log "Pushing to tracked upstream $upstream"
    if push_output="$(git push --force-with-lease 2>&1)"; then
      printf '%s\n' "$push_output"
      PUSH_OWNER_REPO="$(remote_owner_repo "$PUSH_REMOTE")"
      return
    fi

    printf '%s\n' "$push_output" >&2
    if grep -qiE 'permission|denied|403|not allowlisted' <<<"$push_output"; then
      log "Tracked push failed with permission-like error; falling back to $DEFAULT_REMOTE"
      PUSH_REMOTE="$DEFAULT_REMOTE"
      git push --force-with-lease -u "$DEFAULT_REMOTE" HEAD
      PUSH_OWNER_REPO="$(remote_owner_repo "$PUSH_REMOTE")"
      return
    fi

    die "Push to tracked upstream failed"
  fi

  local pr_head_repo pr_view_output matched_remote
  if pr_view_output="$(gh pr view --json headRepository --jq .headRepository.nameWithOwner 2>&1)"; then
    pr_head_repo="$pr_view_output"
    while IFS= read -r remote; do
      if [[ "$(remote_owner_repo "$remote")" == "$pr_head_repo" ]]; then
        matched_remote="$remote"
        break
      fi
    done < <(git remote)
  elif ! grep -qiE 'no pull requests found|no pull request found' <<<"$pr_view_output"; then
    printf '%s\n' "$pr_view_output" >&2
    die "Unable to check existing PR before push"
  fi

  PUSH_REMOTE="${matched_remote:-$DEFAULT_REMOTE}"
  log "Pushing to $PUSH_REMOTE"
  if git push --force-with-lease -u "$PUSH_REMOTE" HEAD; then
    PUSH_OWNER_REPO="$(remote_owner_repo "$PUSH_REMOTE")"
    return
  fi

  if [[ "$PUSH_REMOTE" != "upstream" ]]; then
    log "Push to $PUSH_REMOTE failed; trying upstream as fallback"
    PUSH_REMOTE="upstream"
    git push --force-with-lease -u upstream HEAD
    PUSH_OWNER_REPO="$(remote_owner_repo "$PUSH_REMOTE")"
    return
  fi

  die "Push failed"
}

active_account_is_bot() {
  local status account
  status="$(gh auth status 2>&1)"
  account="$(sed -nE 's/.*Logged in to github.com account ([^ ]+).*/\1/p' <<<"$status" | head -1)"
  [[ "$account" == *"[bot]" ]]
}

pr_title() {
  if [[ -n "${PR_PUSH_PR_TITLE:-}" ]]; then
    printf '%s\n' "$PR_PUSH_PR_TITLE"
    return
  fi

  local subject
  subject="$(git log -1 --pretty=%s)"
  local lower_subject
  lower_subject="$(printf '%s' "$subject" | tr '[:upper:]' '[:lower:]')"
  case "$lower_subject" in
    chore:\ *) subject="${subject#*: }" ;;
    fix:\ *) subject="${subject#*: }" ;;
    feat:\ *) subject="${subject#*: }" ;;
    docs:\ *) subject="${subject#*: }" ;;
    ci:\ *) subject="${subject#*: }" ;;
    test:\ *) subject="${subject#*: }" ;;
    refactor:\ *) subject="${subject#*: }" ;;
  esac

  if [[ -z "$subject" ]]; then
    printf 'Update project files\n'
  else
    printf '%s%s\n' "$(tr '[:lower:]' '[:upper:]' <<<"${subject:0:1}")" "${subject:1}"
  fi
}

pr_body() {
  if [[ -n "${PR_PUSH_PR_BODY:-}" ]]; then
    printf '%s\n' "$PR_PUSH_PR_BODY"
    return
  fi

  local files_line
  files_line="$(git diff --name-only "$BASE_BRANCH"...HEAD 2>/dev/null | head -6 | awk 'BEGIN { sep="" } { printf "%s%s", sep, $0; sep=", " }')"

  printf '## Summary\n'
  printf -- '- %s\n' "$(git log -1 --pretty=%s)"
  if [[ -n "$files_line" ]]; then
    printf -- '- Primary files: %s\n' "$files_line"
  fi
}

create_or_update_pr() {
  local view_output body_file branch head_owner title body

  if view_output="$(gh pr view --json number,url 2>&1)"; then
    PR_NUMBER="$(jq -r .number <<<"$view_output")"
    PR_URL="$(jq -r .url <<<"$view_output")"
    log "PR already exists: $PR_URL"
  else
    if ! grep -qiE 'no pull requests found|no pull request found' <<<"$view_output"; then
      printf '%s\n' "$view_output" >&2
      die "Unable to check PR state"
    fi

    branch="$(current_branch)"
    head_owner="${PUSH_OWNER_REPO%%/*}"
    title="$(pr_title)"
    body="$(pr_body)"
    SUGGESTED_TITLE="$title"
    SUGGESTED_BODY="$body"

    if active_account_is_bot; then
      PR_CREATION_LINK="https://github.com/${PUSH_OWNER_REPO}/pull/new/${branch}"
      log "Active GitHub account is a bot; skipping PR creation"
      return
    fi

    mkdir -p .claude/tmp
    body_file="$(mktemp .claude/tmp/pr-push-body.XXXXXX)"
    printf '%s\n' "$body" >"$body_file"

    log "Creating PR against $BASE_REPO"
    PR_URL="$(gh pr create \
      --repo "$BASE_REPO" \
      --head "${head_owner}:${branch}" \
      --base "$BASE_BRANCH" \
      --title "$title" \
      --body-file "$body_file")"
    rm -f "$body_file"
    PR_NUMBER="${PR_URL##*/}"
  fi

  if [[ -n "$PR_NUMBER" ]]; then
    gh pr edit "$PR_NUMBER" --repo "$BASE_REPO" --remove-label "$REVIEW_LABEL" >/dev/null 2>&1 || true
  fi
}

print_summary() {
  printf '\nPR push summary\n'
  printf -- '---------------\n'
  printf 'Branch: %s\n' "$(current_branch)"
  [[ -n "$CREATED_BRANCH" ]] && printf 'Created branch: %s\n' "$CREATED_BRANCH"
  printf 'Committed files:\n'
  if ((${#COMMITTED_FILES[@]} == 0)); then
    printf -- '- none\n'
  else
    printf -- '- %s\n' "${COMMITTED_FILES[@]}"
  fi
  printf 'Ignored files:\n'
  if ((${#IGNORED_FILES[@]} == 0)); then
    printf -- '- none\n'
  else
    printf -- '- %s\n' "${IGNORED_FILES[@]}"
  fi
  printf 'Automated check changes: %s\n' "$LINT_CHANGED"
  printf 'Checks: passed\n'
  printf 'Pushed remote: %s (%s)\n' "$PUSH_REMOTE" "$PUSH_OWNER_REPO"
  if [[ -n "$PR_URL" ]]; then
    printf 'PR: %s\n' "$PR_URL"
  elif [[ -n "$PR_CREATION_LINK" ]]; then
    printf 'PR creation skipped for bot account.\n'
    printf 'Create PR: %s\n' "$PR_CREATION_LINK"
    printf 'Suggested title: %s\n' "$SUGGESTED_TITLE"
    printf 'Suggested body:\n%s\n' "$SUGGESTED_BODY"
  fi
}

main() {
  cd "$(repo_root)"
  ensure_feature_branch
  commit_if_needed
  run_checks
  amend_or_commit_check_changes
  push_with_fallback
  create_or_update_pr
  print_summary
}

main "$@"
