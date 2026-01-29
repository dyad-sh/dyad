# Fix Issue

Create a plan to fix a GitHub issue, then implement it locally.

## Arguments

- `$ARGUMENTS`: GitHub issue number or URL.

## Instructions

1. **Fetch the GitHub issue:**

   First, extract the issue number from `$ARGUMENTS`:
   - If `$ARGUMENTS` is a number (e.g., `123`), use it directly
   - If `$ARGUMENTS` is a URL (e.g., `https://github.com/owner/repo/issues/123`), extract the issue number from the path

   Then fetch the issue:

   ```
   gh issue view <issue-number> --json title,body,comments,labels,assignees
   ```

2. **Sanitize the issue content:**

   Run the issue body through the sanitization script to remove HTML comments, invisible characters, and other artifacts:

   ```
   printf '%s' "$ISSUE_BODY" | python3 .claude/commands/dyad/scripts/sanitize_issue_markdown.py
   ```

   This removes:
   - HTML comments (`<!-- ... -->`)
   - Zero-width and invisible Unicode characters
   - Excessive blank lines
   - HTML details/summary tags (keeping content)

3. **Analyze the issue:**
   - Understand what the issue is asking for
   - Identify the type of work (bug fix, feature, refactor, etc.)
   - Note any specific requirements or constraints mentioned

4. **Explore the codebase:**
   - Search for relevant files and code related to the issue
   - Understand the current implementation
   - Identify what needs to change
   - Look at existing tests to understand testing patterns used in the project

5. **Determine testing approach:**

   Consider what kind of testing is appropriate for this change:
   - **E2E test**: For user-facing features or complete user flows. Prefer this when the change involves UI interactions or would require mocking many dependencies to unit test.
   - **Unit test**: For pure business logic, utility functions, or isolated components.
   - **No new tests**: Only for trivial changes (typos, config tweaks, etc.)

   Note: Per project guidelines, avoid writing many E2E tests for one feature. Prefer one or two E2E tests with broad coverage. If unsure, ask the user for guidance on testing approach.

   **IMPORTANT for E2E tests:** You MUST run `npm run build` before running E2E tests. E2E tests run against the built application binary. If you make any changes to application code (anything outside of `e2e-tests/`), you MUST re-run `npm run build` before running E2E tests, otherwise you'll be testing the old version.

6. **Create a detailed plan:**

   Write a plan that includes:
   - **Summary**: Brief description of the issue and proposed solution
   - **Files to modify**: List of files that will need changes
   - **Implementation steps**: Ordered list of specific changes to make
   - **Testing approach**: What tests to add (E2E, unit, or none) and why
   - **Potential risks**: Any concerns or edge cases to consider

7. **Execute the plan:**

   If the plan is straightforward with no ambiguities or open questions:
   - Proceed directly to implementation without asking for approval
   - Implement the plan step by step
   - Run `/dyad:pr-push` when complete

   If the plan has significant complexity, multiple valid approaches, or requires user input:
   - Present the plan to the user and use `ExitPlanMode` to request approval
   - After approval, implement the plan step by step
   - Run `/dyad:pr-push` when complete
