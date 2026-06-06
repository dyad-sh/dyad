# Code Explorer Benchmark

Date: 2026-06-05 / 2026-06-06

## Summary

The benchmark launch failure was caused by the benchmark driver overriding `HOME` to a fresh temp directory before launching packaged Electron. On macOS, the app process started, printed main-process startup logs, and opened Chromium remote debugging, but Playwright never finished `electron.launch`.

The driver now keeps the normal `HOME` and only isolates benchmark-specific config with:

- `XDG_CONFIG_HOME=<trial user-data-dir>/xdg-config`
- `GIT_CONFIG_GLOBAL=<trial user-data-dir>/.gitconfig`
- `--user-data-dir=<trial user-data-dir>`

This fixes packaged Dyad startup. The benchmark now reaches app import and real Dyad Engine local-agent runs using `DYAD_PRO_KEY` from `.env`.

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

## Current Interpretation

The original startup blocker is fixed, and `code_search` is now absent when `explore_code` is enabled and ready.

After making the main agent prompt conditional and rebuilding packaged Electron, this single Excalidraw task flipped from negative to positive for `explore_code`: comparable final-answer quality, fewer tokens, fewer tool calls, fewer provider steps, and faster wall time. This is still only one task and one repeat, so the broader repo/task matrix is needed before drawing a product-level conclusion.

## Remaining Benchmark Work

Expand to the full repo/task matrix:

```sh
npm run benchmark:code-explorer -- --fetch-repos --repos excalidraw,mattermost,calcom,supabase --repeats 1 --timeout 600000 --concurrency 2
```

Use `--concurrency 2` as the starting point. Higher values will run more packaged Electron instances and real Dyad Engine streams at once, which can distort elapsed-time comparisons through local CPU/memory pressure or remote rate limiting.
