# Remember Learnings

Review the current session for errors, issues, snags, and hard-won knowledge, then update `AGENTS.md` with actionable learnings so future agent sessions run more smoothly.

**IMPORTANT:** This skill MUST complete autonomously. Do NOT ask for user confirmation.

## File relationship

- **`CLAUDE.md`** contains project-wide instructions, setup guides, and conventions for all contributors (human and agent). It is the authoritative source of truth and is manually curated.
- **`AGENTS.md`** contains agent-specific operational knowledge — tips, gotchas, and hard-won insights that help agents avoid repeating mistakes. It supplements `CLAUDE.md` but should never duplicate it.

Learnings should only go into `AGENTS.md`. If a learning is important enough to be a project-wide convention, flag it in the summary so a human can promote it to `CLAUDE.md`.

## Instructions

1. **Analyze the session for learnings:**

   Review the entire conversation history and identify:
   - **Errors encountered:** Build failures, lint errors, type errors, test failures, runtime errors
   - **Snags and gotchas:** Things that took multiple attempts, unexpected behavior, tricky configurations
   - **Workflow friction:** Steps that were done in the wrong order, missing prerequisites, commands that needed special flags
   - **Architecture insights:** Patterns that weren't obvious, file locations that were hard to find, implicit conventions not documented

   Skip anything that is already well-documented in `CLAUDE.md` or `AGENTS.md`.

2. **Read existing documentation:**

   Read both `CLAUDE.md` and `AGENTS.md` at the repository root to understand what's already documented and avoid duplication.

3. **Draft concise, actionable additions:**

   For each learning, write a short bullet point or section that would help a future agent avoid the same issue. Follow these rules:
   - Be specific and actionable (e.g., "Run `npm run build` before E2E tests" not "remember to build first")
   - Include the actual error message or symptom when relevant so agents can recognize the situation
   - Don't duplicate what's already in `AGENTS.md` or `CLAUDE.md`
   - Group related learnings under existing sections if appropriate, or create a new section
   - Keep it concise: each learning should be 1-3 lines max
   - **Limit to at most 5 learnings per session** — focus on the most impactful insights
   - If a new learning overlaps with or supersedes an existing one, consolidate them into a single entry rather than appending

4. **Update AGENTS.md:**

   Edit `AGENTS.md` to incorporate the new learnings. Add a `## Learnings` section at the bottom if one doesn't exist, or append to the existing `## Learnings` section.

   If there are no new learnings worth recording (i.e., everything went smoothly or all issues are already documented), skip the edit and report that no updates were needed.

   **Maintenance:** When adding new learnings, review the existing `## Learnings` section and remove any entries that are:
   - Now covered by `CLAUDE.md` (promoted to project-wide docs)
   - Obsolete due to codebase changes
   - Duplicated by or subsumed by a newer, more complete learning

5. **Stage the changes:**

   If `AGENTS.md` was modified:

   ```
   git add AGENTS.md
   ```

6. **Summarize:**
   - List the learnings that were added (or state that none were needed)
   - Confirm whether `AGENTS.md` was staged for commit
