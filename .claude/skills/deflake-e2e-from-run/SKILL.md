---
name: dyad:deflake-e2e-from-run
description: Root-cause flaky or failing E2E tests from a specific CI run by downloading and analyzing the Playwright HTML report (traces, screenshots, errors). Use this when given a GitHub Actions run URL and asked to investigate failures. Diagnose from report artifacts first, then rebuild and rerun the affected E2E tests locally after making fixes.
---

# Deflake E2E Tests from a CI Run

Use this skill when the user points you at a specific failing CI run (e.g. `https://github.com/dyad-sh/dyad/actions/runs/<id>`) and asks you to root-cause the E2E failures. Unlike `deflake-e2e`, this skill starts by reading the already-recorded Playwright report from the run's artifacts, which is faster and gives you the _exact_ failure state CI saw. After making fixes, always rebuild and rerun the affected E2E tests locally before committing/pushing.

## Arguments

- `$ARGUMENTS`: The GitHub Actions run URL or run ID. If absent, ask the user.

## Phase 1 — Get the report

1. Extract `run_id` from the URL (`/actions/runs/<run_id>` or `/actions/runs/<run_id>/job/<job_id>`).
2. List artifacts and find the `html-report` (merged across shards):
   ```
   gh api repos/dyad-sh/dyad/actions/runs/<run_id>/artifacts --jq '.artifacts[] | {name, size_in_bytes}'
   ```
3. Download it into a scratch dir (use `-R dyad-sh/dyad` — `gh run download` does not auto-detect the repo from arbitrary cwd):
   ```
   mkdir -p /tmp/pw-report
   gh run download <run_id> -R dyad-sh/dyad -n html-report -D /tmp/pw-report
   ```
4. Confirm layout: `index.html`, `results.json`, `data/*.zip` (trace archives), `data/*.png` (screenshots), `data/*.markdown` (error-context files).

## Phase 2 — Enumerate failures

Use `jq` on `results.json`. The schema has `suites[].specs[]`, with each spec's `tests[].results[]` holding one result per attempt.

- Stats headline: `jq '.stats' results.json` → `{expected, skipped, unexpected, flaky}`.
- **Unexpected** (all attempts failed):
  ```
  jq '[.suites[].specs[]? | select(.ok == false) | {title, file,
      err: [.tests[].results[] | {status, error: .error.message}]}]' results.json
  ```
- **Flaky** (some attempt failed but final passed):
  ```
  jq '[.suites[].specs[]? | select(.tests[].status == "flaky") | {title, file}]' results.json
  ```

Group by error shape. If every failure shares the same locator / error ("element is not enabled", "locator.click timeout", etc.) you're probably looking at one root cause across multiple tests. Don't investigate them all — pick one representative trace.

## Phase 3 — Analyze a specific failure

1. Find the trace zip. The `attachments[].path` in `results.json` points at `all-blob-reports/resources/<hash>.zip` — those are **CI-side paths**, not local. The file actually lives at `/tmp/pw-report/data/<hash>.zip`. Match by hash, or grep the trace for the test title / spec file:
   ```
   for f in /tmp/pw-report/data/*.zip; do
     hit=$(unzip -p "$f" test.trace | grep -c "chat_tabs\.spec\.ts:68")
     [ "$hit" -gt 0 ] && echo "$f"
   done
   ```
2. Extract: `unzip -o <zip> -d /tmp/trace-extract`.
3. Read the step-by-step actions (`test.trace` is JSONL):
   ```python
   import json
   for line in open('/tmp/trace-extract/test.trace'):
       obj = json.loads(line)
       if obj.get('type') == 'before' and obj.get('class') == 'Test':
           print(round(obj['startTime']/1000, 2), obj.get('method'), obj.get('title','')[:200])
   ```
   Look for the last few actions before the timeout — that tells you _which call hung and what its locator resolved to_.
4. Correlate with app logs. Electron `console.log`/`console.error` lands in `stderr`/`stdout` trace events:
   ```python
   for line in open('/tmp/trace-extract/test.trace'):
       obj = json.loads(line)
       if obj.get('type') in ('stderr','stdout'):
           text = obj.get('text','')
           if 'proposal' in text or 'chatId' in text or 'stream' in text.lower():
               print(text[:300])
   ```
   IPC log lines like `(proposal_handlers) › IPC: get-proposal returned: …` reveal what state the backend was in at failure time — gold for race-condition root-causing.
5. View the failure screenshot. Trace resources are stored unhashed; PNG files in `/tmp/trace-extract/resources/` are screenshots. Resize before Read (Claude's image limit is ~1.5MB):
   ```
   sips -Z 800 /tmp/trace-extract/resources/<hash> --out /tmp/fail.png
   ```
   Then `Read /tmp/fail.png`. This is often the single most useful artifact — e.g. an "empty input, disabled Send button" screenshot is a dead giveaway for a fill() race.

## Phase 4 — Root-cause playbook

Common patterns and what they mean:

- **"element is not enabled" on a button after fill()** → React render race between URL/atom state updates and the editor's onChange. The fill runs, onChange writes under the _old_ key, next render clears the editor for the new context. Fix: wrap fill+click in `expect.toPass()` and assert editor content + button enabled before clicking. See `ChatActions.sendPrompt()`.
- **"locator.click timeout"** with multiple matching elements → stale component still in DOM during a transition. Fix: scope the locator tighter (`getChatInputContainer().locator(...)`) or add a visibility assertion on the stable target first.
- **Assertion flakes right after navigation** → atom/URL mismatch during a single render cycle. Either wait for a post-navigation signal (e.g. a data-loaded state) or wrap the assertion in `toPass` with a bounded timeout.
- **Different error on retry vs. first attempt** → test is mutating shared state. Look for missing teardown or cross-test singletons.

Prefer fixing the test over the app unless the race would actually bite a real user. A real user can't type at 2ms after clicking a button; Playwright can. A retry wrapper is the correct contract there.

## Phase 5 — Fix, verify, PR

1. Make the minimal change — usually in `e2e-tests/helpers/page-objects/` since many specs share the same helper.
2. `npm run fmt && npm run lint && npm run ts`.
3. Rebuild the app locally before running E2E. E2E tests run against the built app, so use the repository's standard build command:
   ```
   npm run build
   ```
   If the known Homebrew Python 3.14 `pyexpat` native rebuild issue occurs, rerun with:
   ```
   PYTHON=/usr/bin/python3 npm run build
   ```
4. Rerun the affected E2E test files locally after the rebuild. Prefer the narrowest set that covers the CI failures you fixed:
   ```
   PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<affected-file>.spec.ts
   ```
   If the fix is in a shared helper that affected several failing specs, run all representative affected specs in one command or separate commands.
5. As the final step, call `/dyad:pr-push`. Do not commit, push, or create the PR directly from this skill. When invoking `/dyad:pr-push`, carry forward enough context for the PR body to include:
   - A link to the failing run.
   - The root-cause narrative (what raced, in concrete terms — not "timing issue").
   - Why the fix is correct (what the retry loop is doing that the original flow wasn't).
   - The local build and affected E2E commands you ran.

## Gotchas

- `gh run download` needs `-R <owner>/<repo>` if you're not in a cwd with matching origin.
- `results.json` paths inside `attachments[]` are _CI-side_; only use them to match hashes, never to read files.
- A fork PR's artifacts live on the fork's run, not the upstream's. Make sure `run_id` is on the right repo.
- Many traces unpack to the same `/tmp/trace-extract/` — clean between extractions or use unique subdirs.
- The `html-report` is the _merged_ report across shards. Individual shard artifacts (`blob-report-*`, `flakiness-report-*`) are usually unnecessary for root-causing.
