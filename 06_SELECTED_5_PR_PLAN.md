# 06_SELECTED_5_PR_PLAN.md — Dyad Selected 5-PR Plan

## Selected PRs

| #   | Candidate ID | Title                                                                     | Type  | Risk | Size | Rationale                              |
| --- | ------------ | ------------------------------------------------------------------------- | ----- | ---- | ---- | -------------------------------------- |
| 1   | D-01         | docs: create CLAUDE.md with hard-PR campaign agent instructions           | docs  | LOW  | ~100 | Audit finding, helps agent context     |
| 2   | D-02         | test: add test to validate all prompt guide files parse as valid Markdown | test  | LOW  | ~60  | Audit finding, regression test         |
| 3   | D-08         | docs: clarify setup requirements in README                                | docs  | LOW  | ~40  | Audit finding, clarifies onboarding    |
| 4   | D-10         | chore: add migration validation to CI                                     | chore | LOW  | ~40  | Audit finding, CI improvement          |
| 5   | D-06         | fix: improve error for database connection failures                       | fix   | LOW  | ~40  | Issue #3285, error message improvement |

---

## PR #1: D-01 — docs: create CLAUDE.md with hard-PR campaign agent instructions

**Linked Issue:** none
**Source:** quality audit
**Target Files:** CLAUDE.md (new file)

### Problem

No CLAUDE.md for agent context; AGENTS.md is contributor-focused, not agent-execution-focused.

### Solution

Create CLAUDE.md with:

- Project overview (Electron desktop app, local AI app builder)
- Tech stack summary
- Key rules (electron-ipc, dyad-errors, local-agent-tools, etc.)
- Contribution workflow
- Test commands (npm run lint, npm run fmt, npm run ts, npm run test)

---

## PR #2: D-02 — test: add test to validate all prompt guide files parse as valid Markdown

**Linked Issue:** none
**Source:** quality audit
**Target Files:** `src/prompts/guides/` validation test

### Problem

Prompt guide files may be invalid Markdown or missing frontmatter; no test validates this.

### Solution

Add test that:

1. Reads all prompt guide files from `src/prompts/guides/`
2. Verifies each parses as valid Markdown
3. Checks required frontmatter fields (title, etc.)

---

## PR #3: D-08 — docs: clarify setup requirements in README

**Linked Issue:** none
**Source:** quality audit
**Target Files:** README.md

### Problem

README doesn't clearly state Node >=24 <26 requirement.

### Solution

Add clear Node version requirement section to README.

---

## PR #4: D-10 — chore: add migration validation to CI

**Linked Issue:** none
**Source:** quality audit
**Target Files:** `.github/workflows/ci.yml`

### Problem

`npm run db:generate` is manual; CI doesn't verify migrations are up-to-date with schema.

### Solution

Add CI step that checks migrations are generated and up-to-date.

---

## PR #5: D-06 — fix: improve error for database connection failures

**Linked Issue:** #3285
**Source:** issue triage
**Target Files:** Database connection handling code

### Problem

"Database connection is not open" error is unclear.

### Solution

Add context to database connection error messages to help debugging.
