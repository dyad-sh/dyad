---
name: dyad:pr-fix:ci
description: Diagnose and fix failing CI checks on a pull request from its latest GitHub Actions CI run. Use when PR CI has E2E/Playwright failures, macOS or Windows unit-test failures, or presubmit/type/build failures; analyzes the exact run logs and artifacts, invokes dyad:deflake-e2e-from-run for E2E failures, reproduces targeted unit tests locally, and publishes the fixes.
---

# PR Fix: CI

Fix failures from the latest `CI` workflow run for a pull request. Base the diagnosis on that run's logs and artifacts, not on a fresh local full-suite run.

## Arguments

- `$ARGUMENTS`: Optional PR number or URL. If omitted, use the current branch's PR.

## Workflow

1. Track the phases below with the available task-tracking tool.
2. Resolve the PR and record its repository, number, head SHA, head repository, and head ref. Check out the PR head before editing. Stop if it cannot be checked out or pushed safely.
3. Find the newest `CI` workflow run for the PR's current head SHA:

   ```sh
   gh run list -R dyad-sh/dyad --workflow CI --commit <HEAD_SHA> \
     --json databaseId,url,status,conclusion,createdAt,headSha --limit 10
   ```

   Select the newest run whose `headSha` exactly matches. If it is still running, wait for completion. Keep its URL for the final summary.

4. Enumerate every job and its failed step:

   ```sh
   gh api repos/dyad-sh/dyad/actions/runs/<RUN_ID>/jobs --paginate \
     --jq '.jobs[] | {id,name,status,conclusion,failed_steps:[.steps[] | select(.conclusion == "failure") | .name]}'
   ```

   Diagnose setup, lint, formatting, type-check, and build failures directly from the job log and reproduce them with the repository-supported command before fixing them.

## Unit tests on macOS and Windows

Inspect both `unit-tests-macos` and `unit-tests-windows`, even when only one failed. This distinguishes a shared failure from an OS-specific one.

1. Download each job log separately:

   ```sh
   gh run view <RUN_ID> -R dyad-sh/dyad --job <JOB_ID> --log > <SCRATCH_DIR>/<OS>.log
   ```

2. Read the failing step and extract the exact test files, test names, assertion diffs, stack traces, exit codes, and platform-specific paths/errors. Do not infer a test failure merely from the job name: the macOS job also runs presubmit and type-checking.
3. Compare the two logs:
   - Same test and error on both platforms: investigate one shared root cause.
   - Different failures: treat them independently and fix both.
   - Windows-only: inspect path separators, shell behavior, file locking, case sensitivity, and platform guards. Do not weaken a valid assertion just because Windows cannot be run locally.
   - macOS-only: inspect native-module, Keychain, filesystem, and timing assumptions.
4. Reproduce the narrowest failing Vitest target with `npm test -- <test-file>`. For package-local suites, use that package's documented test command. Never run `npx tsc`, `tsc`, or Jest-only flags.
5. Fix the underlying behavior or deterministic test isolation. Add or adjust the narrowest regression test. Rerun every affected target locally. When a Windows-only behavior cannot be executed on macOS, add a platform-independent unit test for the relevant transformation and explicitly rely on the next Windows CI run for final confirmation.

## E2E failures

After unit-test fixes are ready, if any E2E shard or report-merge job failed, invoke `$dyad:deflake-e2e-from-run` with the selected run URL. Follow its artifact-first trace analysis, rebuild, and targeted E2E verification. Running it after unit fixes lets its required `$dyad:pr-push` publish the complete CI fix together.

If the failure is a snapshot mismatch, use `$dyad:e2e-rebase` when appropriate. Do not substitute raw job-log guessing for the merged Playwright report when an `html-report` artifact exists.

## Verify and publish

Before publishing, run the narrowest affected tests plus `npm run fmt`, `npm run lint`, and `npm run ts`. If E2E application code changed, run `npm run build` before targeted E2E tests.

If `$dyad:deflake-e2e-from-run` did not already publish the combined changes, invoke `$dyad:pr-push`. Report the source run URL, each failed job's concrete root cause and fix, commands run locally, and any platform result that still requires CI confirmation.
