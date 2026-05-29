# 07_INITIAL_2_PR_PLAN.md — Dyad Initial 2 PR Plan

## Initial PR Selection

| #   | Candidate ID | Title                                                                     | Risk | Size | Rationale                     |
| --- | ------------ | ------------------------------------------------------------------------- | ---- | ---- | ----------------------------- |
| 1   | D-01         | docs: create CLAUDE.md with hard-PR campaign agent instructions           | LOW  | ~100 | Clear value for agent context |
| 2   | D-02         | test: add test to validate all prompt guide files parse as valid Markdown | LOW  | ~60  | Regression test, well-scoped  |

**Why not others:**

- D-03, D-09: MED risk, Windows path handling
- D-04, D-05: need E2E setup to validate
- D-06: error message improvement but less clear value than D-01/D-02
- D-08: lower priority than D-01
- D-10: CI change but less impactful than D-01/D-02

---

## PR #1 (Initial): D-01 — docs: create CLAUDE.md with hard-PR campaign agent instructions

**Branch:** `contrib/dyad/docs-claude-md`
**Linked Issue:** none
**Source:** quality audit
**Target Files:** CLAUDE.md (new file)

### Why This Is An Initial PR

- **Clear value** — helps any AI agent working on the repo
- **No behavior change** — pure documentation
- **Low effort** — straightforward writeup
- **Safe** — Electron app, docs-only is lowest risk

### Implementation Plan

1. Read AGENTS.md to understand what's already documented
2. Read key rules files for context
3. Create CLAUDE.md covering: overview, stack, rules, commands

### Test Plan

- Verify CLAUDE.md is valid Markdown
- Check it loads correctly in agent context

### Risk

- **LOW** — docs only

---

## PR #2 (Initial): D-02 — test: add test to validate all prompt guide files parse as valid Markdown

**Branch:** `contrib/dyad/test-prompt-guide-validation`
**Linked Issue:** none
**Source:** quality audit
**Target Files:** New test file in `src/prompts/guides/`

### Why This Is An Initial PR

- **Clear value** — catches invalid prompt guides before they cause issues
- **Test-only change** — no production behavior modification
- **Well-scoped** — focused on Markdown/frontmatter validation
- **Low risk** — even imperfect test doesn't break anything

### Implementation Plan

1. Read existing prompt guide files to understand format
2. Read existing test file (`filter_guide_by_framework.test.ts`)
3. Create validation test
4. Run test to verify it works

### Test Plan

- Run new test, verify it passes on valid guides
- (Cannot easily test failure case without creating invalid guide)

### Risk

- **LOW** — test only

### Fallback Candidate

D-10 (chore: add migration validation to CI)

---

## Branch Queue

| Candidate ID | Branch                                    | Title                             | Tests Run | Risk | Ready For PR | Notes          |
| ------------ | ----------------------------------------- | --------------------------------- | --------- | ---- | ------------ | -------------- |
| D-01         | contrib/dyad/docs-claude-md               | docs: create CLAUDE.md            | NA (docs) | LOW  | NO           | Must implement |
| D-02         | contrib/dyad/test-prompt-guide-validation | test: validate prompt guide files | NO        | LOW  | NO           | Must implement |

---

## Remaining 3 PRs (not yet opened)

| PR # | Candidate ID | Title                                               | Status  |
| ---- | ------------ | --------------------------------------------------- | ------- |
| 3    | D-08         | docs: clarify setup requirements in README          | Planned |
| 4    | D-10         | chore: add migration validation to CI               | Planned |
| 5    | D-06         | fix: improve error for database connection failures | Planned |
