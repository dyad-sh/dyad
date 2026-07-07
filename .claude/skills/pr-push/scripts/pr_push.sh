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
PR_SKIPPED_REASON=""

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

remember_staged_files() {
  local file existing committed_file
  while IFS= read -r file; do
    existing="no"
    for committed_file in "${COMMITTED_FILES[@]+"${COMMITTED_FILES[@]}"}"; do
      if [[ "$committed_file" == "$file" ]]; then
        existing="yes"
        break
      fi
    done
    [[ "$existing" == "yes" ]] || COMMITTED_FILES+=("$file")
  done < <(staged_file_list)
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

git_status_paths() {
  local record xy path
  while IFS= read -r -d '' record; do
    xy="${record:0:2}"
    path="${record:3}"
    [[ -z "$path" ]] && continue

    printf '%s\0' "$path"

    case "$xy" in
      R* | C* | *R | *C)
        IFS= read -r -d '' _ || true
        ;;
    esac
  done < <(git status --porcelain=v1 -z -uall)
}

stage_relevant_changes() {
  restore_spurious_package_lock

  local path
  while IFS= read -r -d '' path; do
    [[ -z "$path" ]] && continue

    if is_ignored_file "$path"; then
      IGNORED_FILES+=("$path")
      git restore --staged -- "$path" 2>/dev/null || true
      continue
    fi

    git add -A -- "$path"
  done < <(git_status_paths)
}

staged_file_list() {
  git diff --cached --name-only
}

default_branch_name() {
  local files joined
  files="$(git_status_paths | tr '\0' '\n' | head -5 | tr '\n' ' ')"

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

  remember_staged_files
  local message
  message="$(commit_message_from_staged_files)"
  log "Committing staged changes: $message"
  git commit -m "$message"
  CREATED_COMMIT="yes"
}

run_checks() {
  log "Running formatter"
  npm run fmt || die "Formatter failed; fix the issues above and rerun"

  log "Running lint fix"
  npm run lint:fix || die "Lint failed; fix the issues above and rerun"

  log "Running typecheck"
  npm run ts || die "Typecheck failed; fix the issues above and rerun"

  log "Running tests"
  npm test || die "Tests failed; fix the issues above and rerun"
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

  remember_staged_files
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
  local url parsed
  url="$(git remote get-url --push "$remote" 2>/dev/null || git remote get-url "$remote")"

  url="${url%.git}"
  parsed="$(printf '%s' "$url" | sed -E 's#^[[:alpha:]][[:alnum:].+-]*://##; s#^[^@/]+@##; s#^github.com[:/]##; s#^git@github.com[:/]##')"
  if [[ "$parsed" != "$url" && "$parsed" == */* ]]; then
    printf '%s\n' "$parsed"
    return
  fi

  case "$url" in
    git@github.com:*) printf '%s\n' "${url#git@github.com:}" ;;
    https://github.com/*) printf '%s\n' "${url#https://github.com/}" ;;
    https://*@github.com/*) printf '%s\n' "${url#*@github.com/}" ;;
    *) printf '%s\n' "$url" ;;
  esac
}

is_permission_push_error() {
  grep -qiE 'permission|denied|403|not allowlisted|could not read Username' <<<"$1"
}

has_remote() {
  git remote get-url "$1" >/dev/null 2>&1
}

remote_for_owner_repo() {
  local owner_repo="$1" remote
  while IFS= read -r remote; do
    if [[ "$(remote_owner_repo "$remote")" == "$owner_repo" ]]; then
      printf '%s\n' "$remote"
      return 0
    fi
  done < <(git remote)

  return 1
}

no_pr_found_error() {
  grep -qiE 'no (open )?pull requests? found|no pull request found' <<<"$1"
}

push_with_fallback() {
  local branch upstream upstream_branch push_output
  branch="$(current_branch)"

  if upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
    PUSH_REMOTE="${upstream%%/*}"
    upstream_branch="${upstream#*/}"

    if [[ "$upstream_branch" != "main" && "$upstream_branch" != "master" ]]; then
      log "Pushing to tracked upstream $upstream"
      if push_output="$(git push --force-with-lease 2>&1)"; then
        printf '%s\n' "$push_output"
        PUSH_OWNER_REPO="$(remote_owner_repo "$PUSH_REMOTE")"
        return
      fi

      printf '%s\n' "$push_output" >&2
      if is_permission_push_error "$push_output"; then
        log "Tracked push failed with permission-like error; falling back to $DEFAULT_REMOTE"
        PUSH_REMOTE="$DEFAULT_REMOTE"
        git push --force-with-lease -u "$DEFAULT_REMOTE" HEAD
        PUSH_OWNER_REPO="$(remote_owner_repo "$PUSH_REMOTE")"
        return
      fi

      die "Push to tracked upstream failed"
    fi

    log "Ignoring tracked upstream $upstream because it points at the base branch"
    git branch --unset-upstream >/dev/null 2>&1 || true
  fi

  local pr_head_repo pr_view_output matched_remote
  if pr_view_output="$(gh pr view "$branch" --repo "$BASE_REPO" --json headRepository --jq .headRepository.nameWithOwner 2>&1)"; then
    pr_head_repo="$pr_view_output"
    while IFS= read -r remote; do
      if [[ "$(remote_owner_repo "$remote")" == "$pr_head_repo" ]]; then
        matched_remote="$remote"
        break
      fi
    done < <(git remote)
  elif ! no_pr_found_error "$pr_view_output"; then
    printf '%s\n' "$pr_view_output" >&2
    die "Unable to check existing PR before push"
  fi

  PUSH_REMOTE="${matched_remote:-$DEFAULT_REMOTE}"
  log "Pushing to $PUSH_REMOTE"
  if push_output="$(git push --force-with-lease -u "$PUSH_REMOTE" HEAD 2>&1)"; then
    printf '%s\n' "$push_output"
    PUSH_OWNER_REPO="$(remote_owner_repo "$PUSH_REMOTE")"
    return
  fi

  printf '%s\n' "$push_output" >&2
  if [[ "$PUSH_REMOTE" != "upstream" ]] && has_remote "upstream" && is_permission_push_error "$push_output"; then
    log "Push to $PUSH_REMOTE failed with permission-like error; trying upstream as fallback"
    PUSH_REMOTE="upstream"
    if push_output="$(git push --force-with-lease -u upstream "HEAD:$branch" 2>&1)"; then
      printf '%s\n' "$push_output"
      PUSH_OWNER_REPO="$(remote_owner_repo "$PUSH_REMOTE")"
      return
    fi
    printf '%s\n' "$push_output" >&2
  fi

  die "Push failed"
}

active_account_is_bot() {
  local account
  account="$(gh api user --jq .login 2>/dev/null || true)"
  [[ "$account" == *"[bot]" ]]
}

pr_title() {
  if [[ -n "${PR_PUSH_PR_TITLE:-}" ]]; then
    printf '%s\n' "$PR_PUSH_PR_TITLE"
    return
  fi

  local subject
  subject="$(git log -1 --pretty=%s)"
  subject="$(printf '%s' "$subject" | sed -E 's/^[[:alpha:]]+(\([^)]*\))?!?:[[:space:]]+//')"

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
  files_line="$( (git diff --name-only "$BASE_BRANCH"...HEAD 2>/dev/null || true) | head -6 | awk 'BEGIN { sep="" } { printf "%s%s", sep, $0; sep=", " }')"

  printf '## Summary\n'
  printf -- '- %s\n' "$(git log -1 --pretty=%s)"
  if [[ -n "$files_line" ]]; then
    printf -- '- Primary files: %s\n' "$files_line"
  fi
}

base_comparison_ref() {
  local base_remote
  if base_remote="$(remote_for_owner_repo "$BASE_REPO")"; then
    printf '%s/%s\n' "$base_remote" "$BASE_BRANCH"
  else
    printf '%s\n' "$BASE_BRANCH"
  fi
}

branch_has_commits_ahead() {
  local base_ref count
  base_ref="$(base_comparison_ref)"
  if ! count="$(git rev-list --count "$base_ref"..HEAD 2>/dev/null)"; then
    PR_SKIPPED_REASON="could not determine commit count against $base_ref"
    return 1
  fi

  if [[ "$count" == "0" ]]; then
    PR_SKIPPED_REASON="branch has no commits ahead of $base_ref"
    return 1
  fi

  return 0
}

create_or_update_pr() {
  local view_output branch head_owner title body create_error create_error_file

  branch="$(current_branch)"
  if PR_NUMBER="$(gh pr view "$branch" --repo "$BASE_REPO" --json number --jq .number 2>&1)"; then
    PR_URL="$(gh pr view "$branch" --repo "$BASE_REPO" --json url --jq .url)"
    log "PR already exists: $PR_URL"
  else
    view_output="$PR_NUMBER"
    PR_NUMBER=""
    if ! no_pr_found_error "$view_output"; then
      printf '%s\n' "$view_output" >&2
      die "Unable to check PR state"
    fi

    if ! branch_has_commits_ahead; then
      log "Skipping PR creation because $PR_SKIPPED_REASON"
      return
    fi

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

    log "Creating PR against $BASE_REPO"
    mkdir -p .claude/tmp
    create_error_file=".claude/tmp/pr-push-create-error.$$"
    if ! PR_URL="$(gh pr create \
      --repo "$BASE_REPO" \
      --head "${head_owner}:${branch}" \
      --base "$BASE_BRANCH" \
      --title "$title" \
      --body "$body" 2>"$create_error_file")"; then
      create_error="$(cat "$create_error_file")"
      rm -f "$create_error_file"
      if grep -qi 'fork collab' <<<"$create_error"; then
        log "Retrying PR creation without maintainer edits"
        PR_URL="$(gh pr create \
          --repo "$BASE_REPO" \
          --head "${head_owner}:${branch}" \
          --base "$BASE_BRANCH" \
          --title "$title" \
          --body "$body" \
          --no-maintainer-edit)"
      else
        printf '%s\n' "$create_error" >&2
        die "Unable to create PR"
      fi
    fi
    rm -f "$create_error_file"
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
    printf -- '- %s\n' "${COMMITTED_FILES[@]+"${COMMITTED_FILES[@]}"}"
  fi
  printf 'Ignored files:\n'
  if ((${#IGNORED_FILES[@]} == 0)); then
    printf -- '- none\n'
  else
    printf -- '- %s\n' "${IGNORED_FILES[@]+"${IGNORED_FILES[@]}"}"
  fi
  printf 'Automated check changes: %s\n' "$LINT_CHANGED"
  printf 'Checks: passed\n'
  printf 'Pushed remote: %s (%s)\n' "$PUSH_REMOTE" "$PUSH_OWNER_REPO"
  if [[ -n "$PR_URL" ]]; then
    printf 'PR: %s\n' "$PR_URL"
  elif [[ -n "$PR_SKIPPED_REASON" ]]; then
    printf 'PR creation skipped: %s\n' "$PR_SKIPPED_REASON"
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
