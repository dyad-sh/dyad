# Fix Issue

Create a plan to fix a GitHub issue, then send it to be worked on remotely after approval.

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

2. **Analyze the issue:**

   - Understand what the issue is asking for
   - Identify the type of work (bug fix, feature, refactor, etc.)
   - Note any specific requirements or constraints mentioned

3. **Explore the codebase:**

   - Search for relevant files and code related to the issue
   - Understand the current implementation
   - Identify what needs to change
   - Look at existing tests to understand testing patterns used in the project

4. **Determine testing approach:**

   Consider what kind of testing is appropriate for this change:

   - **E2E test**: For user-facing features or complete user flows. Prefer this when the change involves UI interactions or would require mocking many dependencies to unit test.
   - **Unit test**: For pure business logic, utility functions, or isolated components.
   - **No new tests**: Only for trivial changes (typos, config tweaks, etc.)

   Note: Per project guidelines, avoid writing many E2E tests for one feature. Prefer one or two E2E tests with broad coverage. If unsure, ask the user for guidance on testing approach.

5. **Create a detailed plan:**

   Write a plan that includes:

   - **Summary**: Brief description of the issue and proposed solution
   - **Files to modify**: List of files that will need changes
   - **Implementation steps**: Ordered list of specific changes to make
   - **Testing approach**: What tests to add (E2E, unit, or none) and why
   - **Potential risks**: Any concerns or edge cases to consider

6. **Request plan approval:**

   Present the plan to the user and use `ExitPlanMode` to request approval. The plan should be clear enough that it can be executed without further clarification.

7. **Ask how to proceed:**

   After the plan is approved, ask the user whether they want to:

   - **Continue locally**: Implement the plan in the current session
   - **Send to remote**: Push to a remote Claude session for implementation

8. **Execute based on user choice:**

   - If **local**: Proceed to implement the plan step by step, then run `/dyad:gh-push` when complete
   - If **remote**: Use `ExitPlanMode` with `pushToRemote: true` and share the remote session URL with the user
