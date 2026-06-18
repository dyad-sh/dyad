# Improve `explore_code`: optimize for cost and lean main-model context

> Written 2026-06-06, from analysis of benchmark run `run-2026-06-06T07-17-48-930Z`
> (4 repos × 12 tasks, baseline vs explore arm). Companion to
> [`plans/codex_code_explorer.md`](./codex_code_explorer.md) (original design) and
> [`BENCHMARK.md`](../benchmarks/code-explorer/BENCHMARK.md) (results).

## Summary

The value-model `explore_code` sub-agent reduces **primary-model spend on some tasks**
but does **not** reliably reduce cost, total tool calls, or elapsed time. The root cause,
for the cost/context objective, is that the sub-agent compresses source down to **bare
pointers** (`file:line - Symbol`) and instructs the main model to go `read_file` them. The
main model then re-reads the same ranges, so we pay the value model to read the code **and**
pay the $5/M primary model to read much of it again.

This plan targets one objective: **minimize source tokens that ever enter the main model's
context** (which is the same thing as minimizing cost). It is deliberately _not_ optimizing
elapsed time as the primary goal — latency fixes are tracked separately at the bottom and
must not be done in a way that bloats main context.

## Objective and target metric

- **Primary metric:** main-model **uncached input tokens** per task (`mainUncachedInputTokens`),
  measured over ≥3 repeats (medians).
- **Secondary metrics:** main-model cached input (`mainCachedInputTokens`) and main provider
  steps (`mainProviderStepCount`) — the cached-token multiplier.
- **Guardrail metric:** rubric pass / final-answer quality must not regress.
- **Cost is the headline, but value-model cost (`subagentCostUsd`) is a separate line** — do
  not let combined-token or total-tool-call metrics (which double-count sub-agent work) drive
  decisions.

## Why this is the right objective (cost model)

For the 9 "available-used" tasks, primary cost decomposes as:

| Cost term             | What it is                                                        | Share of primary cost |
| --------------------- | ----------------------------------------------------------------- | --------------------: |
| uncached input ($5/M) | each unique token read into main context (first time)             |              **~62%** |
| cached input ($0.5/M) | that same context re-sent on every later step (≈ context × steps) |                  ~26% |
| output ($30/M)        | tokens the main model writes                                      |                  ~12% |

**~89% of primary cost is source/tool-output living in the main context** — paid once at
$5/M when it enters, then again at $0.5/M on every subsequent provider step. "Don't bloat the
main context" and "cut cost" are the same goal; the dominant lever is **main uncached input**.

The damning result: across the 9 used tasks the sub-agent moved net main uncached input only
**1,364,339 → 1,329,429 (−2.6%)**. Focused wins (supabase/database-table 238k → 39k) were
cancelled by re-read blowups on broad tasks (excalidraw/element-selection 199k → **380k**). The
value model additionally read **334,791** uncached tokens — much of it duplicated by the main
model on the losing tasks. That double-read is the waste this plan removes.

## Evidence (from `runs.jsonl` ground truth)

Delta sign convention in `benchmarks/code-explorer/run.mjs` is `baseline − explore`
(positive = explore saved). Main-only figures:

| Task                         | main uncached Δ (saved) | cost Δ (saved) | main steps base→expl | explore_code calls | sub used compiler?          |
| ---------------------------- | ----------------------: | -------------: | -------------------- | -----------------: | --------------------------- |
| excalidraw/element-selection |            **−180,576** |     **−$1.53** | 21 → **42**          |                  1 | yes (broad → re-read storm) |
| excalidraw/export-flow       |                 +39,109 |         +$0.26 | 14 → 10              |                  3 | yes                         |
| excalidraw/toolbar-flow      |                 +30,396 |         +$0.40 | 22 → 25              |                  1 | yes                         |
| mattermost/channel-switch    |             **−88,504** |     **−$0.62** | 14 → **27**          |                  3 | **no (grep/list only)**     |
| mattermost/post-send         |             **−73,615** |     **−$0.51** | 14 → **32**          |                  1 | **no (grep/list only)**     |
| mattermost/thread-view       |                 +20,346 |         +$0.40 | 22 → 16              |                  1 | no                          |
| supabase/auth-ui             |                 +11,712 |         +$0.20 | 12 → 12              |                  1 | yes                         |
| supabase/database-table      |                +198,752 |         +$1.11 | 16 → 16              |                  5 | yes                         |
| supabase/project-settings    |                 +77,290 |         +$0.51 | 14 → 16              |                  2 | yes                         |

Key reads:

- **Cohort net cost saving is only ~$0.22 over 9 tasks (~$0.025/task)** and is concentrated;
  element-selection alone burned −$1.53 and −1.24M _combined_ tokens.
- **Main provider steps rose 149 → 196 (+32%)** — the sub-agent usually _adds_ main round-trips
  rather than removing them. Token savings on the wins come from _leaner context per step_
  (less unique source read), not fewer steps.
- The reports themselves are **high quality** (verified the database-table and
  element-selection reports — accurate symbols and tight ranges). The problem is **delivery
  and trust**, not recon quality. On a high-confidence element-selection report the main model
  still did 14 `grep` + 41 `read_file`.
- When the sub-agent skips the compiler and only greps (mattermost), `explore_code` becomes a
  second grep-agent layered on top of unchanged main work → the two worst regressions.

### Variance floor (don't overfit)

The 3 calcom tasks are `unavailable` (`tsconfig_not_found`) so `explore_code` never ran, and
both arms get identical prompts/tools. Yet the two no-op arms swing **+856,313** and
**−760,479** primary tokens. With `repeats=1` the noise floor is **~±0.7–0.9M combined tokens
per task** — larger than most per-task deltas. All conclusions must be validated with repeats.

## Highest-leverage change: pointer-map → compressed findings

Treat the value sub-agent as a **context compressor for the main model**. It is currently
mis-calibrated: it reads source then emits _bare pointers_ and tells the main model to read
them (`src/pro/main/ipc/handlers/local_agent/tools/explore_code_subagent.ts:398-414,460-490`).
Too lossy → the main model re-expands by re-reading.

Recalibrate the deliverable to **sufficient distilled findings**: the concrete symbols, the
data/control flow connecting them, and the specific facts the task needs — natural language,
**no raw source excerpts**, ~1 screen. A ~400-line source region compresses to a ~40-line
findings summary. The summary enters main context (small, paid once); the source stays in the
_value_ context (6.7× cheaper, then discarded). The main model reads raw source **only for the
precise lines it will edit**.

This is the only change that hits all three cost terms at once:

- **uncached ↓** — main reads the edit target, not 20–40 discovery files;
- **cached ↓** — smaller persistent context to re-send each step;
- **steps ↓** — fewer read→think→read round-trips.

### Concrete edits

1. **Rewrite the sub-agent report contract** (`explore_code_subagent.ts`):
   - System prompt (`buildExploreCodeSubagentSystemPrompt`, ~`:397`): change "tell the main
     agent exactly which files and line ranges to read next" to "state the findings the main
     agent needs to act, so it does **not** need to re-read for understanding." Keep
     "no large source excerpts," but require the _answer_ (what each symbol does, how the flow
     connects), not just where it lives.
   - Report shape (`buildExploreCodeSubagentPrompt` / `buildObservationSynthesisPrompt`,
     ~`:417,460`): replace "Read first: file:line - Symbol / Purpose / Evidence" +
     "Next primary action: one exact read_file" with a **Findings** section (flow + key
     symbols + the facts) and a single **Edit target** line naming the one range the main model
     should open to make the change. Drop the "go read these" framing.
2. **Enforce trust in the main prompt** (`src/prompts/local_agent_prompt.ts:106-108`):
   strengthen the existing "do not run broad grep/list*files after a usable report" into "treat
   a high/medium-confidence report as authoritative for understanding; only `read_file` the
   named edit target(s); re-search only for a specific contradiction or a file the report says
   it did not check." (Trust must be \_earned* by step 1's richer report — pointers don't earn it.)

## Supporting changes (ranked)

3. **Context firewall for heavy raw tool output.** Keep large `grep` dumps, 1000+-entry
   `list_files`, and big `read_file` results out of the _persistent main transcript_ — these
   are re-billed at cached rate every subsequent step. Route bulk search/listing through the
   value model; only distilled results land in main context. (Baseline element-selection dumped
   a 1,182-path recursive listing into context.) This is general agent-context hygiene,
   independent of `explore_code`, and complements step 1.
4. **Fewer, richer `explore_code` calls.** Each main step re-sends the whole context, so step
   count is the cached multiplier. database-table called it 5×, channel-switch 3×. Prefer one
   broad call returning a complete map. Lever: make the first report complete enough (step 1)
   that re-invocation is rare — avoid a hard "max calls" cap (overfits).
   - Status update: the main tool now has a chat-scoped report cache keyed by
     chat/app/tsconfig/query. Cached reports are reused only while every file named in the
     structured report has the same mtime and size, so repeated same-investigation calls can
     avoid a second value-model pass without reusing stale code after edits.
5. **Short-circuit when the compiler adds nothing.** When the sub-agent resolves a query using
   only `grep`/`list_files` (no raw `explore_code` signal — the mattermost case), that indicates
   the compiler isn't contributing; detect it and avoid paying for a full sub-agent + report
   layer on top of work the main model would do anyway. (See `buildExploreCodeSubagentTools`
   in `explore_code_subagent.ts:188` — the observation log already records which tools ran.)

## Explicitly out of scope for this objective

- **Do NOT inline raw source windows into the report.** Inlining is a _latency_ win (removes
  round-trips) but pushes raw source into the main context — directly bloating the thing we're
  keeping lean and raising both uncached and cached cost. Compress to findings; inline raw lines
  only for the eventual edit site. If latency becomes a goal later, this is a conscious tradeoff,
  not a default.

## Secondary track: latency (do not let it bloat context)

Separate from the cost objective, but recorded so it isn't lost. Elapsed regressed −409,761ms
across the cohort, concentrated in multi-call / cold-start cases (database-table −233,840 =
57%). Per-call wall-time: `read_file` ~3ms, `grep` ~53ms, **`explore_code` ~24,000ms (133,000ms
cold-start outlier)**.

- **Cache/reuse the TypeScript program across calls.** `src/ipc/processors/code_explorer.ts:104`
  spawns a fresh `Worker` and terminates it every call — no `ts.Program` reuse, so each raw call
  rebuilds the project (database-table re-indexed 8×). A persistent worker / cached Program keyed
  by `(appPath, tsconfig)`, invalidated on file change, removes most of the elapsed regression.
  This is purely latency-side and does not affect main-context size, so it is safe to land
  alongside the cost work.

## Measurement plan

0. **Fix mono-repo app/project discovery before adding more SaaS benchmarks.** Today an
   imported repo is treated too much like a single app root, which is why the Cal.com tasks are
   `unavailable` (`tsconfig_not_found`) even though the repo is TypeScript. Before expanding the
   corpus, teach both `explore_code` availability and the benchmark harness to understand
   mono-repo package roots:
   - Benchmark config should support a repo-level checkout plus a task/app-level `subPath` or
     `appPath` so one repo can contribute multiple package roots without re-cloning.
   - TypeScript readiness should search from the selected app root and, when needed, discover
     nearby workspace configs (`apps/*/tsconfig.json`, `packages/*/tsconfig.json`,
     `apps/web/tsconfig.json`, `apps/dashboard/tsconfig.json`) within a bounded workspace scan.
   - Project reference traversal should stay inside the checkout and record the chosen tsconfig
     path in benchmark metrics so unavailable tasks are diagnosable.
   - The benchmark summary should distinguish `repo root unavailable` from `selected package
unavailable` and show the selected app subpath.
   - Status update: benchmark config now supports `importSubPath` separately from `subPath`, so
     Cal.com/Dub/Twenty/Midday can import the checkout root while tasks still focus on the product
     app package. Generated summaries record both app subpath and import subpath.
   - Status update: workspace tsconfig discovery now prefers product app/front/dashboard configs
     over docs/examples/test configs. This fixed Cal.com root import selecting
     `apps/docs/tsconfig.json`; the focused smoke now selects `apps/web/tsconfig.json`.
   - Status update: when a task imports the repo root but focuses on a subpath, the benchmark
     harness now sets the app's existing `chatContext.contextPaths` to that subpath. For Cal.com,
     `apps/web/**/*` reduced the initial prompt from the earlier root-import shape of ~33M
     characters / ~8.3M estimated tokens to 4.84M characters / ~1.21M estimated tokens, while
     leaving local tools rooted at the checkout for sibling-package reachability.
   - Status update: focused root imports now derive a bounded set of related workspace package
     globs from the focused app's `tsconfig` path aliases and workspace package manifests. The
     selector deliberately ignores declaration-only `include` paths and generic test/support
     packages after a broader attempt pulled in `packages/app-store` and inflated Cal.com context
     to 9.17M characters.
   - Remaining issue: validate the focused app/package selector across Dub, Twenty, Midday, and
     other Cal.com tasks, then continue reducing broad grep/read follow-up after a usable report.
   - Status update: the sub-agent report now emits a structured `recommendedPrimaryAction`
     that tells the main model whether to answer from the report, read one edit target, or do a
     targeted gap search. The main prompt consumes this contract. Cal.com smoke runs verified
     correct app-relative paths and comparable answer quality, but primary follow-up remains
     heavy on broad implementation-flow tasks.
   - Status update: compiler search now normalizes mutation word forms such as "creating" to
     "create", drops generic exploration words from query terms, and penalizes test/support
     paths unless the query explicitly asks for tests. Focused tests cover nested benchmark
     checkouts, create-booking ranking, and implementation-vs-test-support ranking.
   - Status update: trace QA repeatedly found invalid primary `grep` regexes for exact snippets
     with punctuation such as `createBooking({`. The grep tool now supports `literal=true` for
     exact text searches, and invalid-regex output recommends literal mode for punctuation-heavy
     exact searches.
   - Status update: final-answer QA showed that line ranges from `explore_code` reports were
     often present only inside hidden tool transcript XML, not in the visible answer. The main
     prompt now tells the model to preserve useful ranges as `path:start-end` when answering
     with a code map.
   - Status update: `targeted_gap_search` recommendations now include concrete terms, likely
     scopes from observed files, and literal-mode advice instead of only abstract cluster names
     like `action/dispatch`. This is intended to reduce broad primary grep/read loops after a
     useful but incomplete report.
   - Status update: the Cal.com `booking-create` smoke after these prompt/report changes saved
     primary uncached tokens and improved visible line-range refs, but remained slower and still
     had heavy primary follow-up. Trace QA also showed the deterministic sub-agent ranker could
     promote `.test.ts` files above implementation files even after worker-side test/support
     penalties, so sub-agent report ranking now heavily demotes test/support paths unless the
     query explicitly asks for tests.
   - Status update: the follow-up smoke confirmed test-file demotion, but the report still
     started from generic booking action UI rather than the create-booking submission path. The
     deterministic ranker now normalizes mutation words, removes app/workspace/navigation filler
     from query terms, and boosts exact action-domain pairs like `createBooking` or
     `create-booking` over generic action/context files.
   - Status update: the packaged smoke after action-domain scoring was an explore win again on
     spend, primary uncached input, combined tokens, and primary tool calls, but trace QA showed
     the compiler-backed report still started from generic booking UI because the raw compiler
     query was still the full natural-language prompt. The sub-agent raw `explore_code` wrapper
     now normalizes verbose mutation prompts before compiler search, e.g. `creating a booking
starting in apps/web` becomes `create booking handle handler submit action mutation`.
1. Run `npm run benchmark:code-explorer:full` with **`--repeats 3` (or more) and
   `--concurrency 1`** (concurrency distorts elapsed and inflates cold-start; see `BENCHMARK.md`).
2. Compare **main-only** `mainUncachedInputTokens` (primary), `mainCachedInputTokens`, and
   `mainProviderStepCount` medians, baseline vs explore. Report value-model cost as a separate
   line.
3. Accept a change only if it moves **main uncached input** down beyond the variance floor and
   does not regress rubric pass / answer quality.
4. Update `summarizeTaskDeltas` winner logic (`run.mjs:1064`) to score on **primary** tokens +
   **main** tool calls (it currently uses combined tokens + total tool calls, double-counting the
   sub-agent).
5. Generated summaries now include a **Final Answer Comparison** table with a lightweight
   baseline/explore/tie verdict from expected-term coverage, quality-score deltas, reference
   density, and answer length. Use it to prioritize manual final-message QA; do not treat it as
   an LLM judge or a replacement for trace review.

## Benchmark corpus expansion: SaaS dashboard / CRM repos

Add these only after the mono-repo support above is in place. These repos are intended to test
`explore_code` on realistic product-dashboard workflows rather than canvas/editor workflows.

### `dubinc/dub`

Why: production-style SaaS dashboard with workspaces, link management, analytics, settings, and
invite/billing-adjacent flows. It should exercise Next.js routing, server actions/API routes,
shared packages, and dashboard UI state.

Suggested tasks:

| Task id              | Prompt                                                                                                                         | Expected terms          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `link-create`        | Trace the flow for creating a short link from dashboard UI submission to persistence/API call. Name the key files and symbols. | `link`, `create`        |
| `analytics-chart`    | Trace how link analytics data is fetched and rendered in the dashboard chart. Name the key files and symbols.                  | `analytics`, `chart`    |
| `workspace-settings` | Find how workspace settings are loaded, edited, and saved. Identify the main files and symbols involved.                       | `workspace`, `settings` |
| `invite-member`      | Trace the flow for inviting a teammate/member to a workspace. Name the key files and symbols.                                  | `invite`, `member`      |

### `twentyhq/twenty`

Why: closest match to a real CRM benchmark. It has object records, list/table views, field edits,
pipeline/opportunity-style flows, tasks, workspace concepts, and a large mono-repo structure.

Suggested tasks:

| Task id                 | Prompt                                                                                                                        | Expected terms      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `record-detail`         | Trace how a CRM record detail page is loaded and rendered. Name the key files and symbols.                                    | `record`, `detail`  |
| `record-field-edit`     | Find the implementation flow for editing a field on a CRM record and saving it. Identify the main files and symbols involved. | `field`, `record`   |
| `list-filter-sort`      | Trace how a list/table view applies filters and sorting. Name the key files and symbols.                                      | `filter`, `sort`    |
| `pipeline-stage-update` | Trace how a pipeline/opportunity stage change is handled from UI interaction to data update. Name the key files and symbols.  | `stage`, `pipeline` |

### `midday-ai/midday`

Why: SaaS-y business/finance dashboard with invoices, transactions, customers, reports, inbox-like
workflows, and workspace/team concepts. It complements Dub and Twenty with finance/accounting
domain flows and dashboard-heavy data presentation.

Suggested tasks:

| Task id              | Prompt                                                                                                                   | Expected terms         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| `invoice-create`     | Trace the flow for creating an invoice from dashboard UI to persistence/API call. Name the key files and symbols.        | `invoice`, `create`    |
| `transactions-table` | Find how transactions are fetched, filtered, and rendered in the table UI. Identify the main files and symbols involved. | `transaction`, `table` |
| `customer-detail`    | Trace how customer details are loaded and rendered. Name the key files and symbols.                                      | `customer`             |
| `report-metrics`     | Trace how dashboard/report metrics are fetched and displayed. Name the key files and symbols.                            | `report`, `metrics`    |

Acceptance criteria for adding a new benchmark repo:

- At least 3 tasks per repo; prefer 4 if each maps to a distinct product workflow.
- Each task must pass the mono-repo readiness gate with `explore_code` available unless the
  task is intentionally testing unavailable behavior.
- Each task needs a short manual QA note on the final answer after the first run: better,
  worse, or tie, with the reason.
- Do not tune prompts around known benchmark traces; tasks should be broad product-navigation
  questions a real agent would receive.

## Housekeeping

- **Fix the `BENCHMARK.md` prose sign error.** The "Full Suite QA" bullet (~`BENCHMARK.md:137`)
  calls `mattermost/channel-switch` and `post-send` the "strongest clean wins" for explore; the
  signed deltas show they are the worst regressions (`winner: baseline`; +256k/+315k primary
  tokens, +$0.62/+$0.51, +61s/+53s). Correct it so the next pass doesn't "protect" the two tasks
  explore hurt most.

## Ordered implementation sequence

1. Update benchmark scoring/metrics surface (main-only headline; winner formula) and fix the
   BENCHMARK.md sign error — cheap, makes the rest measurable.
2. Land mono-repo support for app/package-root discovery and tsconfig selection, then re-run the
   current Cal.com tasks to verify they are no longer falsely unavailable.
3. Add Dub, Twenty, and Midday benchmark entries with the SaaS/CRM tasks above.
4. Land the report-contract rewrite (step 1) + main-prompt trust enforcement (step 2).
5. Benchmark with repeats; confirm main uncached input drops beyond the noise floor with no
   quality regression.
6. Add the context firewall (step 3) and compiler short-circuit (step 5); re-benchmark.
7. Separately, add TS-program caching (latency track); re-benchmark elapsed at concurrency 1.

## Latest hill-climb status

Implemented after the latest full run:

- Sub-agent protocol stability: `dyad/value` now gets exactly one tool step, no provider retries,
  and tool failures are returned as observations unless the user aborted. This removed the
  provider `tool_calls` history corruption seen in earlier traces.
- Sub-agent app targeting: shared read-only tool resolution treats obvious current-app aliases
  (`current app`, `this app`, `active app`) as the current app, and the sub-agent prompt tells the
  value model to omit `app_name` for current-app inspection.
- Monorepo benchmark realism: repo tasks can import the checkout root while preserving a focused
  app subpath in the task prompt and generated metrics.
- Monorepo tsconfig ordering: root-level workspace discovery now prefers product app configs over
  docs/examples/test configs.
- Focus-aware root imports: benchmark trials now set existing app chat context paths when the
  selected app subpath is narrower than the import root, keeping the main prompt focused without
  disabling root-level local tools.
- Related package context: focused root imports now inspect workspace config plus focused-app
  `tsconfig` path aliases to add bounded implementation package globs. Declaration-only includes
  and generic test/support package roots are excluded to avoid reintroducing whole-monorepo prompt
  bloat.

Focused validation:

- `run-2026-06-06T22-34-58-792Z`: Cal.com `booking-create`, root import, both arms passed;
  explore saved $0.5105 and 64,275 primary uncached input tokens, but selected the wrong
  `apps/docs/tsconfig.json`.
- `run-2026-06-06T22-41-15-741Z`: same task after tsconfig ordering fix; explore selected
  `apps/web/tsconfig.json`, both arms passed and final-answer comparison tied, but baseline won
  this single repeat by $0.0921 and 1,150 primary uncached input tokens.
- `run-2026-06-06T22-49-29-497Z`: same task after applying `apps/web/**/*` as the app context
  path. Both arms passed and final-answer comparison tied. Explore selected `apps/web/tsconfig.json`
  and saved $0.5760, 18,365 primary uncached input tokens, and 972,207 combined tokens, but was
  286.5s slower and used 6 more total tool calls. The focused context reduced initial codebase
  extraction from the earlier root-import shape of ~33M characters / ~8.3M estimated tokens to
  4.84M characters / ~1.21M estimated tokens.
- `run-2026-06-06T23-04-32-962Z`: first related-package attempt included declaration-only
  `include` packages, including `packages/app-store`; Cal.com initial context rose to 9.17M
  characters / ~2.29M estimated tokens. It still saved $0.2986 and 14,840 primary uncached input
  tokens, but the selector was too broad.
- `run-2026-06-06T23-14-54-040Z`: tightened selector used `apps/web/**/*`,
  `packages/coss-ui/**/*`, `packages/lib/**/*`, and `packages/prisma/**/*`. Both arms passed and
  final-answer comparison tied. Explore saved $0.6653, 33,453 primary uncached input tokens,
  1,059,727 combined tokens, and 11.0s elapsed, but used 7 more total tool calls. Initial context
  was 6.04M characters / ~1.51M estimated tokens. Trace QA showed deterministic sub-agent
  reporting and no `subagent_synthesis_start`.
- `run-2026-06-07T00-23-39-115Z`: Cal.com `booking-create` after the sub-agent action contract
  and verbose mutation-query normalization. Explore remained the winner: it saved $0.2011, 14,528
  primary uncached input tokens, 229,709 combined tokens, and 8 provider steps. Final-answer QA
  favored explore by +36 quality with 18 visible line-range refs, but it was still 11.1s slower.
  Trace QA showed the main model recovered, but the deterministic report still began from generic
  booking action UI and under-scoped the recommended gap search for a workspace-package task.
- `run-2026-06-07T00-31-53-522Z`: same task after camelCase action-domain ranking and package
  search-scope fixes. Explore still won, but narrowly on spend: it saved $0.0188, 20,423 primary
  uncached input tokens, 2 primary tool calls, and 16 provider steps, while quality favored explore
  by +36 with 18 visible line-range refs. It was still 24.9s slower and used 261,829 more combined
  tokens due to higher cached input. Trace QA showed the deterministic report still marked
  workspace/package flow as covered without any `packages/...` primary file and recommended
  reading generic booking action UI.
- `run-2026-06-07T00-39-07-912Z`: first packaged rerun after workspace/package coverage. The
  coverage gate worked and explore saved $0.1114, 24,230 primary uncached input tokens, and
  112,966 combined tokens, but final-answer QA favored baseline by 9 points. Trace QA showed two
  general regressions: `packages` was truncated out of targeted gap-search scopes when several app
  scopes were present, and e2e/test-support files could still outrank implementation evidence.
- Latest focused fix: package/workspace gaps now force `packages` into the targeted search scope
  before app scopes, while non-package gaps keep app-local scopes first. The deterministic ranker
  also demotes `.e2e.ts(x)`, `/playwright/`, `/e2e/`, and `/fixtures/` paths unless the query asks
  for tests/e2e. Focused tests cover the trace-shaped scope truncation and e2e demotion cases.
- `run-2026-06-07T00-46-56-930Z`: packaged rerun after the latest rank/target fixes. Both arms
  passed. Explore saved $0.1157, 4,403 primary uncached input tokens, and 258,188 combined tokens;
  final-answer QA favored explore by +40 with 26 visible line-range refs and equal file-reference
  count. It was still 11.0s slower and used 18 more total tool calls. Trace QA confirmed the
  report now requires `workspace/package implementation`, scopes that gap first to `packages`, and
  no longer promotes the e2e/playwright file. The remaining bottleneck is report precision: the top
  file can still be generic booking display UI rather than the create-booking submission path, so
  the primary model still performs recovery searches and can still briefly try stale package aliases
  before correcting to `packages/platform/...`.
- Latest mutation-path rank patch: create/submit/form/hook/api/service paths get a mutation-query
  boost, while list/detail/success display paths are demoted. `run-2026-06-07T00-54-01-546Z`
  showed a stronger aggregate explore win: $0.1742 saved, 32,804 primary uncached input tokens
  saved, 23,807 combined tokens saved, 4 total tool calls saved, and +40 final-answer QA with 35
  visible line-range refs. Trace QA also caught the first version of the boost over-generalizing:
  it promoted an unrelated `ApiKeyDialogForm.tsx` because the path matched generic "api/form" terms
  without matching the domain term `booking`. The ranker now only applies mutation-path boosts when
  the path also includes a non-generic domain term, and penalizes off-domain generic mutation paths.
  Focused tests cover this regression; the final domain-guard tightening has not yet had a packaged
  smoke rerun.
- `run-2026-06-07T01-00-49-178Z`: packaged rerun after the domain guard. The API-key form dropped
  out of the report and explore produced the strongest single Cal.com smoke so far: $0.5555 saved,
  63,676 primary uncached input tokens saved, 437,051 combined tokens saved, 9 total tool calls
  saved, 4.0s faster, and +36 final-answer QA with 25 visible line-range refs. Trace QA still found
  two report-ranking issues: an off-domain signup API handler with `createCustomer` symbols became
  the top file, and a booking keyboard `.test.ts` support file still appeared in primary files. The
  ranker now uses a stronger penalty for off-domain generic mutation paths and a stronger
  non-test-query penalty for test/support paths. Focused tests cover both regressions; this final
  penalty tightening has not yet had a packaged smoke rerun.
- `run-2026-06-07T01-07-47-527Z`: packaged rerun after stronger off-domain/test penalties. This
  was an efficiency regression: baseline won by $0.3927, 50,686 primary uncached input tokens,
  399,258 combined tokens, 14 total tool calls, and 16.0s elapsed. Final-answer QA was only a tie,
  with explore +7 by heuristic and zero visible line ranges. Trace QA showed the off-domain signup
  and test-support files were gone, but the report regressed to read-only booking display/action
  files (`BookingActionsDropdown.tsx` plus booking detail/success pages). The compiler query now
  expands mutation prompts with `api`, `form`, `hook`, and `service`, and the ranker demotes
  dropdown/menu/list/detail/success display-control paths unless they also show mutation intent
  such as create/submit/form/hook/API/service. Focused tests cover the dropdown/list/success
  regression; this final query/ranking patch has not yet had a packaged smoke rerun.
- `run-2026-06-07T01-15-34-403Z`: packaged rerun after the query/ranking patch. Explore flipped
  back to a strong win: $0.5826 saved, 34,546 primary uncached input tokens saved, 910,593 combined
  tokens saved, and roughly half the primary cached input. The value-model spend was only $0.0014.
  Final-answer QA favored explore by +46 with 30 visible line-range refs, while baseline had none.
  It was still 2.0s slower and used more tools overall (63 primary + 3 value vs 54 primary
  baseline), so the remaining optimization is still main-loop trust and re-read reduction rather
  than sub-agent cost. Trace QA also exposed a benchmark instrumentation gap: `events.jsonl`
  recorded tool names, timing, and token usage, but not tool arguments or the `explore_code` report
  body, so report-level QA was weaker than final-answer QA. Benchmark-only trace logging now records
  bounded `argsPreview` and `resultPreview` fields for main and sub-agent tool calls.
- `run-2026-06-07T01-28-26-271Z`: first packaged smoke with bounded trace previews. Explore saved
  $0.1591 and 403,378 combined tokens, and final-answer QA favored explore by +40 with 24 visible
  line-range refs, but it still used 7,436 more primary uncached tokens, 18 more total tools, and
  ran 6.5s slower. Trace QA showed the report itself was still weak because the value-model query
  polluted the compiler search with navigation/display filler (`route page component starts sends`),
  causing the report to promote display/action UI and ask for another targeted gap search. The
  compiler query builder now drops that filler from mutation-action queries before adding
  action/API/form/hook/service terms.
- `run-2026-06-07T01-33-53-908Z`: packaged rerun after the filler drop. Explore saved $0.5858,
  42,055 primary uncached input tokens, 768,928 combined tokens, and 8.8s elapsed; final-answer QA
  favored explore by +40 with 27 visible line-range refs. Trace QA still showed broad route/page
  `grep`/`list_files` observations outranking useful compiler-backed mutation/package evidence in
  the deterministic report. The ranker now gives strong compiler symbol windows a larger source
  prior, demotes route/page display paths for mutation-flow queries unless the path itself shows
  mutation intent, and only boosts `packages/...` mutation files when the raw query asks for
  workspace/package/monorepo evidence. Focused tests cover this trace shape without hard-coding the
  benchmark repository.
- `run-2026-06-07T01-43-30-768Z`: packaged rerun after that ranking/source-priority patch. This
  was an efficiency regression: baseline won by $0.3807, 33,154 primary uncached input tokens,
  333,867 combined tokens, 29 total tool calls, and 60.8s elapsed, while final-answer QA still
  favored explore by +40. Trace QA showed the compiler query still included broad mutation-role
  filler (`look/actions/clients/server/types`), and the report started from off-domain signup
  `createCustomer` and `.test.ts` keyboard-handler support files, forcing the primary model to
  recover manually with many reads.
- `run-2026-06-07T01-50-28-522Z`: packaged rerun after stripping that role filler from mutation
  compiler and gap-search terms. Explore recovered to an aggregate win: $0.4114 saved, 36,230
  primary uncached input tokens saved, 435,049 combined tokens saved, 3 total tool calls saved, and
  8.9s faster; final-answer QA favored explore by +37 with 24 visible line-range refs. Trace QA
  still found the deterministic report could rank off-domain generic mutation files and `.test.ts`
  support files too high when the raw compiler result is poor, so the ranker now applies stronger
  off-domain generic mutation and non-test-query support-file penalties. Focused tests and
  typecheck pass; this final penalty tightening has not yet had another packaged smoke rerun.
- `run-2026-06-07T01-59-12-602Z`: packaged rerun after moving mutation/domain scoring down into
  the compiler worker. The raw compiler report improved: the top file became
  `apps/web/modules/bookings/hooks/useBookings.ts` instead of signup/test support. Explore saved
  $0.4864, 25,586 primary uncached input tokens, 741,310 combined tokens, 8 total tool calls, and
  18.7s elapsed; final-answer QA favored explore by +40 with 22 visible line-range refs. The arm
  winner remains `mixed` because explore still had 5 more primary tool calls. Trace QA showed one
  remaining report-noise pattern: display/list files such as `BookingListContainer.tsx` can still
  appear when they match the domain but not the mutation intent. The worker now demotes
  list/log/history/container display paths for mutation queries unless the path has mutation
  intent. Focused tests and typecheck pass; this final display demotion has not yet had a packaged
  rerun.
- `run-2026-06-07T02-06-48-212Z`: packaged rerun after the worker display/list demotion. Both
  arms completed. Explore saved $0.3813, 22,034 primary uncached input tokens, 613,026 combined
  tokens, and 4 total tool calls; final-answer QA favored explore by +40 with 32 visible line-range
  refs. It was 24.0s slower. Trace QA confirmed the prior list/container file disappeared, but the
  deterministic report still filled `primaryFiles` with broad route grep hits after the
  compiler-backed `useBookings.ts` while package implementation remained missing. The report builder
  now removes low-signal route/display `grep` and `list_files` refs from mutation primary files when
  compiler signal is strong, and removes weaker duplicate `list_files` refs for paths already covered
  by concrete source refs. Focused tests cover this final report-primary filtering; it has not yet had
  another packaged rerun.
- `run-2026-06-07T02-15-01-342Z`: packaged rerun after report-primary filtering. The filter worked:
  route-page files no longer filled `primaryFiles`. Explore still saved $0.1063, 16,386 primary
  uncached input tokens, and 88,125 combined tokens, and final-answer QA favored explore by +40 with
  34 visible line-range refs. It was 34.8s slower and used 26 more total tool calls. Trace QA showed
  the next report-shaping issue: low-signal sibling-app grep refs under `apps/api/v2` became primary
  files and then steered `targeted_gap_search` scopes into that sibling app. The report builder now
  derives gap-search scopes only from compiler/read refs, not grep/list refs, while still forcing
  `packages` for workspace/package gaps. Focused tests cover this sibling-app scope pollution; this
  final scope-derivation fix has not yet had a packaged rerun.
- `run-2026-06-07T02-23-22-247Z`: packaged rerun after scope derivation. The sibling-app scope fix
  worked: package gap-search targets no longer included `apps/api/v2`. Explore saved $0.1074,
  20,157 primary tokens, and 23,850 combined tokens, and final-answer QA favored explore by +32 with
  16 visible line-range refs. It was still 10.4s slower and used 7 more total tool calls. Trace QA
  showed the next sparse-candidate issue: a booking keyboard `.test.ts` support file still appeared
  in `primaryFiles` for a production booking-creation flow. The primary-file policy now filters
  test/support refs out of non-test reports when implementation refs exist.
- `run-2026-06-07T02-27-54-791Z`: packaged rerun after filtering test/support refs from report
  primary files. Explore saved $0.6517, 41,356 primary uncached input tokens, 894,909 combined
  tokens, 9 primary tool calls, and 24.9s elapsed, with final-answer QA +32. Trace QA confirmed the
  `.test.ts` support file disappeared from `primaryFiles`. A small query-term cleanup now prevents
  filler words such as `when` from leaking into generated gap-search terms; focused tests cover it.
- `run-2026-06-07T02-38-02-739Z`: packaged rerun after deterministic package augmentation. The
  augmentation worked: a sub-agent package grep found `packages/features/bookings/lib/create-booking.ts`,
  `packages/features/bookings/lib/handleNewBooking/createBooking.ts`, and service files before the
  report was built. Explore saved $0.2136, 5,451 primary uncached tokens, 291,563 combined tokens,
  5 primary tool calls, and 70.0s elapsed; final-answer QA favored explore by +40 with 35 line-range
  refs. Trace QA exposed the next report-ranking issue: package contract/audit files could outrank
  implementation files and become the edit target. The ranker now demotes mutation contract/type
  files and off-query audit/report/history files unless the query asks for those concerns. Focused
  tests cover augmentation plus implementation-over-contract/audit ranking.
- `run-2026-06-07T02-54-17-263Z`: packaged rerun after the contract/audit demotion and bounded
  package source enrichment. The report now starts with
  `packages/features/bookings/lib/create-booking.ts:1-85` and
  `packages/features/bookings/lib/handleNewBooking/createBooking.ts:19-273`; interface/audit/report
  distractors no longer become the edit target. The enrichment adds one value-side `read_file` for
  the top package implementation hit, giving the primary model import/call evidence without broad
  follow-up search. Explore saved $1.3270, 116,911 primary uncached input tokens, 1,353,448 combined
  tokens, 42 primary tool calls, and 69.1s elapsed on this paired smoke. The heuristic quality score
  favored baseline by 10 because its final answer was much longer, so treat the quality result as
  acceptable but not a proof of superiority.
- `run-2026-06-07T02-58-00-458Z`: full-suite rerun after the package-report hill climb. It completed
  48/48 trials across Excalidraw, Mattermost, Cal.com, Supabase, Dub, Twenty, and Midday with no
  timeouts. Explore was available and used on every explore trial. Aggregate explore spend was
  $36.1490 vs $47.9193 baseline, saving $11.7703 (24.6%). Primary uncached input dropped by
  1,775,152 tokens, primary cached input dropped by 4,228,608 tokens, and primary tool calls dropped
  by 206. The value sub-agent added only 68,667 tokens, 111 tool calls, and $0.0427, about 0.12% of
  explore spend. Both arms passed 24/24 rubric checks with full expected-term coverage; explore had
  fewer final-answer characters but 488 visible line-range refs vs 0 for baseline and a higher
  heuristic quality score. Aggregate elapsed time improved by 713.9s, but this is secondary because
  the run used `--concurrency 2` and hit local memory pressure during Twenty. Remaining baseline
  winners to QA are `excalidraw/export-flow`, `excalidraw/toolbar-flow`, `mattermost/post-send`,
  `midday/invoice-create`, and `twenty/record-detail`.

Interpretation:

- The path/config correctness fix is real. It removes an arbitrary docs-project default and makes
  root-import monorepo benchmarks more faithful.
- Root import with app context paths is a better general shape than importing only the package root
  or dumping the whole checkout into the prompt: tools can still inspect sibling packages, while
  the starting context is focused on the app under test.
- Bounded related package context and deterministic package source enrichment now have full-suite
  validation as net cost/token wins, not just Cal.com smoke wins. The remaining optimization is less
  about package reachability and more about task-specific cases where the report is already good but
  the main model still repeats broad grep/read exploration, or where the report is not needed for
  simple tasks.
- Benchmark trace logging now retains bounded tool arguments and results, which should make the
  next trace QA pass more direct. The remaining measurement gap is using the report body to measure
  unnecessary main-model follow-up after a high/medium-confidence report.
- Targeted baseline-winner hill climb:
  - `run-2026-06-07T03-51-38-147Z` reran Excalidraw export/toolbar, Mattermost post-send, Midday
    invoice-create, and Twenty record-detail. Explore saved $5.3984 on the cohort and produced
    143 line-range refs vs 0 baseline, but trace QA showed Excalidraw export and Twenty record-detail
    reports still started from generic compiler/listing evidence.
  - Deterministic gap augmentation now runs only when confidence is low, critical coverage is missing,
    or no primary file has query-specific signal. Export flows get a scoped `exportTo` probe; route
    flows get scoped pages/routes/navigation probes based on the route domain term.
  - `run-2026-06-07T04-04-51-036Z` validated the export improvement. Excalidraw export now starts
    from `packages/excalidraw/scene/export.ts` and cost dropped to $0.6767 vs $1.1028 baseline.
    Aggregate targeted cost was $8.2758 explore vs $10.3228 baseline. Twenty still over-accepted
    generated/story/page-layout evidence as record-detail route coverage.
  - Generated/story/codegen/docs/mocks paths are now excluded from coverage claims, route classification
    takes precedence over component classification, and route coverage for detail-page tasks now
    requires detail/show/object-record/record-page identity from path/symbols, not evidence-only imports.
    A Dyad Pro rerun (`run-2026-06-07T04-29-44-888Z`) hit the account budget and exposed a runner
    failure-path scoping bug, which is now fixed. A Codex-auth rerun
    (`run-2026-06-07T04-31-28-417Z`) confirmed the report no longer recommends answering or an edit
    target for the bad side-panel route evidence; it marks `route/page entry` missing and sends the
    primary model to targeted gap search. Explore saved $0.4166, 123,186 combined tokens, and 4 total
    tool calls on that run, with final-answer QA +40. Trace QA then found support-script noise
    (`scripts/mock-data/*`) in primary files/search scopes; the report builder now filters support
    refs before route policy, treats mock-data scripts as support, and derives explicit query scopes
    such as `packages/twenty-front`. A final Codex-auth packaged rerun
    (`run-2026-06-07T04-42-05-865Z`) validated that cleanup: `scripts/mock-data/*` disappeared from
    `primaryFiles` and search scopes, the report kept `editTarget: null`, and explore saved $1.2207,
    252,193 combined tokens, 239,407 uncached input tokens, and 11 total tool calls with QA +40.
    A final stopword cleanup removed generic `loaded`/`rendered` from search terms; focused tests and
    typecheck pass.
  - Non-Twenty trace QA then inspected Excalidraw export/toolbar, Mattermost post-send, Supabase auth
    UI, and Midday invoice-create failures from the full-suite run. The next general fixes were:
    auth login/signup strict-domain scoring now demotes Auth Hooks customization screens; post-send
    scoring prefers UI submit handlers over reaction components; requested app-scope scoring demotes
    CLI paths without suppressing package implementations; export/toolbar confidence requires real
    export/action signal rather than generic App/types refs; command/search UI is demoted unless the
    query asks for command/search; and exact code-looking identifiers such as `createBookingMutation`
    can steer verification read targets without treating prose words as symbols. Focused tests cover
    these cases.
  - A fresh Codex-auth focused rerun after those changes,
    `run-2026-06-07T08-36-15-767Z`, was interrupted after the Excalidraw pairs because the serial
    five-task cohort was taking too long. Valid completed rows showed `export-flow` improved
    materially (explore saved $0.4471 and 106,045 primary uncached tokens, with better line-range
    final answers), but `toolbar-flow` still regressed on spend/latency despite better quality
    (cost +$0.0356, elapsed +87.4s, primary tools 52 vs 28). Trace QA found the report was still
    classified as `mutation-action` due the phrase "scene update path", causing mutation compiler
    filler (`api`, `form`, `hook`, `service`, `submit`) to pollute a toolbar investigation.
    Toolbar/button/UI scene-update queries now classify as `component-flow` unless they also contain
    real mutation terms, and compiler-query expansion no longer treats generic update-only flows as
    mutation searches.
  - The targeted packaged toolbar rerun after that query-shaping fix,
    `run-2026-06-07T08-50-48-731Z`, confirmed the fix moved cost in the right direction: explore
    saved $1.0069 and 221,665 primary uncached input tokens, while preserving better line-range
    final-answer references. It still regressed on elapsed time (+65.4s), primary tools (+11), and
    cached input (+151,552). Trace QA showed classification was fixed (`component-flow`, no mutation
    filler), but the report still started from weak `examples/`, `excalidraw-app`, generic App
    context, and type refs before asking the primary model to recover with gap searches.
  - The next non-overfit toolbar fix treats root `examples/` as support for normal internal-flow
    queries, boosts production toolbar/action manager/registry/perform/update refs over generic
    App/type refs, and adds a scoped low-confidence toolbar gap probe for `actionManager`,
    `register`, `perform`, `setActiveTool`, and `updateScene` before deterministic reporting.
    The first rebuilt packaged rerun after this fix (`run-2026-06-07T09-02-31-922Z`) hit a Codex
    transport failure in the explore arm before useful trace evidence, but the retry
    (`run-2026-06-07T09-05-57-429Z`) completed both arms and strongly favored explore: $1.0155 vs
    $3.2905, 169,387 vs 554,325 primary uncached input tokens, 146,432 vs 811,520 primary cached
    input tokens, 24 vs 35 primary tools, and 94.6s vs 152.0s elapsed. Trace QA confirmed the report
    now starts from production `packages/excalidraw/actions/...` refs instead of examples/generic
    App/type refs.
  - The latest trace still showed a report-calibration issue: action registration refs such as
    `register({ ... perform(...) ... })` were not counted as `action/dispatch` coverage because the
    detector missed camelCase action symbols and register/perform evidence. Coverage now counts
    `/actions/` paths plus `register`/`perform` evidence for action/dispatch and `appState` for
    state/store coverage. The packaged rerun after that cleanup,
    `run-2026-06-07T09-13-21-343Z`, still favored explore on cost/context: $1.8217 vs $3.0749,
    277,499 vs 500,645 primary uncached input tokens, 635,392 vs 864,256 primary cached input
    tokens, 36 vs 39 primary tools, and 17 vs 0 visible line refs. It regressed latency by 25.7s.
    Trace QA confirmed action/state coverage was fixed, leaving only `render/output sink` missing.
  - Follow-up packaged reruns exposed two more non-overfit report bugs. In
    `run-2026-06-07T09-24-12-207Z`, explore saved cost and tokens but still reported
    `render/output sink` as missing because post-stream augmentation observations were ignored when
    the value model had already returned non-empty report text. The sub-agent now returns the
    deterministic observation-backed report after augmentation whenever observations exist, and a
    focused regression covers the stale non-empty report path.
  - In `run-2026-06-07T09-32-37-541Z`, sub-agent trace events proved the sink grep ran and found
    `packages/element/src/Scene.ts`, `replaceAllElements`, and `scene.triggerUpdate`, but the final
    report still omitted them because the top-5 `primaryFiles` were all action refs. The deterministic
    report builder now coverage-balances selected primary files so each observed requested cluster can
    survive into the final report instead of being crowded out by redundant high-ranking refs.
  - Packaged confirmation is complete after the render-sink and toolbar bridge fixes. The final
    targeted toolbar smoke, `run-2026-06-07T10-47-32-431Z`, favored explore strongly: $0.0650 vs
    $3.0901, 2,347 vs 505,096 primary uncached input tokens, 36,864 vs 873,984 primary cached input
    tokens, 2 vs 38 primary tool calls, 32.3s vs 136.1s elapsed, and quality 139 vs 125. Manual QA
    confirmed the report now carries the critical flow:
    `ActionManager.renderAction` / `executeAction` -> action `perform` -> `App.syncActionResult`
    -> `Scene.replaceAllElements`.
  - The final implementation changes are general, not benchmark guards: post-augmentation
    deterministic reporting, coverage-balanced primary file selection, render-sink ownership guards
    for type/API/helper/UI callers, toolbar action bridge augmentation, scoped app-sync augmentation,
    and stricter bridge identity so generic `renderAction` panel/type refs do not crowd out
    `App.syncActionResult`.
  - Remaining non-overfit follow-up: split very wide same-file grep refs around their strongest
    evidence line. The final report includes `App.tsx` and `syncActionResult`, but as a broad
    `182-13038` range because grep aggregates all app-sync hits in one file.

## Risks and mitigations

- **Distilled findings omit something the main model needs → it re-reads anyway.** Mitigate by
  requiring the report to name the exact edit target and the facts about it; measure re-read rate
  (main `read_file` count after a high/medium report) as a regression signal.
- **Stronger "trust the report" prompt causes the main model to act on a wrong report.** Mitigate
  by keeping the confidence field authoritative — trust enforcement applies only to high/medium
  confidence; low confidence keeps today's manual-search guidance.
- **Single-repeat noise hides real effects.** Mitigate with ≥3 repeats and main-only medians;
  the calcom no-op arms (±0.7–0.9M) define the floor.
