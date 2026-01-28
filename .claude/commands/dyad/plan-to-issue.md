# Plan to Issue

Create a plan collaboratively with the user, then convert the approved plan into a GitHub issue.

## Arguments

- `$ARGUMENTS`: Brief description of what you want to plan (e.g., "add dark mode support", "refactor authentication system")

## Instructions

1. **Enter plan mode:**

   Use `EnterPlanMode` to begin the planning process. Explore the codebase to understand the current implementation and design an approach for: `$ARGUMENTS`

2. **Create a comprehensive plan:**

   Your plan should include:
   - **Summary**: Brief description of the goal
   - **Current state**: What exists today (based on codebase exploration)
   - **Proposed changes**: What needs to be implemented
   - **Files to modify**: List of files that will need changes
   - **Implementation steps**: Ordered list of specific tasks
   - **Testing approach**: What tests should be added
   - **Open questions**: Any decisions that need user input

3. **Iterate with the user:**

   Use `ExitPlanMode` to present your plan for approval. The user may:
   - Approve the plan as-is
   - Request modifications
   - Ask clarifying questions

   Continue iterating until the user approves the plan.

4. **Create the GitHub issue:**

   Once the plan is approved, create a GitHub issue using `gh issue create`:

   ```
   gh issue create --title "<concise title>" --body "$(cat <<'EOF'
   ## Summary
   <1-2 sentence description of the goal>

   ## Background
   <Current state and why this change is needed>

   ## Implementation Plan

   ### Files to Modify
   - `path/to/file1.ts` - <what changes>
   - `path/to/file2.ts` - <what changes>

   ### Tasks
   - [ ] <Task 1>
   - [ ] <Task 2>
   - [ ] <Task 3>
   ...

   ### Testing
   - [ ] <Test requirement 1>
   - [ ] <Test requirement 2>

   ## Notes
   <Any additional context, constraints, or open questions>

   ---
   *This issue was created from a planning session with Claude Code.*
   EOF
   )"
   ```

5. **Report the result:**

   Provide the user with:
   - The issue URL
   - A brief confirmation of what was created
