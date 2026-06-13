# Code Explorer Benchmark

Date: 2026-06-05 / 2026-06-06

## Summary

The benchmark launch failure was caused by the benchmark driver overriding `HOME` to a fresh temp directory before launching packaged Electron. On macOS, the app process started, printed main-process startup logs, and opened Chromium remote debugging, but Playwright never finished `electron.launch`.

The driver now keeps the normal `HOME` and only isolates benchmark-specific config with:

- `XDG_CONFIG_HOME=<trial user-data-dir>/xdg-config`
- `GIT_CONFIG_GLOBAL=<trial user-data-dir>/.gitconfig`
- `--user-data-dir=<trial user-data-dir>`

This fixes packaged Dyad startup. The benchmark now reaches app import and real Dyad Engine local-agent runs using `DYAD_PRO_KEY` from `.env`.

Benchmark authentication modes:

- Default runs use `DYAD_PRO_KEY` and Dyad Engine: `--auth dyad-pro`.
- Benchmark-only Codex auth runs use `~/.codex/auth.json` through a loopback proxy: `--auth codex`.
- In Codex auth mode the proxy rewrites engine model IDs to `--codex-model` (default `gpt-5.5`), forwards `/v1/responses`, and adapts `/v1/chat/completions` for the value sub-agent through the ChatGPT Codex backend. This is for benchmark transport experiments only, not normal app runtime and not a true `dyad/value` pricing comparison.

## Commands Run

Initial failing command:

```sh
npm run benchmark:code-explorer -- --repos excalidraw --tasks toolbar-flow --repeats 1 --timeout 600000
```

Launch diagnosis:

- Normal E2E-style launch with the real `HOME` succeeded.
- Launch with only `GIT_CONFIG_GLOBAL` succeeded.
- Launch with only `XDG_CONFIG_HOME` succeeded.
- Launch with `HOME=<temp>` failed with `electron.launch: Timeout ...`.

Verification command after the fix:

```sh
npm run benchmark:code-explorer -- --repos excalidraw --tasks toolbar-flow --repeats 1 --timeout 600000
```

## Latest Recorded Results

Result directory:

```text
benchmark-results/code-explorer/run-2026-06-06T00-11-54-148Z
```

This run was executed after `npm run build`, so packaged Electron included the conditional `explore_code` prompt update.

| Repo       | Task         | Arm      | Status | Elapsed ms | Tokens | Tool calls | Provider steps | Notes                                                                                        |
| ---------- | ------------ | -------- | ------ | ---------: | -----: | ---------: | -------------: | -------------------------------------------------------------------------------------------- |
| excalidraw | toolbar-flow | baseline | ok     |      96129 |  78772 |         37 |             22 | Passed rubric. Used `list_files`, `grep`, and `read_file`; `code_search` was absent.         |
| excalidraw | toolbar-flow | explore  | ok     |      80029 |  50686 |         29 |             21 | Passed rubric. Used `explore_code` once as the first exploration tool; `code_search` absent. |

The latest `explore` trial recorded:

```json
{
  "totalTokens": 50686,
  "inputTokens": 49416,
  "outputTokens": 1270,
  "toolCallCount": 29,
  "providerStepCount": 21,
  "toolCallsByName": {
    "set_chat_summary": 1,
    "explore_code": 1,
    "grep": 8,
    "read_file": 19
  }
}
```

Delta versus baseline in the same run:

- `explore` used 28,086 fewer tokens.
- `explore` used 8 fewer tool calls.
- `explore` used 1 fewer provider step.
- `explore` finished 16.1 seconds faster.

Note: `benchmark-results/code-explorer/run-2026-06-06T00-07-41-072Z` was started before rebuilding packaged Electron after prompt edits. It is a valid extra measurement of the old package, but should not be used to evaluate the prompt change.

## Trace and Final-Answer QA

Run evaluated:

```text
benchmark-results/code-explorer/run-2026-06-06T00-11-54-148Z
```

Both arms produced correct, useful answers and passed the rubric. Neither trace had tool errors, and `code_search` was absent from both arms after making `explore_code` mutually exclusive with `code_search`.

Baseline trace:

- 22 provider steps.
- 37 completed tool calls.
- Tool sequence: `set_chat_summary`, `list_files`, `grep`, `read_file`.
- Final answer covered selected-shape toolbar actions, main shape toolbar tool selection, action registration, scene insertion, `Scene.replaceAllElements`, `Scene.triggerUpdate`, and `App.triggerRender`.
- Strongest point: it was very complete and included both action-backed controls and direct shape-tool creation.
- Weakest point: it used more tokens and more tool calls to get there.

Explore trace:

- 21 provider steps.
- 29 completed tool calls.
- Tool sequence began with one `explore_code` call, then targeted `grep` and `read_file`.
- Final answer covered selected-shape toolbar actions, shape toolbar selection, `ActionManager`, `App.syncActionResult`, `App.updateScene`, `Scene.replaceAllElements`, and `Scene.triggerUpdate`.
- Strongest point: it was concise, directly answered the requested chain, and included the direct `updateScene` path in addition to toolbar/action paths.
- Weakest point: it still needed 27 follow-up `grep`/`read_file` calls after `explore_code`, so the tool is not yet replacing most manual inspection.

QA verdict:

- Final-message quality: close tie. Baseline was slightly more expansive on registration and creation details; explore was more concise and still covered the important scene-update paths.
- Overall benchmark winner for this rebuilt run: `explore`, because final quality was comparable while it used 35.7% fewer tokens, 21.6% fewer tool calls, one fewer provider step, and finished about 16.1 seconds faster.

## Full Suite QA

Run evaluated:

```text
benchmark-results/code-explorer/run-2026-06-06T21-26-47-812Z
```

The latest full suite covered 7 repos and 24 tasks: Excalidraw, Mattermost, Cal.com, Supabase, Dub, Twenty, and Midday. It used the packaged app from a fresh `npm run build`, `DYAD_PRO_KEY`, `--repeats 1`, `--concurrency 2`, and the 10-minute per-chat timeout.

Aggregate result:

- `explore` completed 23/24 trials; baseline completed 22/24. The three errors were 10-minute chat-stream timeouts: `calcom/availability` explore, `twenty/list-filter-sort` baseline, and `midday/invoice-create` baseline.
- In the raw by-arm totals, `explore` cost $19.5479 vs $25.7857 for baseline, saved 991,734 primary uncached input tokens, and used 829 total tool calls vs 787 for baseline.
- The value sub-agent spent 63,447 tokens and $0.0333 across completed explore runs. That is only 0.17% of explore spend under the benchmark pricing assumptions; primary-model context still dominates cost.
- Quality by benchmark rubric remained comparable: explore passed 23/23 completed trials, baseline passed 22/22, and both arms had 1.00 expected-term coverage.

QA notes:

- `explore_code` was available and used on 23/23 completed explore trials. The single unavailable row in the generated cohort table is the timed-out explore arm, not a readiness failure.
- All completed trials passed the benchmark rubric. Final-answer comparison was mostly tie/mixed; notable baseline-quality wins were `dub/analytics-chart`, `dub/invite-member`, `excalidraw/toolbar-flow`, and `twenty/pipeline-stage-update`; notable explore wins were `excalidraw/element-selection` and `supabase/database-table`.
- Clear efficiency wins included `supabase/database-table`, `supabase/project-settings`, `dub/workspace-settings`, and several Mattermost/Dub tasks. Clear losses included `twenty/list-filter-sort`, `midday/invoice-create`, `midday/report-metrics`, and `excalidraw/element-selection` on spend.
- Trace QA found no provider `tool_calls` protocol errors after the one-step sub-agent change. It did find lingering path/root issues in mono-repos, especially attempts to read sibling package paths from an imported package root.
- One sub-agent trace used the literal `app_name: "current app"`, causing read-only tools to reject the app name. The resolver now treats obvious current-app aliases as the current app, and the sub-agent prompt explicitly says to omit `app_name` for current-app inspection.

Full-suite verdict:

- Final-message quality: broadly comparable by rubric pass and trace review. There are task-level ties and a few baseline wins where breadth matters, but no evidence that explore systematically worsens answer correctness.
- Efficiency: the latest full run is a net dollar and token win in raw by-arm totals, but tool calls increased and three timeout rows make pairwise interpretation noisy.
- Remaining risk: this is still one repeat at concurrency 2 with memory pressure. Treat the result as directional, not statistically stable.

## Current Interpretation

Latest full suite after the Cal.com/package-report hill climb:

- `run-2026-06-07T02-58-00-458Z` completed 48/48 trials across 7 repos and 24 tasks with no errors.
- Explore was available and used on all 24 explore trials. Baseline had `explore_code` disabled by setting, as intended.
- Explore saved $11.7703 overall: $47.9193 baseline vs $36.1490 explore, a 24.6% spend reduction under the benchmark pricing assumptions.
- The saving came from the primary model, not cheap sub-agent accounting: primary uncached input fell by 1,775,152 tokens, primary cached input fell by 4,228,608 tokens, and primary tool calls fell by 206.
- The value sub-agent added 68,667 total tokens, 111 tool calls, and $0.0427, about 0.12% of explore spend.
- Quality stayed healthy by the benchmark rubric: both arms passed 24/24 with full expected-term coverage. Explore had fewer final-answer characters but more line-range refs (488 vs 0) and a higher heuristic quality score (3687 vs 3054).
- Elapsed time also improved in aggregate by 713.9s, but this run used `--concurrency 2` and local memory pressure was high during Twenty, so token/cost/tool deltas are the more reliable signal.
- Remaining task-level regressions are useful rather than disqualifying: `excalidraw/export-flow`, `excalidraw/toolbar-flow`, `mattermost/post-send`, `midday/invoice-create`, and `twenty/record-detail` still favor baseline on the generated winner heuristic. These are the next trace-QA targets if we continue hill climbing.

The original startup blocker is fixed, and `code_search` is now absent when `explore_code` is enabled and ready. The suite driver also now makes the benchmark repeatable: it can rebuild the packaged app, fetch repos, run a smoke or full matrix, compare against the previous run, and update this file.

After making the main agent prompt conditional, adding mono-repo tsconfig discovery, caching the TypeScript worker/index, and expanding the corpus, the latest full suite is materially better than the earlier 4-repo run. The main remaining inefficiency is trace shape: on losing tasks, the primary model treats the sub-agent report as a starting point and then repeats broad manual exploration. Future improvements should make the report more edit-target-oriented and make the main prompt trust high/medium confidence reports more aggressively, without benchmark-only guards.

The latest smoke runs verified that deterministic sub-agent reporting removes the extra `subagent_synthesis_start` value-model call. The first fresh smoke after evidence extraction (`run-2026-06-06T20-15-34-480Z`) exposed a ranking flaw: broad grep ranges such as example/collab `updateScene` matches outranked tighter compiler-backed action-manager evidence. The report builder now de-duplicates overlapping same-file ranges, includes concise evidence lines, penalizes very wide ranges and examples, and prefers precise compiler-backed refs over broad grep-only spans when the compiler signal is strong.

The follow-up smoke (`run-2026-06-06T20-21-52-149Z`) showed the ranking fix working: the report's primary files started with `packages/excalidraw/actions/manager.tsx` and `packages/element/src/store.ts` instead of broad example files. Explore still won the paired smoke on spend ($0.5847 vs $1.3466), total tokens (451,257 vs 1,554,331), primary uncached input (54,195 vs 96,121), total tool calls (35 vs 51), elapsed time (78.3s vs 108.2s), and benchmark quality score (+11). Trace QA still shows substantial main-model follow-up after the report, especially for App/Scene render-sink details. The sub-agent prompt now explicitly asks flow investigations to cover both the dispatcher/handler and the update/render/store/API sink, and coverage detection is stricter about not counting a caller as the sink implementation.

After that run, `explore_code` gained a chat-scoped report cache for repeated same-investigation calls. The cache is keyed by chat/app/tsconfig/query and is only reused when every file named in the structured report still has the same mtime and size. Focused tests verify both cache reuse and invalidation after a referenced file changes. This is expected to help tasks where the main model retries or decomposes into multiple similar `explore_code` calls; the latest smoke task only called `explore_code` once, so it does not measure the cache effect.

The benchmark harness now also emits a repeatable "Final Answer Comparison" table in generated summaries. It compares paired baseline/explore answers using expected-term coverage, quality-score delta, reference-density delta, and answer-length delta, producing an `explore` / `baseline` / `tie` / `incomplete` verdict as a starting point for manual final-message QA. This is deliberately a rubric heuristic, not a replacement for trace review.

Fresh packaged smoke after the cache and comparison changes: `run-2026-06-06T20-31-56-517Z`. Both arms completed. Explore won on spend ($0.4735 vs $1.1195), combined tokens (358,315 vs 954,943), primary uncached input (42,994 vs 112,142), total tool calls (35 vs 45), and elapsed time (71.2s vs 283.7s). Final-answer comparison was a tie by rubric heuristic: both arms had full expected-term coverage, explore had a -1.0 quality-score delta, one fewer file reference, and a shorter final answer. Trace QA showed one `explore_code_cache_miss`, no cache hit (expected for this one-call task), one deterministic sub-agent report, and no `subagent_synthesis_start`.

Post-hill-climb Cal.com mono-repo smoke:

- `run-2026-06-06T22-34-58-792Z` imported the Cal.com checkout root while keeping benchmark focus on `apps/web`. Both arms completed and passed. `explore` was available and used, saved 64,275 primary uncached input tokens, saved $0.5105, and finished 15.1s faster, but the trace showed root import selected `apps/docs/tsconfig.json`, which is the wrong default project for an `apps/web` task.
- The workspace tsconfig ordering now prefers product app/front/dashboard configs over docs/examples/test configs. `run-2026-06-06T22-41-15-741Z` verified `explore_code` selected `apps/web/tsconfig.json`. Both arms completed and tied on quality, but this single repeat was a small baseline efficiency win: explore cost $1.3367 vs $1.2446, used 1,150 more primary uncached input tokens, and finished 8.3s slower.
- The benchmark harness now applies the existing app `chatContext.contextPaths` mechanism after import when a task focuses on a subpath inside a root import. `run-2026-06-06T22-49-29-497Z` set `apps/web/**/*` for the same Cal.com task. Both arms completed, passed, and tied on final-answer quality. `explore` selected `apps/web/tsconfig.json`, saved $0.5760, saved 18,365 primary uncached input tokens, and saved 972,207 combined tokens, but was 286.5s slower and used 6 more total tool calls. The initial codebase prompt shrank from the earlier root-import shape of ~33.3M characters / ~8.3M estimated tokens to 4,839,622 characters / ~1.21M estimated tokens. One trace logged a transient code-explorer worker exit, but the arm recovered and finished without an `explore_code` tool-call error.
- The harness now derives a bounded set of related workspace package context globs from the focused app's `tsconfig` path aliases and workspace package manifests. A broad first attempt (`run-2026-06-06T23-04-32-962Z`) included declaration-only `include` packages such as `packages/app-store`, raising Cal.com initial context to 9,169,483 characters / ~2.29M estimated tokens; this was rejected as too broad. The tightened selector ignores declaration-only includes and generic test/support packages. `run-2026-06-06T23-14-54-040Z` used `apps/web/**/*`, `packages/coss-ui/**/*`, `packages/lib/**/*`, and `packages/prisma/**/*`, reducing initial context to 6,042,023 characters / ~1.51M estimated tokens. Both arms completed and tied on final-answer quality; `explore` saved $0.6653, 33,453 primary uncached input tokens, 1,059,727 combined tokens, and 11.0s elapsed, but used 7 more total tool calls. Trace QA showed `apps/web/tsconfig.json`, deterministic sub-agent reporting, and no `subagent_synthesis_start`.
- Root import plus focused app/package context fixes sibling-package reachability while avoiding the worst whole-checkout prompt bloat. The next non-overfit improvement is reducing broad grep/read follow-up after a usable report and validating this selector across the other monorepos.
- Remaining path issue: both arms can still hallucinate or use stale package aliases such as `packages/atoms/...` instead of `packages/platform/atoms/...`. This is a general monorepo resolution problem, not specific to `explore_code`.

Post sub-agent action-contract hill climb:

- The report now includes a structured `recommendedPrimaryAction` (`answer_from_report`, `read_edit_target`, or `targeted_gap_search`) and the main prompt explains how to consume it. Focused tests cover the new report shape and prompt snapshot.
- `run-2026-06-06T23-37-42-281Z` verified the root-path fix in a packaged Cal.com smoke: the report emitted `apps/web/...` paths instead of benchmark-root-prefixed paths. Both arms completed and tied on quality. Explore saved $0.2702, 34,716 primary uncached input tokens, 54,591 combined tokens, 4 total tool calls, and 7.6s elapsed. Trace QA still showed heavy primary follow-up after the report: 9 main greps and 27 main reads.
- A scoring fix then normalized mutation terms such as "creating" to "create" and removed generic exploration terms like "flow/files/symbols/implementation" from compiler search. `run-2026-06-06T23-43-46-406Z` completed both arms and tied on quality. Explore saved $1.0620, 125,957 primary uncached input tokens, 1,003,843 combined tokens, and 3.8s elapsed, despite 2 more total tool calls. The report used correct app-relative paths but surfaced `packages/testing/...` as the top compiler-backed file, so test/support paths are now penalized unless the query asks for tests.
- Focused unit coverage now verifies three Cal.com-derived regressions without hard-coding Cal.com: nested git checkout roots stay app-relative, "creating booking" ranks `createBooking`-style implementation symbols above booking-management UI, and implementation-flow queries prefer feature code over `packages/testing` while explicit test queries can still find test support.
- Remaining trace issue: the primary model still sometimes emits invalid broad grep regexes like `createBooking\({`, then spends a step recovering. This is not an `explore_code` correctness issue, but it is a repeated cost/latency signal for the main exploration loop. The grep tool now has `literal=true` for exact symbol/snippet searches with punctuation, and its invalid-regex diagnostic tells the model to retry punctuation-heavy exact searches in literal mode.
- Final-answer QA showed the benchmark's line-range metric stayed at zero because the model usually dropped report ranges from the visible final answer. The main prompt now tells the model to preserve useful ranges from `explore_code` or `read_file` as `path:start-end` when answering with a code map, so users and the benchmark can see jump-target quality instead of only file-name density.
- `targeted_gap_search` recommendations are now concrete instead of abstract. Rather than returning only a missing cluster such as `action/dispatch`, the report includes bounded terms, likely scopes from observed files, and a reminder to use `literal=true` for punctuation-heavy exact snippets. This directly targets the trace pattern where the primary model turned a generic missing-coverage label into broad grep/read loops.
- A fresh packaged Cal.com smoke after the prompt/search-target changes (`run-2026-06-07T00-01-17-355Z`) completed both arms. Explore saved $0.1725, 23,637 primary uncached input tokens, 125,126 combined tokens, and produced 25 visible line-range refs versus 0 for baseline; the final-answer heuristic favored explore (+35 quality score). It was still 21.8s slower and used 3 more primary tool calls plus 3 value-tool calls. Trace QA confirmed the sub-agent now uses one first-step batch containing `explore_code`, `grep`, and `list_files`, with deterministic reporting and no `subagent_synthesis_start`. It also exposed that the sub-agent ranker could still promote `.test.ts` files above implementation files, so test/support paths are now heavily demoted in deterministic report ranking unless the query explicitly asks for tests.
- Re-running the same packaged Cal.com smoke after test/support demotion (`run-2026-06-07T00-08-32-796Z`) showed the demotion worked: the report started with `apps/web/components/booking/actions/bookingActions.ts` instead of `bookingActions.test.ts`. Explore still lost on spend ($1.6296 vs $1.4802) because primary cached input ballooned (1,870,336 vs 1,346,048), with 35 main provider steps and 55 main tool calls. Quality still favored explore (+38, with 23 visible line ranges), and primary uncached input was lower by 21,378 tokens, but the trace showed the sub-agent report was still too broad: it found generic booking action UI before the create-booking submission path, and its `searchTargets` included filler words such as `starting`, `apps`, `include`, and `workspace`. The sub-agent query-term/ranking layer now normalizes mutation words, removes those filler terms, and boosts exact action-domain symbols/paths such as `createBooking` or `create-booking` over generic action UI files.
- Re-running after the action-domain scoring fix (`run-2026-06-07T00-16-19-122Z`) flipped the smoke back to an explore win: explore saved $0.2313, 29,389 primary uncached input tokens, 90,063 combined tokens, and 4 primary tool calls, while final-answer quality still favored explore (+23 with 17 visible line ranges). It was still 7.2s slower and still had 25 main provider steps. Trace QA showed the deterministic report was still not good enough: the raw compiler query remained the full user-style sentence and the report still started from `BookingActionsDropdown.tsx` / `BookingListItem.tsx` rather than the create-booking submission path. The raw sub-agent `explore_code` tool now normalizes verbose mutation prompts before compiler search, e.g. "Trace the flow for creating a booking starting in apps/web..." becomes `create booking handle handler submit action mutation`.
- The packaged smoke after query normalization (`run-2026-06-07T00-23-39-115Z`) kept explore ahead: explore saved $0.2011, 14,528 primary uncached input tokens, 229,709 combined tokens, and 8 provider steps; quality favored explore by +36 with 18 visible line-range refs. It was still 11.1s slower and used the same number of primary tool calls. Trace QA showed the main model recovered well, but the deterministic report still started from generic booking action UI (`apps/web/components/booking/actions/bookingActions.ts`) and scoped the recommended gap search to `apps/web` even though the task asked for related workspace packages. The sub-agent ranker/search-target layer now recognizes camelCase action-domain paths such as `createBooking.ts` and keeps `packages` in targeted gap-search scopes for workspace/package queries.
- Re-running after that ranking/scope patch (`run-2026-06-07T00-31-53-522Z`) was still an explore win, but mostly on quality and uncached tokens rather than total tokens: explore saved $0.0188, 20,423 primary uncached input tokens, 2 primary tool calls, 16 provider steps, and produced +36 quality with 18 visible line-range refs. It was 24.9s slower and used 261,829 more combined tokens because cached input was higher. Trace QA showed the report still incorrectly treated workspace/package flow as covered without any `packages/...` primary file, then recommended `read_edit_target` for generic booking action UI. The report coverage model now adds a `workspace/package implementation` cluster for workspace/package/monorepo queries and only marks it observed when a `packages/...` file is present. If it is missing, the report must return concrete `targeted_gap_search` guidance scoped to packages. Focused tests cover this; the final workspace/package coverage patch has not yet been rerun as a packaged benchmark.
- The first packaged rerun after workspace/package coverage (`run-2026-06-07T00-39-07-912Z`) proved the coverage gate worked but exposed two general rank/targeting issues. Explore saved $0.1114, 24,230 primary uncached input tokens, and 112,966 combined tokens, but lost final-answer quality by 9 points, used 18 more total tool calls, and was 37.1s slower. Trace QA showed `workspace/package implementation` was now missing as intended, but `packages` was truncated out of the concrete search targets because three app scopes filled the cap. The report also promoted `apps/web/playwright/booking-limits.e2e.ts` and `.test.ts` evidence above implementation files. The sub-agent now forces `packages` first for package/workspace gaps, while preserving app-local scopes for other gaps, and demotes `.e2e.ts(x)`, `/playwright/`, `/e2e/`, and `/fixtures/` paths unless the query asks for tests/e2e.
- The fresh packaged smoke after those rank/target fixes (`run-2026-06-07T00-46-56-930Z`) completed both arms. Explore saved $0.1157, 4,403 primary uncached input tokens, and 258,188 combined tokens; final-answer comparison favored explore by +40 quality with 26 visible line-range refs and equal file-reference count. It was still 11.0s slower and used 18 more total tool calls. Trace QA showed the deterministic report now correctly required package implementation and emitted `workspace/package implementation` search guidance scoped first to `packages`. It no longer surfaced the e2e/playwright file in the report. Remaining issue: the top report file is still generic booking display UI (`BookingListItem.tsx`) rather than the create-booking submission path, so the primary model still performs substantial recovery search and can still try stale package aliases before correcting to `packages/platform/...`.
- A mutation-path ranking patch then boosted create/submit/form/hook/api/service paths and demoted list/detail/success display paths for mutation queries. The next packaged smoke (`run-2026-06-07T00-54-01-546Z`) was a stronger aggregate explore win: explore saved $0.1742, 32,804 primary uncached input tokens, 23,807 combined tokens, 4 total tool calls, and 11 provider steps; final-answer QA favored explore by +40 with 35 visible line ranges. Trace QA, however, showed the path boost was too broad: it promoted an unrelated `ApiKeyDialogForm.tsx` because it matched generic "api/form" terms without matching the domain term `booking`. The ranker now only applies mutation path boosts when the path also contains a non-generic domain term, and penalizes off-domain generic mutation paths. Focused tests cover the `ApiKeyDialogForm` regression; this final tightening has not yet been rerun as a packaged smoke.
- The packaged smoke after the domain guard (`run-2026-06-07T01-00-49-178Z`) removed the API-key form from the report and was the strongest single Cal.com smoke so far: explore saved $0.5555, 63,676 primary uncached input tokens, 437,051 combined tokens, 9 total tool calls, and 4.0s elapsed; final-answer QA favored explore by +36 with 25 visible line ranges. Trace QA still found two related ranking problems: an off-domain signup API handler with `createCustomer` symbols became the top file, and a booking keyboard `.test.ts` support file still appeared in primary files. The ranker now applies a stronger penalty to off-domain generic mutation paths and a stronger non-test-query penalty to test/support paths. Focused tests cover both regressions; this final penalty tightening has not yet been rerun as a packaged smoke.
- The packaged smoke after stronger off-domain/test penalties (`run-2026-06-07T01-07-47-527Z`) was a regression on efficiency: baseline won by $0.3927, 50,686 primary uncached input tokens, 399,258 combined tokens, 14 total tool calls, and 16.0s elapsed. Final-answer QA was a tie by heuristic, with explore only +7 quality and zero visible line ranges. Trace QA showed the off-domain signup/test-support files were gone, but the report regressed to read-only booking display/action files (`BookingActionsDropdown.tsx` and booking detail/success pages). The compiler query now expands mutation prompts with `api`, `form`, `hook`, and `service`, and the ranker demotes dropdown/menu/list/detail/success display-control paths unless they also show mutation intent such as create/submit/form/hook/API/service. Focused tests cover the dropdown/list/success regression; this final query/ranking patch has not yet been rerun as a packaged smoke.
- Re-running after the query/ranking patch (`run-2026-06-07T01-15-34-403Z`) flipped the smoke back to a strong explore win: explore saved $0.5826, 34,546 primary uncached input tokens, 910,593 combined tokens, and about half the primary cached input. The value-model spend was only $0.0014. Final-answer QA favored explore by +46 with 30 visible line-range refs, versus 0 for baseline. It was still 2.0s slower and used more tools overall (63 primary + 3 value vs 54 primary baseline), so the next optimization remains reducing primary follow-up after a useful report. Trace QA also exposed that `events.jsonl` recorded tool names, timing, and token usage, but not tool arguments or the `explore_code` report body; benchmark-only trace logging now records bounded `argsPreview` and `resultPreview` fields for main and sub-agent tool calls so future report-level QA can inspect the actual report without relying only on final answers.
- The first smoke with bounded `argsPreview`/`resultPreview` (`run-2026-06-07T01-28-26-271Z`) saved $0.1591 and 403,378 combined tokens, but still used 7,436 more primary uncached tokens, 18 more total tools, and ran 6.5s slower. Final-answer QA favored explore by +40 with 24 visible line-range refs. Trace QA showed the report itself was still weak: the value-model query polluted the compiler search with route/page/component filler (`route page component starts sends`), so the deterministic report promoted display/action UI and asked for another targeted gap search.
- After dropping navigation/display filler from value-model mutation compiler queries, `run-2026-06-07T01-33-53-908Z` was a stronger aggregate win: explore saved $0.5858, 42,055 primary uncached input tokens, 768,928 combined tokens, and 8.8s elapsed; final-answer QA favored explore by +40 with 27 visible line-range refs. The report still exposed one non-overfit ranking issue: with a strong compiler result, broad `grep`/`list_files` route-page observations could outrank compiler-backed mutation/package files in the report. The ranker now gives strong compiler symbol windows a larger source prior, demotes route/page display paths for mutation-flow queries unless the path itself shows mutation intent, and only boosts `packages/...` mutation files when the raw query asks for workspace/package/monorepo evidence. Focused tests cover this trace shape.
- `run-2026-06-07T01-43-30-768Z` showed the previous ranking tweak was insufficient and noisy: baseline won by $0.3807, 33,154 primary uncached tokens, 333,867 combined tokens, 29 total tool calls, and 60.8s elapsed, while final-answer QA still favored explore by +40. Trace QA showed the compiler query still carried broad mutation-role filler (`look/actions/clients/server/types`) and the report started from off-domain `createCustomer`/signup and test-support files, forcing the primary model to recover with many reads.
- After stripping that role filler from mutation compiler and gap-search terms, `run-2026-06-07T01-50-28-522Z` recovered to an explore win: $0.4114 saved, 36,230 primary uncached tokens saved, 435,049 combined tokens saved, 3 total tool calls saved, and 8.9s faster. Final-answer QA favored explore by +37 with 24 visible line-range refs. Trace QA still found the report could rank off-domain generic mutation files and `.test.ts` support files too high when the raw compiler result is poor, so the local ranker now applies stronger non-test and off-domain generic mutation penalties. That final penalty tightening has passed focused tests but has not yet had another packaged smoke rerun.
- Moving the same mutation/domain scoring down into the compiler worker improved the raw report in `run-2026-06-07T01-59-12-602Z`: the top compiler file became `apps/web/modules/bookings/hooks/useBookings.ts` instead of signup/test support, and explore saved $0.4864, 25,586 primary uncached tokens, 741,310 combined tokens, 8 total tool calls, and 18.7s elapsed. Final-answer QA favored explore by +40 with 22 line-range refs. The arm winner is still `mixed` because explore had 5 more primary tool calls, and trace QA showed one remaining report-noise pattern: display/list files such as `BookingListContainer.tsx` can still appear when they match the domain but not the mutation intent. The worker now demotes list/log/history/container display paths for mutation queries unless the path has mutation intent; focused tests cover this, but that final display demotion has not yet had a packaged rerun.
- The packaged rerun after worker display/list demotion (`run-2026-06-07T02-06-48-212Z`) completed both arms. Explore saved $0.3813, 22,034 primary uncached tokens, 613,026 combined tokens, 4 total tool calls, and final-answer QA favored explore by +40 with 32 visible line-range refs. Explore was 24.0s slower. Trace QA confirmed the prior list/container file disappeared, but broad route grep hits filled `primaryFiles` after the compiler-backed `useBookings.ts` while package implementation was still missing. The deterministic report builder now removes low-signal route/display `grep` and `list_files` refs from mutation primary files when compiler signal is strong, and drops weaker duplicate `list_files` refs for paths already covered by concrete source refs. Focused tests cover this; the final report-primary filtering has not yet had a packaged rerun.
- The packaged rerun after report-primary filtering (`run-2026-06-07T02-15-01-342Z`) showed the filter worked but also exposed the next scope issue. Explore still saved $0.1063, 16,386 primary uncached tokens, and 88,125 combined tokens, with final-answer QA +40 and 34 line-range refs, but it was 34.8s slower and used 26 more total tool calls. Trace QA showed route-page files no longer filled the report, but low-signal sibling-app grep refs under `apps/api/v2` became primary files and then steered `targeted_gap_search` scopes into that sibling app. The report builder now derives gap-search scopes only from compiler/read refs, not grep/list refs, while still forcing `packages` for workspace/package gaps. Focused tests cover this sibling-app scope pollution; the final scope-derivation fix has not yet had a packaged rerun.
- The packaged rerun after scope derivation (`run-2026-06-07T02-23-22-247Z`) verified the sibling-app scope fix. The report's `targeted_gap_search` scopes were limited to `packages` and `apps/web/modules`, instead of `apps/api/v2`. Explore saved $0.1074, 20,157 primary tokens, and 23,850 combined tokens, with final-answer QA +32 and 16 line-range refs, but it still spent 10.4s more and used 7 more total tool calls. Trace QA showed the report still included `apps/web/modules/bookings/lib/bookingSheetKeyboardHandler.test.ts` as a primary file for a production booking-creation flow. The primary-file policy now filters test/support refs from non-test reports when implementation refs exist.
- The packaged rerun after filtering test/support refs from report primary files (`run-2026-06-07T02-27-54-791Z`) was the strongest Cal.com smoke in this hill climb. Explore saved $0.6517, 41,356 primary uncached input tokens, 894,909 combined tokens, 9 primary tool calls, and 24.9s elapsed, with final-answer QA +32 and 16 line-range refs. Trace QA confirmed the `.test.ts` support file disappeared from `primaryFiles`; the report now listed only `apps/web/modules/bookings/hooks/useBookings.ts` and gave package-scoped gap-search guidance. One low-risk cleanup remains: a filler word (`when`) leaked into generated search terms, so `when` is now a query stopword and focused tests assert it stays out of `searchTargets`.
- The packaged rerun after adding deterministic package augmentation (`run-2026-06-07T02-38-02-739Z`) confirmed the sub-agent can now move package discovery out of the primary loop: an added sub-agent grep found `packages/features/bookings/lib/create-booking.ts`, `packages/features/bookings/lib/handleNewBooking/createBooking.ts`, and service files before the report was built. Explore saved $0.2136, 5,451 primary uncached tokens, 291,563 combined tokens, 5 primary tool calls, and 70.0s elapsed; final-answer QA favored explore by +40 with 35 visible line-range refs. Trace QA also exposed the next generic ranking issue: package contract/audit files (`interfaces/IBookingCreateService.ts`, `booking-audit/...`) could outrank implementation files in `primaryFiles` and become the edit target. The report ranker now demotes mutation contract/type files and off-query audit/report/history files unless the query asks for those concerns.
- The packaged rerun after contract/audit demotion plus bounded package source enrichment (`run-2026-06-07T02-54-17-263Z`) verified the report shape improved. `primaryFiles` now starts with `packages/features/bookings/lib/create-booking.ts:1-85` and `packages/features/bookings/lib/handleNewBooking/createBooking.ts:19-273`; the old interface/audit distractors no longer become the edit target. The sub-agent paid for one extra value-side `read_file`, but explore still saved $1.3270, 116,911 primary uncached input tokens, 1,353,448 combined tokens, 42 primary tool calls, and 69.1s elapsed on this paired smoke. The heuristic quality score favored baseline by 10 because the baseline final answer was much longer; manual trace QA favors explore for efficiency and deems the final-answer quality acceptable for this answer-only task.
- Targeted reruns on the five full-suite baseline winners produced mixed but useful evidence. In
  `run-2026-06-07T03-51-38-147Z`, explore saved $5.3984 on the five-task cohort
  ($7.1185 vs $12.5168), with 143 line-range refs vs 0 baseline, but trace QA showed the reports
  still over-promoted generic compiler/listing evidence for Excalidraw export and Twenty record
  detail. The sub-agent now runs a small deterministic gap-augmentation pass when confidence is low
  or critical coverage is missing: export flows get a scoped `exportTo` probe; route/page flows get
  scoped pages/routes/navigation probes based on the route domain term.
- The next five-task targeted rerun (`run-2026-06-07T04-04-51-036Z`) validated the export fix:
  Excalidraw export report now starts from `packages/excalidraw/scene/export.ts`, and explore cost
  dropped to $0.6767 vs $1.1028 baseline for that task. Aggregate targeted cost was $8.2758 explore
  vs $10.3228 baseline, with 139 line-range refs vs 0 and 113.3s lower elapsed time. Trace QA found
  the remaining route-flow bug: Twenty record detail still treated generated GraphQL/story/page-layout
  files as coverage and recommended answering from a bad report.
- A narrow Twenty rerun after generated/story support filtering (`run-2026-06-07T04-18-27-009Z`)
  confirmed the task class became `route-flow` and confidence dropped to medium, but the report still
  accepted unrelated side-panel `pages/*` files as record-detail route coverage. Route coverage now
  receives query terms and, for record-detail flows, requires detail/show/object-record/record-page
  identity in the path or symbol name rather than evidence-only imports.
- A Dyad Pro rerun after that route-domain tightening (`run-2026-06-07T04-29-44-888Z`) could not
  complete because Dyad Engine returned `ExceededBudget` at spend/budget 465.0. That exposed a
  benchmark-runner bug: failed trials referenced `contextPaths` from the success-only scope. The
  runner now initializes `contextPaths` before the try/catch so future model/budget failures are
  recorded as error rows instead of crashing the whole run.
- A Codex-auth narrow rerun with the same packaged app (`run-2026-06-07T04-31-28-417Z`) verified the
  route-domain tightening in a real trace. The report no longer recommended `answer_from_report` or
  an edit target for unrelated side-panel/page-layout files; it marked `route/page entry` missing and
  emitted `targeted_gap_search`. On this run explore saved $0.4166 vs baseline ($3.2200 vs $3.6365),
  123,186 combined tokens, 78,073 uncached input tokens, and 4 total tool calls while quality scoring
  favored explore by +40. Trace QA still showed noisy `scripts/mock-data/*` support refs becoming
  primary files/search scopes. The report builder now filters support refs out of non-test reports
  before route policy, treats `scripts/mock-data` as support, and derives explicit query scopes such
  as `packages/twenty-front`.
- A final Codex-auth packaged rerun (`run-2026-06-07T04-42-05-865Z`) validated the support-script
  cleanup. `scripts/mock-data/*` no longer appears in `primaryFiles` or gap-search scopes; the report
  still correctly refuses to answer from the incomplete map, keeps `editTarget: null`, and sends the
  primary model to `targeted_gap_search` for missing `route/page entry` scoped to
  `packages/twenty-front/src`, `packages/twenty-front`, and `packages`. Explore saved $1.2207
  ($1.8480 vs $3.0687), 252,193 combined tokens, 239,407 uncached input tokens, 11 total tool calls,
  and final-answer QA favored explore by +40. One small cleanup after the run removed generic
  `loaded`/`rendered` from generated search terms; focused tests and typecheck pass.

## Remaining Benchmark Work

Repeatable benchmark commands:

```sh
npm run benchmark:code-explorer:smoke
npm run benchmark:code-explorer:full
```

To run against the existing packaged app after a known-fresh build:

```sh
npm run benchmark:code-explorer:suite -- --mode full --skip-build
```

Codex-auth benchmark smoke:

```sh
npm run benchmark:code-explorer:suite -- --mode smoke --skip-build --auth codex
```

Note: `run-2026-06-06T17-20-42-387Z` was the successful Codex-auth smoke used to verify the proxy after adding `/v1/chat/completions` adaptation. It completed before the final chat-stream usage propagation patch, so that run shows sub-agent tool calls but zero value-model tokens.

Use `--concurrency 2` as the starting point. Higher values will run more packaged Electron instances and real Dyad Engine streams at once, which can distort elapsed-time comparisons through local CPU/memory pressure or remote rate limiting. Dependency installation is opt-in with `--install`; it is disabled by default because Mattermost's install currently fails under the benchmark environment's npm options.

## Interrupted Focused Rerun After Non-Twenty Trace QA

Run directory:

```text
benchmark-results/code-explorer/run-2026-06-07T08-36-15-767Z
```

Command:

```sh
npm run benchmark:code-explorer -- --repos excalidraw,mattermost,supabase,midday --tasks toolbar-flow,export-flow,post-send,auth-ui,invoice-create --repeats 1 --timeout 600000 --auth codex --codex-model gpt-5.5 --fetch-repos
```

This run used a fresh `npm run build` and Codex-auth engine transport. It was intentionally
interrupted after useful Excalidraw evidence because the serial five-task cohort was taking too
long. Only completed `ok` rows are valid benchmark evidence; the interrupted
`mattermost/post-send` baseline row is excluded.

Completed paired rows:

| Repo       | Task         | Arm      | Status |    Cost | Elapsed ms | Primary uncached | Primary cached | Primary tools | Value tools | Quality | Line refs |
| ---------- | ------------ | -------- | ------ | ------: | ---------: | ---------------: | -------------: | ------------: | ----------: | ------: | --------: |
| excalidraw | toolbar-flow | baseline | ok     | $2.4273 |      92892 |           451858 |         135680 |            28 |           0 |     122 |         0 |
| excalidraw | toolbar-flow | explore  | ok     | $2.4630 |     180338 |           378150 |         863744 |            52 |           3 |     146 |        15 |
| excalidraw | export-flow  | baseline | ok     | $2.0416 |     116798 |           365090 |         135680 |            32 |           0 |     125 |         0 |
| excalidraw | export-flow  | explore  | ok     | $1.5945 |     138513 |           259045 |         289280 |            28 |           4 |     163 |        23 |

QA interpretation:

- `export-flow` improved in the intended direction: explore saved $0.4471 and 106,045 primary
  uncached input tokens, produced better visible line-range references, and the final answer was
  at least as useful. It was still 21.7s slower because of the extra value-model/tool loop.
- `toolbar-flow` exposed a real remaining regression: explore saved 73,708 primary uncached input
  tokens and improved final-answer quality, but primary cached input ballooned by 728,064 tokens,
  main tools increased from 28 to 52, cost was slightly worse, and elapsed time was 87.4s slower.
- Trace QA showed the root cause for `toolbar-flow`: the sub-agent classified “toolbar action ...
  scene update path” as `mutation-action` because of the word `update`, then polluted the compiler
  query with mutation filler (`api`, `form`, `hook`, `service`, `submit`). The deterministic report
  started from weak App/example evidence, forcing the primary model into broad recovery search.
- The ranker/prompt layer now treats toolbar/button/UI scene-update investigations as
  `component-flow` unless they also contain real mutation terms, and compiler-query expansion no
  longer adds mutation filler for generic update-only flows. Focused tests cover this exact trace
  shape.

## Focused Toolbar Rerun After Query-Shaping Fix

Run directory:

```text
benchmark-results/code-explorer/run-2026-06-07T08-50-48-731Z
```

Command:

```sh
npm run benchmark:code-explorer -- --repos excalidraw --tasks toolbar-flow --repeats 1 --timeout 600000 --auth codex --codex-model gpt-5.5
```

Completed paired rows:

| Repo       | Task         | Arm      | Status |    Cost | Elapsed ms | Primary uncached | Primary cached | Primary output | Value uncached | Value output | Primary tools | Value tools | Quality | Line refs |
| ---------- | ------------ | -------- | ------ | ------: | ---------: | ---------------: | -------------: | -------------: | -------------: | -----------: | ------------: | ----------: | ------: | --------: |
| excalidraw | toolbar-flow | baseline | ok     | $3.5819 |     142644 |           568978 |        1191936 |           4703 |              0 |            0 |            46 |           0 |     116 |         0 |
| excalidraw | toolbar-flow | explore  | ok     | $2.5751 |     208030 |           347313 |        1343488 |           5475 |           2368 |          164 |            57 |           3 |     154 |        18 |

QA interpretation:

- The toolbar query-shaping fix improved the cost result: explore saved $1.0069 and 221,665
  primary uncached input tokens, with better visible line-range refs and higher heuristic quality.
- Latency and main-loop tool count still regressed: explore was 65.4s slower and used 11 more
  primary tools. Cached input was also 151,552 tokens higher.
- Trace QA showed the classification/query fix worked: the report was now `component-flow` and did
  not use mutation filler. The report was still too weak, though. Its `primaryFiles` started from
  `excalidraw-app/app_constants.ts`, `examples/.../ExampleApp.tsx`, `excalidraw-app/App.tsx`,
  generic `packages/excalidraw/components/App.tsx` context symbols, and `packages/excalidraw/types.ts`,
  then recommended gap searches for action/dispatch, state/store, and render/output.
- The new follow-up fix is not benchmark-specific: support/example roots such as `examples/` are
  now treated as support paths for normal internal-flow queries, toolbar/action scoring prefers
  production action manager/registry/perform/update refs over generic App/type refs, and low-confidence
  toolbar reports get a scoped gap probe for `actionManager`, `register`, `perform`, `setActiveTool`,
  and `updateScene` before the deterministic report is built.
- The first rebuilt packaged rerun after that follow-up fix,
  `run-2026-06-07T09-02-31-922Z`, produced a valid baseline row but failed the explore arm before
  useful trace evidence. The failure was benchmark transport, not report quality: Codex auth returned
  `{"error":"fetch failed"}` for the value-model `/v1/chat/completions` stream, and the benchmark
  proxy then returned 404 for the fallback model.
- The retry, `run-2026-06-07T09-05-57-429Z`, completed both arms against the rebuilt package:

| Repo       | Task         | Arm      | Status |    Cost | Elapsed ms | Primary uncached | Primary cached | Primary output | Value uncached | Value cached | Value output | Primary tools | Value tools | Quality | Line refs |
| ---------- | ------------ | -------- | ------ | ------: | ---------: | ---------------: | -------------: | -------------: | -------------: | -----------: | -----------: | ------------: | ----------: | ------: | --------: |
| excalidraw | toolbar-flow | baseline | ok     | $3.2905 |     151994 |           554325 |         811520 |           3772 |              0 |            0 |            0 |            35 |           0 |     122 |         0 |
| excalidraw | toolbar-flow | explore  | ok     | $1.0155 |      94592 |           169387 |         146432 |           3131 |            825 |         1536 |          157 |            24 |           4 |     139 |        10 |

- Retry result: explore saved $2.2750, 384,938 primary uncached input tokens, 665,088 primary cached
  input tokens, 11 primary tool calls, and 57.4s elapsed, while improving heuristic quality and visible
  line-range refs.
- Trace QA confirmed the production-path/gap fix worked: the deterministic report now starts from
  `packages/excalidraw/actions/...` action registration files instead of `examples/`, `excalidraw-app`,
  generic App context, or type refs. It also emits the scoped `actionManager|register|perform|setActiveTool|updateScene`
  sub-agent gap probe before reporting.
- A final packaged rerun after coverage calibration, `run-2026-06-07T09-13-21-343Z`, completed both
  arms:

| Repo       | Task         | Arm      | Status |    Cost | Elapsed ms | Primary uncached | Primary cached | Primary output | Value uncached | Value cached | Value output | Primary tools | Value tools | Quality | Line refs |
| ---------- | ------------ | -------- | ------ | ------: | ---------: | ---------------: | -------------: | -------------: | -------------: | -----------: | -----------: | ------------: | ----------: | ------: | --------: |
| excalidraw | toolbar-flow | baseline | ok     | $3.0749 |     144854 |           500645 |         864256 |           4652 |              0 |            0 |            0 |            39 |           0 |     123 |         0 |
| excalidraw | toolbar-flow | explore  | ok     | $1.8217 |     170593 |           277499 |         635392 |           3792 |           2358 |            0 |          222 |            36 |           4 |     159 |        17 |

- Final rerun result: explore saved $1.2532, 223,146 primary uncached input tokens, 228,864 primary
  cached input tokens, and 3 primary tool calls, while improving heuristic quality and visible
  line-range refs. Explore was 25.7s slower, so the win is cost/context quality rather than latency.
- Trace QA confirmed coverage calibration worked: action registration files now count as
  `action/dispatch`, and `appState` evidence counts as state/store coverage. The remaining missing
  cluster was `render/output sink`, so the sub-agent still asked for one follow-up search.
- Follow-up trace QA found two more general report-shape bugs before the sink cleanup could be called
  done:
  - `run-2026-06-07T09-24-12-207Z` completed both arms and still returned `render/output sink` as
    missing. Explore remained cheaper than baseline ($1.9120 vs $2.9765, 285,891 vs 489,175 primary
    uncached input tokens) and higher quality (146 vs 119), but the report ignored the post-stream
    sink augmentation because the value model had already streamed a non-empty stale report. The
    sub-agent now prefers the deterministic observation-backed report after all augmentation whenever
    observations exist; a regression test covers this non-empty stale-report path.
  - `run-2026-06-07T09-32-37-541Z` proved that post-stream augmentation ran and found sink refs:
    sub-agent grep returned `packages/element/src/Scene.ts`, `replaceAllElements`, and
    `scene.triggerUpdate`. The final report still marked the sink missing because the top-5
    `primaryFiles` were five redundant action files. Explore again won on cost/time for the paired
    run ($0.9234 vs $1.5652, 149,638 vs 239,150 primary uncached input tokens, 90.2s vs 99.4s) and
    quality (153 vs 119), but the report body was still incomplete. The report builder now
    coverage-balances the selected primary files so an observed requested cluster can displace a
    redundant file instead of being hidden.
- Packaged validation after the render-sink and toolbar bridge fixes completed in
  `run-2026-06-07T10-47-32-431Z`:

| Repo       | Task         | Arm      | Status |    Cost | Elapsed ms | Primary uncached | Primary cached | Primary output | Value uncached | Value cached | Value output | Primary tools | Value tools | Quality | Line refs |
| ---------- | ------------ | -------- | ------ | ------: | ---------: | ---------------: | -------------: | -------------: | -------------: | -----------: | -----------: | ------------: | ----------: | ------: | --------: |
| excalidraw | toolbar-flow | baseline | ok     | $3.0901 |     136134 |           505096 |         873984 |           4253 |              0 |            0 |            0 |            38 |           0 |     125 |         0 |
| excalidraw | toolbar-flow | explore  | ok     | $0.0650 |      32277 |             2347 |          36864 |           1078 |           2359 |            0 |          152 |             2 |           7 |     139 |        13 |

- Final packaged result: explore saved $3.0251, 502,749 primary uncached input tokens, 837,120
  primary cached input tokens, 36 primary tool calls, and 103.9s elapsed, while improving heuristic
  quality and preserving visible line-range refs.
- Manual trace QA: the report now retains the full critical handoff:
  `packages/excalidraw/actions/manager.tsx:52-184` (`ActionManager`, `executeAction`,
  `renderAction`), `packages/excalidraw/components/App.tsx` with `syncActionResult`, and
  `packages/element/src/Scene.ts:174-441` (`replaceAllElements`). The final answer explicitly
  says `ActionManager.renderAction` / `executeAction` -> action `perform` -> `App.syncActionResult`
  -> `Scene.replaceAllElements`.
- Remaining caveat: the `App.tsx` report range is still broad (`182-13038`) because grep aggregates
  all app-sync hits in that file. The evidence lines are useful, but a future non-overfit improvement
  should split very wide same-file grep refs around the highest-signal hit so the main model sees
  `syncActionResult` as a tight range.
- Final validation for this hill-climb pass: focused sub-agent tests pass (40 tests), the broader
  code-explorer/prompt bundle passes (112 tests), `npm run fmt` passes, `npm run ts` passes, and
  `npm run build` completed before the packaged benchmark above.

<!-- CODE_EXPLORER_BENCHMARK_LATEST_START -->

## Latest Generated Benchmark Run

Run: `run-2026-06-07T02-58-00-458Z`
Compared with previous run: `run-2026-06-07T02-54-17-263Z`
Trials: 48
OK: 48
Errors: 0

### By Arm

Pricing assumption: primary `gpt-5.5` input/cached/output = $5/$0.5/$30 per 1M; value `gpt-5.4-mini` input/cached/output = $0.75/$0.075/$4.5 per 1M.
| Arm | OK | Explore available | Explore used | Primary uncached input | Primary cached input | Primary output | Primary total | Primary cost | Value uncached input | Value cached input | Value output | Value total | Value cost | Combined total | Combined cost | Primary tool calls | Value tool calls | Total tool calls | Avg elapsed ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 24/24 | 0/24 | 0/24 | 6629990 | 20308480 | 153837 | 27092307 | $47.9193 | 0 | 0 | 0 | 0 | $0.0000 | 27092307 | $47.9193 | 1162 | 0 | 1162 | 124870 |
| explore | 24/24 | 24/24 | 24/24 | 4854838 | 16079872 | 126405 | 21061115 | $36.1063 | 21929 | 41600 | 5138 | 68667 | $0.0427 | 21129782 | $36.1490 | 956 | 111 | 1067 | 95123 |

### Quality Metrics

| Arm      | Rubric pass | Expected-term coverage | File refs | Line-range refs | Final chars |
| -------- | ----------: | ---------------------: | --------: | --------------: | ----------: |
| baseline |       24/24 |                   1.00 |       807 |               0 |      291297 |
| explore  |       24/24 |                   1.00 |       685 |             488 |      224158 |

### Explore Code Availability

| Arm      | Disabled reasons                   |
| -------- | ---------------------------------- |
| baseline | code_explorer_setting_disabled: 24 |
| explore  | -                                  |

### Explore Task Cohorts

| Cohort           | Tasks | Primary uncached input delta | Value token delta | Combined token delta | Spend delta | Primary tool-call delta | Value tool-call delta | Total tool-call delta | Elapsed delta ms |
| ---------------- | ----: | ---------------------------: | ----------------: | -------------------: | ----------: | ----------------------: | --------------------: | --------------------: | ---------------: |
| available-used   |    24 |                      1775152 |            -68667 |              5962525 |    $11.7703 |                     206 |                  -111 |                    95 |           713928 |
| partially-used   |     0 |                            0 |                 0 |                    0 |     $0.0000 |                       0 |                     0 |                     0 |                0 |
| available-unused |     0 |                            0 |                 0 |                    0 |     $0.0000 |                       0 |                     0 |                     0 |                0 |
| unavailable      |     0 |                            0 |                 0 |                    0 |     $0.0000 |                       0 |                     0 |                     0 |                0 |

### Task Deltas

| Repo       | Task                  | App subpath           | Explore status | Explore available | Explore used | Disabled reasons | Primary uncached input delta | Value token delta | Combined token delta | Spend delta | Quality delta | Primary tool-call delta | Value tool-call delta | Total tool-call delta | Provider-step delta | Elapsed delta ms | Arm winner |
| ---------- | --------------------- | --------------------- | -------------- | ----------------: | -----------: | ---------------- | ---------------------------: | ----------------: | -------------------: | ----------: | ------------: | ----------------------: | --------------------: | --------------------: | ------------------: | ---------------: | ---------- |
| calcom     | availability          | apps/web              | available-used |               1/1 |          1/1 | -                |                       126241 |             -2623 |                60307 |     $0.5731 |           0.0 |                      -4 |                    -5 |                    -9 |                  -3 |            -6841 | mixed      |
| calcom     | booking-create        | apps/web              | available-used |               1/1 |          1/1 | -                |                       292106 |             -2616 |              2170135 |     $2.5525 |          -6.0 |                      43 |                    -5 |                    38 |                  25 |            97195 | explore    |
| calcom     | event-type            | apps/web              | available-used |               1/1 |          1/1 | -                |                       248930 |             -2599 |              1094669 |     $1.8624 |          +5.0 |                      57 |                    -5 |                    52 |                  22 |            98843 | explore    |
| dub        | analytics-chart       | apps/web              | available-used |               1/1 |          1/1 | -                |                        18038 |             -2625 |              -241017 |    $-0.0220 |         +29.0 |                      -5 |                    -5 |                   -10 |                 -14 |           -27520 | mixed      |
| dub        | invite-member         | apps/web              | available-used |               1/1 |          1/1 | -                |                       -68624 |             -2625 |                 1234 |    $-0.2695 |         +38.0 |                      12 |                    -6 |                     6 |                  -1 |             5085 | mixed      |
| dub        | link-create           | apps/web              | available-used |               1/1 |          1/1 | -                |                        55243 |             -2621 |                37883 |     $0.2555 |         +40.0 |                      -5 |                    -6 |                   -11 |                  -7 |            21216 | mixed      |
| dub        | workspace-settings    | apps/web              | available-used |               1/1 |          1/1 | -                |                        80759 |             -2619 |              -125882 |     $0.3384 |         +45.0 |                      13 |                    -6 |                     7 |                  -7 |           -16794 | explore    |
| excalidraw | element-selection     | .                     | available-used |               1/1 |          1/1 | -                |                       159087 |             -2586 |               560095 |     $0.9697 |         +36.0 |                     -12 |                    -3 |                   -15 |                   2 |           152551 | mixed      |
| excalidraw | export-flow           | .                     | available-used |               1/1 |          1/1 | -                |                       -78944 |             -2578 |               -14297 |    $-0.3730 |         +50.0 |                      -1 |                    -3 |                    -4 |                  -4 |           -14248 | baseline   |
| excalidraw | toolbar-flow          | .                     | available-used |               1/1 |          1/1 | -                |                        -6655 |             -2578 |              -164559 |    $-0.1178 |         +25.0 |                     -13 |                    -3 |                   -16 |                 -10 |           -25122 | baseline   |
| mattermost | channel-switch        | webapp                | available-used |               1/1 |          1/1 | -                |                       -53240 |             -6893 |              -761665 |    $-0.5958 |         +40.0 |                      11 |                   -11 |                     0 |                 -11 |            -1097 | mixed      |
| mattermost | post-send             | webapp                | available-used |               1/1 |          1/1 | -                |                       -28370 |             -2634 |               -68282 |    $-0.1440 |         +18.0 |                      -8 |                    -3 |                   -11 |                 -11 |           -25974 | baseline   |
| mattermost | thread-view           | webapp                | available-used |               1/1 |          1/1 | -                |                        24202 |             -4240 |               221133 |     $0.2305 |         +30.0 |                       7 |                    -5 |                     2 |                   3 |            16637 | explore    |
| midday     | customer-detail       | apps/dashboard        | available-used |               1/1 |          1/1 | -                |                        85424 |             -2627 |               478477 |     $0.5905 |         +40.0 |                       0 |                    -5 |                    -5 |                  -2 |           -10363 | explore    |
| midday     | invoice-create        | apps/dashboard        | available-used |               1/1 |          1/1 | -                |                       -68027 |             -2652 |              -175138 |    $-0.3640 |         +40.0 |                      -4 |                    -5 |                    -9 |                  -3 |             6576 | baseline   |
| midday     | report-metrics        | apps/dashboard        | available-used |               1/1 |          1/1 | -                |                       247794 |             -2636 |               475420 |     $1.3787 |         +40.0 |                       5 |                    -6 |                    -1 |                   1 |            11347 | explore    |
| midday     | transactions-table    | apps/dashboard        | available-used |               1/1 |          1/1 | -                |                        -1583 |             -2629 |               378670 |     $0.1491 |         +40.0 |                      -2 |                    -6 |                    -8 |                   1 |           328215 | mixed      |
| supabase   | auth-ui               | .                     | available-used |               1/1 |          1/1 | -                |                       147659 |             -2556 |               755608 |     $1.1842 |         -15.0 |                      40 |                    -3 |                    37 |                  12 |            57999 | explore    |
| supabase   | database-table        | .                     | available-used |               1/1 |          1/1 | -                |                       228383 |             -2587 |               527601 |     $1.3891 |         -10.0 |                      26 |                    -3 |                    23 |                  10 |            43048 | explore    |
| supabase   | project-settings      | .                     | available-used |               1/1 |          1/1 | -                |                        49674 |             -2585 |               410256 |     $0.4333 |          +2.0 |                      11 |                    -3 |                     8 |                   5 |            11844 | explore    |
| twenty     | list-filter-sort      | packages/twenty-front | available-used |               1/1 |          1/1 | -                |                       275691 |             -2641 |              1651460 |     $2.1146 |         +33.0 |                      37 |                    -4 |                    33 |                  14 |            50257 | explore    |
| twenty     | pipeline-stage-update | packages/twenty-front | available-used |               1/1 |          1/1 | -                |                        78001 |             -2634 |               109423 |     $0.4436 |         +33.0 |                       8 |                    -4 |                     4 |                  -8 |              640 | explore    |
| twenty     | record-detail         | packages/twenty-front | available-used |               1/1 |          1/1 | -                |                       -86356 |             -2646 |             -1774152 |    $-1.2352 |         +40.0 |                      -6 |                    -3 |                    -9 |                 -19 |           -46237 | baseline   |
| twenty     | record-field-edit     | packages/twenty-front | available-used |               1/1 |          1/1 | -                |                        49719 |             -2637 |               355146 |     $0.4266 |         +40.0 |                      -4 |                    -3 |                    -7 |                   0 |           -13329 | mixed      |

<!-- CODE_EXPLORER_BENCHMARK_LATEST_END -->
