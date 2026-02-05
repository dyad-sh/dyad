# PR Rebase

Rebase the current branch on the latest upstream changes, resolve conflicts, and push.

## Instructions

1. **Determine the git remote setup:**

   ```
   git remote -v
   git branch -vv
   ```

   In GitHub Actions for cross-repo PRs:
   - `origin` points to the **head repo** (fork) - this is where you push
   - `upstream` points to the **base repo** - this is what you rebase onto

   For same-repo PRs, `origin` points to the main repo and there may be no `upstream`.

2. **Fetch the latest changes:**

   ```
   git fetch --all
   ```

3. **Rebase onto the base branch:**

   Use `upstream/main` if the `upstream` remote exists (cross-repo PR), otherwise use `origin/main`:

   ```
   # Check if upstream remote exists
   git remote get-url upstream 2>/dev/null && git rebase upstream/main || git rebase origin/main
   ```

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
