# Remember Learnings

Review the current session for errors, issues, snags, and hard-won knowledge, then update `AGENTS.md` with actionable learnings so future agent sessions run more smoothly.

**IMPORTANT:** This skill MUST complete autonomously. Do NOT ask for user confirmation.

## Instructions

1. **Analyze the session for learnings:**

   Review the entire conversation history and identify:
   - **Errors encountered:** Build failures, lint errors, type errors, test failures, runtime errors
   - **Snags and gotchas:** Things that took multiple attempts, unexpected behavior, tricky configurations
   - **Workflow friction:** Steps that were done in the wrong order, missing prerequisites, commands that needed special flags
   - **Architecture insights:** Patterns that weren't obvious, file locations that were hard to find, implicit conventions not documented

   Skip anything that is already well-documented in `CLAUDE.md` or `AGENTS.md`.

2. **Read the current AGENTS.md:**

   Read `AGENTS.md` at the repository root to understand what's already documented.

3. **Draft concise, actionable additions:**

   For each learning, write a short bullet point or section that would help a future agent avoid the same issue. Follow these rules:
   - Be specific and actionable (e.g., "Run `npm run build` before E2E tests" not "remember to build first")
   - Include the actual error message or symptom when relevant so agents can recognize the situation
   - Don't duplicate what's already in `AGENTS.md` or `CLAUDE.md`
   - Group related learnings under existing sections if appropriate, or create a new section
   - Keep it concise: each learning should be 1-3 lines max

4. **Update AGENTS.md:**

   Edit `AGENTS.md` to incorporate the new learnings. Add a `## Learnings` section at the bottom if one doesn't exist, or append to the existing `## Learnings` section.

   If there are no new learnings worth recording (i.e., everything went smoothly or all issues are already documented), skip the edit and report that no updates were needed.

5. **Stage the changes:**

   If `AGENTS.md` was modified:

   ```
   git add AGENTS.md
   ```

6. **Summarize:**
   - List the learnings that were added (or state that none were needed)
   - Confirm whether `AGENTS.md` was staged for commit
