# Remember Learnings

Review the current session for errors, issues, snags, and hard-won knowledge, then update the `rules/` files (or `AGENTS.md` if no suitable rule file exists) with actionable learnings so future agent sessions run more smoothly.

**IMPORTANT:** This skill MUST complete autonomously. Do NOT ask for user confirmation.

## File relationship

> **NOTE:** `CLAUDE.md` is a symlink to `AGENTS.md`. They are the same file. **ALL EDITS MUST BE MADE TO `AGENTS.md`**, never to `CLAUDE.md` directly.

- **`AGENTS.md`** is the top-level agent guide. It contains core setup instructions and a **rules index** table pointing to topic-specific files in `rules/`.
- **`rules/*.md`** contain topic-specific learnings and guidelines (e.g., `rules/e2e-testing.md`, `rules/electron-ipc.md`).

Learnings should go into the most relevant `rules/*.md` file. Only add to `AGENTS.md` directly if the learning doesn't fit any existing rule file and doesn't warrant a new one. If a learning is important enough to be a project-wide convention, flag it in the summary so a human can promote it to the project documentation.

## Instructions

1. **Analyze the session for learnings:**

   Review the entire conversation history and identify:
   - **Errors encountered:** Build failures, lint errors, type errors, test failures, runtime errors
   - **Snags and gotchas:** Things that took multiple attempts, unexpected behavior, tricky configurations
   - **Workflow friction:** Steps that were done in the wrong order, missing prerequisites, commands that needed special flags
   - **Architecture insights:** Patterns that weren't obvious, file locations that were hard to find, implicit conventions not documented

   Skip anything that is already well-documented in `AGENTS.md` or `rules/`.

2. **Read existing documentation:**

   Read `AGENTS.md` at the repository root to see the rules index, then read the relevant `rules/*.md` files to understand what's already documented and avoid duplication.

3. **Draft concise, actionable additions:**

   For each learning, write a short bullet point or section that would help a future agent avoid the same issue. Follow these rules:
   - Be specific and actionable (e.g., "Run `npm run build` before E2E tests" not "remember to build first")
   - Include the actual error message or symptom when relevant so agents can recognize the situation
   - Don't duplicate what's already in `AGENTS.md` or `rules/`
   - Keep it concise: each learning should be 1-3 lines max
   - **Limit to at most 5 learnings per session** — focus on the most impactful insights
   - If a new learning overlaps with or supersedes an existing one, consolidate them into a single entry rather than appending

4. **Update the appropriate file(s):**

   Place each learning in the most relevant location:

   a. **Existing `rules/*.md` file** — if the learning fits an existing topic (e.g., E2E testing tips go in `rules/e2e-testing.md`, IPC learnings go in `rules/electron-ipc.md`).

   b. **New `rules/*.md` file** — if the learning is substantial enough to warrant its own topic file. Use a descriptive kebab-case filename (e.g., `rules/tanstack-router.md`). If you create a new file, also update the rules index table in `AGENTS.md`.

   c. **`AGENTS.md` directly** — only for general learnings that don't fit any topic (rare).

   If there are no new learnings worth recording (i.e., everything went smoothly or all issues are already documented), skip the edit and report that no updates were needed.

   **Maintenance:** When adding new learnings, review the target file and remove any entries that are:
   - Obsolete due to codebase changes
   - Duplicated by or subsumed by a newer, more complete learning

5. **Stage the changes:**

   Stage any modified or created files:

   ```
   git add AGENTS.md rules/
   ```

6. **Summarize:**
   - List the learnings that were added (or state that none were needed)
   - Identify which files were modified or created
   - Confirm whether changes were staged for commit
