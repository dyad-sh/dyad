---
name: deep-review
description: Deep multi-agent code review run locally — a fleet of parallel finder agents reviews the diff from independent angles, then adversarial verifier agents reproduce each finding before it is reported. Local equivalent of /code-review ultra. Use when the user asks for a deep, thorough, or multi-agent review of their branch, working diff, or a PR before merging. Usage: /deep-review (reviews current branch vs main, including uncommitted changes) or /deep-review <PR-number>.
---

# Deep Review

Run a deep, high-signal code review of a diff using many parallel agents. The design mirrors ultrareview: **broad coverage** (independent finder agents, each with a different lens) followed by **independent verification** (skeptical agents that try to refute each finding). Only findings that survive verification are reported.

## Step 1: Determine the diff to review

- **No argument**: review the current branch against the default branch, including uncommitted and staged changes. Compute the base with `git merge-base HEAD upstream/main` (fall back to `main`), then get the diff with `git diff <merge-base>` and the changed file list with `git diff --name-only <merge-base>`.
- **PR number argument**: use `gh pr diff <number>` and `gh pr view <number>` instead. Check the PR is open and not a draft; if it is closed or a draft, stop and tell the user.
- If the diff is empty, stop and say there is nothing to review.
- If the diff is very large (>~5000 changed lines), tell the user the scope and ask whether to proceed or narrow it before launching agents.

## Step 2: Gather shared context

Collect (cheaply, yourself — no agents needed):

- The list of changed files.
- Paths of relevant `CLAUDE.md` / `AGENTS.md` / rules files: the repo root one plus any in directories containing changed files.
- A one-paragraph summary of what the change does (from the diff and commit messages).

## Step 3: Launch the review workflow

Use the **Workflow tool** to orchestrate the fan-out (this skill is your authorization to call it). Pass the changed file list, base ref, and context summary via `args`. Use the pipeline pattern so each finder's results flow into verification without waiting for the other finders.

Launch **6 parallel finder agents**, each with a distinct lens. Every finder prompt must include: the base ref to diff against, the change summary, the changed file list, and the false-positive list from Step 5. Each finder returns structured findings (`file`, `line`, `title`, `description`, `severity`, `reason_flagged`).

1. **Shallow diff scan** — read only the diff itself; flag obvious bugs in the changed lines. No extra context.
2. **Deep correctness** — read the full changed files and their callers/callees; flag logic errors, broken invariants, wrong edge-case handling, races, and API misuse.
3. **Historical context** — read `git log`/`git blame` for the modified code; flag changes that break something a past commit deliberately did (regressions, reverted fixes).
4. **Cross-file consistency** — check that renames, signature changes, config/schema changes, and new conventions are applied everywhere they must be (call sites, tests, docs, IPC/serialization boundaries).
5. **Error handling & data flow** — trace new/changed data flows end to end; flag unhandled rejections, swallowed errors, null/undefined paths, resource leaks, and missing cleanup.
6. **Project rules compliance** — audit the diff against the CLAUDE.md / rules files gathered in Step 2. Only flag violations the rules file explicitly calls out, and quote the rule.

After finders return, **dedupe** findings by file + line proximity + description similarity (plain code in the workflow script, not an agent).

Then for **each deduped finding**, launch a **verifier agent** prompted adversarially:

> Try to REFUTE this finding. Read the actual code (not just the diff), trace the execution path, and check whether the described failure can really happen on lines the PR modified. Score confidence 0–100: 0 = false positive or pre-existing issue; 25 = plausible but unverified; 50 = real but minor/rare nitpick; 75 = verified real, will be hit in practice; 100 = certainly real and frequent. Default low when uncertain.

Keep only findings scoring **≥ 75**. Verifiers return `{score, verified_explanation, suggested_fix}`.

If the Workflow tool is unavailable, do the same fan-out with parallel Agent tool calls (all finders in one message, then all verifiers in one message).

## Step 4: Report

Report the surviving findings ranked most severe first. For each: `file:line`, a one-sentence statement of the defect, the concrete failure scenario (inputs/state → wrong behavior), and the verifier's confidence. If nothing survived verification, say so plainly — do not pad the report with unverified or low-confidence items. Do not auto-fix anything; offer to fix on request. If reviewing a PR and the user asked for comments to be posted, use `gh` to comment; otherwise report only in the session.

## Step 5: False positives — exclude these (give this list to every finder and verifier)

- Minor pre-existing issues on lines the diff did not modify
- Anything a linter, typechecker, compiler, or CI would catch (imports, type errors, formatting); do not run builds or typechecks yourself
- Pedantic nitpicks a senior engineer would not raise
- General quality commentary (test coverage, docs, vague security concerns) unless a rules file explicitly requires it
- Behavior changes that are clearly intentional parts of the change
- Issues explicitly silenced in code (lint-ignore comments)
