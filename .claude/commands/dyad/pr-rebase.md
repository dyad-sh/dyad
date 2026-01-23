# PR Rebase

Rebase the current branch on the latest upstream changes, resolve conflicts, and push.

## Instructions

1. **Determine the base branch:**

   ```
   git remote -v
   git branch -vv
   ```

   Identify which remote and branch the current branch is tracking or should rebase onto (typically `main` or `master` from `upstream` or `origin`).

2. **Fetch the latest changes:**

   ```
   git fetch --all
   ```

3. **Rebase onto the base branch:**

   ```
   git rebase <remote>/<base-branch>
   ```

   For example: `git rebase upstream/main`

4. **If there are merge conflicts:**
   - Identify the conflicting files from the rebase output
   - Read each conflicting file and understand both versions of the changes
   - Resolve the conflicts by editing the files to combine changes appropriately
   - Stage the resolved files:

     ```
     git add <resolved-file>
     ```

   - Continue the rebase:

     ```
     git rebase --continue
     ```

   - Repeat until all conflicts are resolved and the rebase completes

5. **Run lint and push:**

   Run the `/dyad:pr-push` skill to run lint checks, fix any issues, and push the rebased branch.

6. **Summarize the results:**
   - Report that the rebase was successful
   - List any conflicts that were resolved
   - Note any lint fixes that were applied
   - Confirm the branch has been pushed
