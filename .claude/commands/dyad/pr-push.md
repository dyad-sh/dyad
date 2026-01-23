# PR Push

Commit any uncommitted changes, run lint checks, fix any issues, and push the current branch.

## Instructions

1. **Check for uncommitted changes:**

   Run `git status` to check for any uncommitted changes (staged, unstaged, or untracked files).

   If there are uncommitted changes:

   - Identify files that should NOT be committed (e.g., `.env`, `.env.*`, `credentials.*`, `*.secret`, `*.key`, `*.pem`, `.DS_Store`, `node_modules/`, `*.log`, temporary files, or anything that looks like it contains secrets or personal configuration)
   - Stage and commit all OTHER files with a descriptive commit message summarizing the changes
   - Keep track of any files you ignored so you can report them at the end

   If there are no uncommitted changes, proceed to the next step.

2. **Run lint checks:**

   Run the `/dyad:lint` skill to ensure the code passes all pre-commit checks. Fix any issues that arise.

3. **If lint made changes, amend the last commit:**

   If the lint skill made any changes, stage and amend them into the last commit:

   ```
   git add -A
   git commit --amend --no-edit
   ```

4. **Push the branch:**

   ```
   git push --force-with-lease
   ```

   Note: `--force-with-lease` is used because the commit may have been amended. It's safer than `--force` as it will fail if someone else has pushed to the branch.

5. **Summarize the results:**

   - Report any uncommitted changes that were committed in step 1
   - Report any files that were IGNORED and not committed (if any), explaining why they were skipped
   - Report any lint fixes that were applied
   - Confirm the branch has been pushed
