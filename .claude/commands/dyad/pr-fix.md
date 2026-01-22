# PR Fix

Address all outstanding issues on a GitHub Pull Request by handling both review comments and failing CI checks.

## Arguments

- `$ARGUMENTS`: Optional PR number or URL. If not provided, uses the current branch's PR.

## Instructions

This is a meta-skill that orchestrates two sub-skills to comprehensively fix PR issues.

1. **Run `/dyad:pr-fix:comments`** to handle all unresolved review comments:

   - Address valid code review concerns
   - Resolve invalid concerns with explanations
   - Flag ambiguous issues for human attention

2. **Run `/dyad:pr-fix:actions`** to handle failing CI checks:

   - Fix failing tests (unit and E2E)
   - Update snapshots if needed
   - Ensure all checks pass

3. **Summary:**
   After both sub-skills complete, provide a consolidated summary of:
   - Review comments addressed, resolved, or flagged
   - CI checks that were fixed
   - Any remaining issues requiring human attention
