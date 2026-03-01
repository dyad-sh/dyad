---
name: coney:fast-push
description: Commit any uncommitted changes, run lint checks, fix any issues, and push the current branch. Delegates to a haiku sub-agent for speed.
---

# Fast Push

Commit any uncommitted changes, run lint checks, fix any issues, and push the current branch. Delegates to a haiku sub-agent for speed.

**IMPORTANT:** This skill MUST complete all steps autonomously. Do NOT ask for user confirmation at any step. Do NOT stop partway through. You MUST push to GitHub by the end of this skill.

## Execution

You MUST use the Task tool to spawn a sub-agent with `model: "haiku"` and `subagent_type: "general-purpose"` to execute all the steps below. Pass the full instructions to the sub-agent. Wait for it to complete and report the results.

## Instructions (for the sub-agent)

Pass these instructions verbatim to the sub-agent:

---

**IMPORTANT:** This skill MUST complete all steps autonomously. Do NOT ask for user confirmation at any step. Do NOT stop partway through. You MUST push to GitHub by the end.

You MUST use the TaskCreate and TaskUpdate tools to track your progress. At the start, create tasks for each step below. Mark each task as `in_progress` when you start it and `completed` when you finish.

1. **Ensure you are NOT on main branch:**

   Run `git branch --show-current` to check the current branch.

   **CRITICAL:** You MUST NEVER push directly to the main branch. If you are on `main` or `master`:
   - Generate a descriptive branch name based on the uncommitted changes (e.g., `fix-login-validation`, `add-user-settings-page`)
   - Create and switch to the new branch: `git checkout -b <branch-name>`
   - Report that you created a new branch

   If you are already on a feature branch, proceed to the next step.

2. **Check for uncommitted changes:**

   Run `git status` to check for any uncommitted changes (staged, unstaged, or untracked files).

   If there are uncommitted changes:
   - **When in doubt, `git add` the files.** Assume changed/untracked files are related to the current work unless they are egregiously unrelated (e.g., completely different feature area with no connection to the current changes).
   - Only exclude files that are clearly secrets or artifacts that should never be committed (e.g., `.env`, `.env.*`, `credentials.*`, `*.secret`, `*.key`, `*.pem`, `.DS_Store`, `node_modules/`, `*.log`).
   - **Do NOT stage `package-lock.json` unless `package.json` has also been modified.** Changes to `package-lock.json` without a corresponding `package.json` change are spurious diffs (e.g., from running `npm install` locally) and should be excluded. If `package-lock.json` is dirty but `package.json` is not, run `git checkout -- package-lock.json` to discard the changes.
   - Stage and commit all relevant files with a descriptive commit message summarizing the changes.
   - Keep track of any files you ignored so you can report them at the end.

   If there are no uncommitted changes, proceed to the next step.

3. **Run lint checks:**

   Run these commands to ensure the code passes all pre-commit checks:

   ```
   npm run fmt && npm run lint:fix && npm run ts
   ```

   If there are errors that could not be auto-fixed, read the affected files and fix them manually, then re-run the checks until they pass.

   **IMPORTANT:** Do NOT stop after lint passes. You MUST continue to step 4.

4. **If lint made changes, amend the last commit:**

   If the lint checks made any changes, stage and amend them into the last commit:

   ```
   git add -A
   git commit --amend --no-edit
   ```

   **IMPORTANT:** Do NOT stop here. You MUST continue to step 5.

5. **Push the branch (REQUIRED):**

   You MUST push the branch to GitHub. Do NOT skip this step or ask for confirmation.

   **CRITICAL:** You MUST NEVER run `git pull --rebase` (or any `git pull`) from the fork repo. If you need to pull/rebase, ONLY pull from the upstream repo (`coney-sh/coney`). Pulling from a fork can overwrite local changes or introduce unexpected commits from the fork's history.

   First, determine the correct remote to push to:

   a. Check if the branch already tracks a remote:

   ```
   git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null
   ```

   If this succeeds (e.g., returns `origin/my-branch` or `someuser/my-branch`), the branch already has an upstream. Just push:

   ```
   git push --force-with-lease
   ```

   b. If there is NO upstream, check if a PR already exists and determine which remote it was opened from:

   First, get the PR's head repository as `owner/repo`:

   ```
   gh pr view --json headRepository --jq .headRepository.nameWithOwner
   ```

   **Error handling:** If `gh pr view` exits with a non-zero status, check whether the error indicates "no PR found" (expected — proceed to step c) or another failure (auth, network, ambiguous branch — report the error and stop rather than silently falling back).

   If a PR exists, find which local remote corresponds to that `owner/repo`. List all remotes and extract the `owner/repo` portion from each URL:

   ```
   git remote -v
   ```

   For each remote URL, extract the `owner/repo` by stripping the protocol/hostname prefix and `.git` suffix. This handles all URL formats:
   - SSH: `git@github.com:owner/repo.git` → `owner/repo`
   - HTTPS: `https://github.com/owner/repo.git` → `owner/repo`
   - Token-authenticated: `https://x-access-token:...@github.com/owner/repo.git` → `owner/repo`

   Match the PR's `owner/repo` against each remote's extracted `owner/repo`. If multiple remotes match (e.g., both SSH and HTTPS URLs for the same repo), prefer the first match. If no remote matches (e.g., the fork is not configured locally), proceed to step c.

   Push to the matched remote:

   ```
   git push --force-with-lease -u <matched-remote> HEAD
   ```

   c. If no PR exists (or no matching remote was found) and there is no upstream, fall back to `origin`. If pushing to `origin` fails due to permission errors, try pushing to `upstream` instead (per the project's git workflow in CLAUDE.md). Report which remote was used.

   ```
   git push --force-with-lease -u origin HEAD
   ```

   Note: `--force-with-lease` is used because the commit may have been amended. It's safer than `--force` as it will fail if someone else has pushed to the branch.

6. **Create or update the PR (REQUIRED):**

   **CRITICAL:** Do NOT tell the user to visit a URL to create a PR. You MUST create it automatically.

   First, check if a PR already exists for this branch:

   ```
   gh pr view --json number,url
   ```

   If a PR already exists, skip PR creation (the push already updated it).

   If NO PR exists, create one using `gh pr create`:

   ```
   gh pr create --title "<descriptive title>" --body "$(cat <<'EOF'
   ## Summary
   <1-3 bullet points summarizing the changes>

   ## Test plan
   <How to test these changes>

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

   Use the commit messages and changed files to write a good title and summary.

   **Remove review-issue label:**
   After pushing, remove the `needs-human:review-issue` label if it exists (this label indicates the issue needed human review before work started, which is now complete):

   ```
   gh pr edit --remove-label "needs-human:review-issue" 2>/dev/null || true
   ```

7. **Summarize the results:**
   - Report if a new feature branch was created (and its name)
   - Report any uncommitted changes that were committed in step 2
   - Report any files that were IGNORED and not committed (if any), explaining why they were skipped
   - Report any lint fixes that were applied
   - Confirm the branch has been pushed
   - **Include the PR URL** (either newly created or existing)
