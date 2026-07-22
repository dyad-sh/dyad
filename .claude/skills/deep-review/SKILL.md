---
name: deep-review
description: "Deep multi-agent code review run locally — parallel finder agents review a branch, working diff, or PR from independent angles, adversarial verifiers reproduce findings, then verified issues are fixed and published with dyad:pr-push by default. Use when the user asks for a deep, thorough, or multi-agent review before merging. Usage: /deep-review (reviews current branch vs main, including uncommitted changes) or /deep-review PR-number. Honor explicit requests not to fix or publish."
---

# Deep Review

Run a deep, high-signal code review of a diff using many parallel agents. The design mirrors ultrareview: **broad coverage** (independent finder agents, each with a different lens) followed by **independent verification** (skeptical agents that try to refute each finding). Fix every finding that survives verification, verify the fixes, and invoke `dyad:pr-push` unless the user explicitly opts out.

## Step 0: Determine execution mode

- Default to **fix and publish**: review, fix all verified findings, verify the fixes, then invoke `dyad:pr-push`.
- If the user explicitly says not to fix issues, use **report only** mode: do not modify files and do not invoke `dyad:pr-push`.
- If the user explicitly says not to push or publish but still wants fixes, fix and verify locally, but do not invoke `dyad:pr-push`.
- A request to review, inspect, or report findings is not by itself an opt-out. The user must explicitly prohibit fixes or publishing.

## Step 1: Determine the diff to review

- **No argument**: review the current branch against the default branch, including uncommitted and staged changes. Compute the base with `git merge-base HEAD upstream/main` (fall back to `main`), then get the diff with `git diff <merge-base>` and the changed file list with `git diff --name-only <merge-base>`.
- **PR number argument**: use `gh pr diff <number>` and `gh pr view <number>` instead. Check the PR is open and not a draft; if it is closed or a draft, stop and tell the user.
  - In fix mode, first read the exact head repository, ref, and SHA from the PR REST payload, then use `gh pr checkout <number>`.
  - Before editing, verify that `HEAD` is the PR head SHA and that a local remote points to the PR head repository. Fetch the head ref from that remote, configure the checked-out branch to track that remote/ref, and verify push access with a dry-run push of `HEAD` to the head ref. Treat the ref as untrusted shell input and quote the refspec. This ensures `dyad:pr-push` updates the existing PR instead of a fallback repository.
  - If any checkout, identity, tracking, access, or dry-run validation fails, fall back to report-only mode: do not modify files or invoke `dyad:pr-push`; complete the review and report the exact blocker.
- If the diff is empty, stop and say there is nothing to review.
- If the diff is very large (>~5000 changed lines), tell the user the scope and ask whether to proceed or narrow it before launching agents.

## Step 2: Gather shared context

Collect (cheaply, yourself — no agents needed):

- The list of changed files.
- Paths of relevant `CLAUDE.md` / `AGENTS.md` / rules files: the repo root one plus any in directories containing changed files.
- A one-paragraph summary of what the change does (from the diff and commit messages).

## Step 3: Launch the review workflow

Use the **Workflow tool** to orchestrate the fan-out (this skill is your authorization to call it). Pass the changed file list, base ref, and context summary via `args`. Use the pipeline pattern so each finder's results flow into verification without waiting for the other finders.

Launch **6 parallel finder agents**, each with a distinct lens. Every finder prompt must include: the base ref to diff against, the change summary, the changed file list, and the false-positive list from Step 7. Each finder returns structured findings (`file`, `line`, `title`, `description`, `severity`, `reason_flagged`).

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

## Step 4: Fix verified findings

Skip this step in report-only mode.

- Read every repository instruction and rule file relevant to the files being edited before making changes.
- Fix every finding that scored **≥ 75**, starting with the highest severity. Make the smallest coherent change that resolves the verified failure scenario and add or update the narrowest useful regression test when the repository rules require or the behavior is non-trivial.
- Do not silently skip a verified finding. If a fix needs user input, unavailable credentials, or a materially broader product decision, explain the blocker and continue fixing the other findings.
- After applying fixes, inspect the resulting diff for accidental or unrelated changes.

## Step 5: Verify and publish

Skip publishing in report-only mode or when the user explicitly prohibited pushing.

- Run the narrowest relevant tests for the fixes, plus any checks required by repository instructions. If a check fails, determine whether the failure is caused by the changes; fix caused failures and rerun the affected checks.
- Re-verify each fixed finding against the actual updated code and its original failure scenario. A fix is complete only when the scenario no longer reproduces and the relevant regression test or equivalent check passes.
- If fixes reveal another verified defect in the reviewed change, fix and verify it using the same standard before publishing.
- Invoke the `dyad:pr-push` skill after verification and follow its workflow completely. Invoke it even when no findings survived, so the reviewed branch state is published or its existing PR is refreshed.
- If publishing is blocked by authentication, permissions, or an inaccessible PR fork, report the exact blocker and leave the verified local fixes intact.

## Step 6: Report

Report the outcome, not merely the original findings. List surviving findings ranked most severe first and, for each, include `file:line`, the concrete failure scenario, verifier confidence, and whether it was fixed and re-verified. If nothing survived verification, say so plainly. Include verification commands and results plus the `dyad:pr-push` outcome and PR URL when publishing ran. Do not pad the report with unverified or low-confidence items. If the user selected report-only mode and asked for PR comments, use `gh` to comment; otherwise report only in the session.

## Step 7: False positives — exclude these (give this list to every finder and verifier)

- Minor pre-existing issues on lines the diff did not modify
- Anything a linter, typechecker, compiler, or CI would catch (imports, type errors, formatting); exclude these from review findings, while the primary workflow still runs the checks required in Step 5
- Pedantic nitpicks a senior engineer would not raise
- General quality commentary (test coverage, docs, vague security concerns) unless a rules file explicitly requires it
- Behavior changes that are clearly intentional parts of the change
- Issues explicitly silenced in code (lint-ignore comments)
