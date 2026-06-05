# Code Explorer Benchmark

Date: 2026-06-05

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
benchmark-results/code-explorer/run-2026-06-05T23-33-37-072Z
```

| Repo       | Task         | Arm      | Status | Elapsed ms | Tokens | Tool calls | Notes                                                                                          |
| ---------- | ------------ | -------- | ------ | ---------: | -----: | ---------: | ---------------------------------------------------------------------------------------------- |
| excalidraw | toolbar-flow | baseline | error  |     181593 |      0 |          0 | Timed out after the model invoked existing `code_search`; no stream finish event was recorded. |
| excalidraw | toolbar-flow | explore  | ok     |     125395 |  78388 |         42 | Used `explore_code` once and passed the rubric; about 2m 5s.                                   |

The `explore` trial recorded:

```json
{
  "totalTokens": 78388,
  "inputTokens": 75818,
  "outputTokens": 2570,
  "toolCallCount": 42,
  "providerStepCount": 25,
  "toolCallsByName": {
    "set_chat_summary": 1,
    "grep": 6,
    "list_files": 3,
    "explore_code": 1,
    "read_file": 31
  }
}
```

## Current Interpretation

The original startup blocker is fixed.

This run is still not a valid baseline-vs-experiment comparison because the baseline arm timed out in the existing tool path. The run does prove that the benchmark can now launch packaged Dyad, import Excalidraw, call the real Dyad Engine, expose `explore_code`, record benchmark events, and complete the experiment arm.

## Remaining Benchmark Work

Before expanding to the full repo matrix, fix or bound the baseline path that can hang after `code_search` starts. After that, rerun:

```sh
npm run benchmark:code-explorer -- --fetch-repos --repos excalidraw,mattermost,calcom,supabase --repeats 1 --timeout 600000
```
