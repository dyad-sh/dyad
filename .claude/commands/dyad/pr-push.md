# PR Push

Commit any uncommitted changes, run lint checks, fix any issues, and push the current branch.

**IMPORTANT:** This skill MUST complete all steps autonomously. Do NOT ask for user confirmation at any step. Do NOT stop partway through. You MUST push to GitHub by the end of this skill.

## Task Tracking

**You MUST use the TaskCreate and TaskUpdate tools to track your progress.** At the start, create tasks for each step below. Mark each task as `in_progress` when you start it and `completed` when you finish. This ensures you complete ALL steps.

## Instructions

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
   - Identify files that should NOT be committed (e.g., `.env`, `.env.*`, `credentials.*`, `*.secret`, `*.key`, `*.pem`, `.DS_Store`, `node_modules/`, `*.log`, temporary files, or anything that looks like it contains secrets or personal configuration)
   - Stage and commit all OTHER files with a descriptive commit message summarizing the changes
   - Keep track of any files you ignored so you can report them at the end

   If there are no uncommitted changes, proceed to the next step.

3. **Run lint checks:**

   Run these commands to ensure the code passes all pre-commit checks:

   ```
   npm run fmt && npm run lint:fix && npm run ts
   ```

   If there are errors that could not be auto-fixed, read the affected files and fix them manually, then re-run the checks until they pass.

   **IMPORTANT:** Do NOT stop after lint passes. You MUST continue to step 4.

4. **Run tests:**

   Run the test suite to ensure nothing is broken:

   ```
   npm test
   ```

   If any tests fail, fix them before proceeding. Do NOT skip failing tests.

   **IMPORTANT:** Do NOT stop after tests pass. You MUST continue to step 5.

5. **If lint made changes, amend the last commit:**

   If the lint checks made any changes, stage and amend them into the last commit:

   ```
   git add -A
   git commit --amend --no-edit
   ```

   **IMPORTANT:** Do NOT stop here. You MUST continue to step 6 to push.

6. **Push the branch (REQUIRED):**

   You MUST push the branch to GitHub. Do NOT skip this step or ask for confirmation.

   ```
   git push --force-with-lease
   ```

   If the branch has no upstream, set one:

   ```
   git push --force-with-lease -u origin HEAD
   ```

   Note: `--force-with-lease` is used because the commit may have been amended. It's safer than `--force` as it will fail if someone else has pushed to the branch.

7. **Create or update the PR (REQUIRED):**

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

   **Add labels for non-trivial PRs:**
   After creating or verifying the PR exists, assess whether the changes are non-trivial:
   - Non-trivial = more than simple typo fixes, formatting, or config changes
   - Non-trivial = any code logic changes, new features, bug fixes, refactoring

   For non-trivial PRs, add the `cc:request` label to request code review:

   ```
   gh pr edit --add-label "cc:request"
   ```

8. **Summarize the results:**
   - Report if a new feature branch was created (and its name)
   - Report any uncommitted changes that were committed in step 2
   - Report any files that were IGNORED and not committed (if any), explaining why they were skipped
   - Report any lint fixes that were applied
   - Confirm tests passed
   - Confirm the branch has been pushed
   - **Include the PR URL** (either newly created or existing)
