# GitHub Push

Run lint checks, fix any issues, and push the current branch.

## Instructions

1. **Run lint checks:**

   Run the `/dyad:lint` skill to ensure the code passes all pre-commit checks. Fix any issues that arise.

2. **If lint made changes, amend the last commit:**

   If the lint skill made any changes, stage and amend them into the last commit:

   ```
   git add -A
   git commit --amend --no-edit
   ```

3. **Push the branch:**

   ```
   git push --force-with-lease
   ```

   Note: `--force-with-lease` is used because the commit may have been amended. It's safer than `--force` as it will fail if someone else has pushed to the branch.

4. **Summarize the results:**

   - Report any lint fixes that were applied
   - Confirm the branch has been pushed
