# 05_PR_CANDIDATES.md — Dyad PR Candidates

## Candidate List

| ID   | Title                                                                     | Type  | Linked Issue | Source | Risk | Size | Merge | Selected |
| ---- | ------------------------------------------------------------------------- | ----- | ------------ | ------ | ---- | ---- | ----- | -------- |
| D-01 | docs: create CLAUDE.md with hard-PR campaign agent instructions           | docs  | none         | audit  | LOW  | ~100 | HIGH  |          |
| D-02 | test: add test to validate all prompt guide files parse as valid Markdown | test  | none         | audit  | LOW  | ~60  | HIGH  |          |
| D-03 | fix: handle Windows path with spaces in project setup                     | fix   | #3513        | issue  | MED  | ~80  | MED   |          |
| D-04 | docs: add troubleshooting section for common git sync failures            | docs  | #3338        | issue  | LOW  | ~60  | MED   |          |
| D-05 | test: add test for local git review and commit functionality              | test  | #3338        | issue  | LOW  | ~80  | MED   |          |
| D-06 | fix: improve error for database connection failures                       | fix   | #3285        | issue  | MED  | ~40  | MED   |          |
| D-07 | test: add regression test for TSC worker exit on Windows                  | test  | #3360        | issue  | LOW  | ~70  | MED   |          |
| D-08 | docs: clarify setup requirements in README                                | docs  | none         | audit  | LOW  | ~40  | HIGH  |          |
| D-09 | fix: handle pnpm not found on Windows path issues                         | fix   | #3379        | issue  | MED  | ~50  | MED   |          |
| D-10 | chore: add migration validation to CI                                     | chore | none         | audit  | LOW  | ~40  | HIGH  |          |

---

## D-01: docs: create CLAUDE.md with hard-PR campaign agent instructions

- **Linked Issue:** none
- **Source:** quality audit — no CLAUDE.md exists
- **Problem:** No CLAUDE.md for agent context; AGENTS.md is contributor-focused
- **Proposed Solution:** Create CLAUDE.md with: project overview, tech stack, key rules, contribution workflow, test commands
- **Target Files:** CLAUDE.md (new file)
- **Test Plan:** Verify CLAUDE.md loads in agent context
- **Risk:** LOW — docs only
- **Expected Diff:** ~100 lines
- **Merge Likelihood:** HIGH
- **Selected:** YES

---

## D-02: test: add test to validate all prompt guide files parse as valid Markdown

- **Linked Issue:** none
- **Source:** quality audit — no validation for prompt guide frontmatter
- **Problem:** Prompt guide files may be invalid Markdown or missing frontmatter; no test validates this
- **Proposed Solution:** Add test that reads all prompt guide files and verifies: valid Markdown, required frontmatter fields
- **Target Files:** `src/prompts/guides/` test or new validation test
- **Test Plan:** Run new test, verify it catches invalid guides
- **Risk:** LOW — test only
- **Expected Diff:** ~60 lines
- **Merge Likelihood:** HIGH
- **Selected:** YES

---

## D-03: fix: handle Windows path with spaces in project setup

- **Linked Issue:** #3513
- **Source:** issue triage — Windows project setup fails with spaces in user profile path
- **Problem:** Project setup on Windows fails when user profile path contains spaces
- **Proposed Solution:** Add path quoting/escaping in project setup code
- **Target Files:** Project setup code in src/
- **Test Plan:** Test on Windows with spaces in path
- **Risk:** MED — touches path handling logic
- **Expected Diff:** ~80 lines
- **Merge Likelihood:** MED
- **Selected:** NO

---

## D-04: docs: add troubleshooting section for common git sync failures

- **Linked Issue:** #3338
- **Source:** issue triage — local git Review & commit does not work
- **Problem:** Git sync failures have no troubleshooting section
- **Proposed Solution:** Add troubleshooting section to CONTRIBUTING.md for git sync issues
- **Target Files:** CONTRIBUTING.md
- **Test Plan:** Read and verify
- **Risk:** LOW — docs only
- **Expected Diff:** ~60 lines
- **Merge Likelihood:** MED
- **Selected:** NO

---

## D-05: test: add test for local git review and commit functionality

- **Linked Issue:** #3338
- **Source:** issue triage
- **Problem:** Local git review and commit does not work; no test coverage
- **Proposed Solution:** Add Playwright E2E test for local git review and commit flow
- **Target Files:** E2E tests directory
- **Test Plan:** Run E2E test, verify git review works
- **Risk:** LOW — test only
- **Expected Diff:** ~80 lines
- **Merge Likelihood:** MED
- **Selected:** NO

---

## D-06: fix: improve error for database connection failures

- **Linked Issue:** #3285
- **Source:** issue triage
- **Problem:** "Database connection is not open" error is unclear
- **Proposed Solution:** Add context to database connection error messages
- **Target Files:** Database connection handling code
- **Test Plan:** Trigger connection error, verify message is helpful
- **Risk:** LOW — error message only
- **Expected Diff:** ~40 lines
- **Merge Likelihood:** MED
- **Selected:** NO

---

## D-07: test: add regression test for TSC worker exit on Windows

- **Linked Issue:** #3360
- **Source:** issue triage
- **Problem:** TSC worker exits with code 1 on Windows; no test
- **Proposed Solution:** Add test to catch TSC worker exit issues
- **Target Files:** Workers test directory
- **Test Plan:** Run worker tests on Windows-like environment
- **Risk:** LOW — test only
- **Expected Diff:** ~70 lines
- **Merge Likelihood:** MED
- **Selected:** NO

---

## D-08: docs: clarify setup requirements in README

- **Linked Issue:** none
- **Source:** audit — README could clarify Node version requirement
- **Problem:** README doesn't clearly state Node >=24 <26 requirement
- **Proposed Solution:** Add clear Node version requirement in README
- **Target Files:** README.md
- **Test Plan:** Read and verify
- **Risk:** LOW — docs only
- **Expected Diff:** ~40 lines
- **Merge Likelihood:** HIGH
- **Selected:** NO

---

## D-09: fix: handle pnpm not found on Windows path issues

- **Linked Issue:** #3379
- **Source:** issue triage — pnpm command not found on Windows
- **Problem:** pnpm not in PATH on Windows; user gets unclear error
- **Proposed Solution:** Add pnpm installation check and helpful error message
- **Target Files:** Project setup/main process code
- **Test Plan:** Test with pnpm not in PATH
- **Risk:** MED — touches setup logic
- **Expected Diff:** ~50 lines
- **Merge Likelihood:** MED
- **Selected:** NO

---

## D-10: chore: add migration validation to CI

- **Linked Issue:** none
- **Source:** audit — no CI check for migration up-to-date
- **Problem:** `npm run db:generate` is manual; CI doesn't verify migrations are current
- **Proposed Solution:** Add CI step to verify migrations are up-to-date with schema
- **Target Files:** CI workflow file
- **Test Plan:** Run CI, verify migration check works
- **Risk:** LOW — CI only
- **Expected Diff:** ~40 lines
- **Merge Likelihood:** HIGH
- **Selected:** NO
