# Code Explorer Tool Experiment

## Summary

Add a default-off Settings experiment for a read-only local-agent tool named `explore_code`. The tool will use the TypeScript compiler API in an off-thread worker to build an in-memory code graph for TypeScript projects and return focused, line-numbered source windows for codebase-understanding queries.

This is intentionally an experiment. It should only be enabled for an app when the target app has TypeScript installed and configured, so the agent does not advertise or call a code explorer that would behave inconsistently on non-TypeScript projects.

## Goals

- Give the local agent a higher-signal way to inspect TypeScript code than repeated `list_files`, `grep`, and `read_file` calls.
- Reduce tokens, tool calls, and elapsed time for realistic codebase-navigation tasks.
- Keep the implementation local, read-only, and safe for ask/plan/local-agent modes.
- Prove the value with one functional E2E test and a real-LLM benchmark study across realistic repositories.

## Non-Goals

- Building a general-purpose language server UI.
- Supporting non-TypeScript languages in v1.
- Persisting a database such as SQLite.
- Replacing `grep`, `read_file`, or `code_search`.
- Running the benchmark in normal CI.

## Settings Experiment

Add a top-level user setting:

```ts
enableCodeExplorer: boolean; // default false
```

Implementation requirements:

- Add the setting to the user settings schema and defaults.
- Add it to the Settings search index.
- Add a switch under Settings > Experiments labeled `Enable code explorer`.
- Do not add this to `ExperimentsSchema`; use the same top-level settings pattern as other newer experiments.
- When the setting is disabled, `explore_code` must be absent from local-agent tool definitions, prompt hints, and request snapshots.

## Tool Interface

Tool name:

```txt
explore_code
```

Input schema:

```ts
{
  query: string;
  app_name?: string;
  tsconfig_path?: string;
  max_files?: number; // default 5, min 1, max 8
  max_depth?: number; // default 2, min 0, max 3
}
```

Tool behavior:

- Read-only; no `modifiesState`.
- Available in ask, plan, and local-agent modes only when the experiment is enabled and the target app is TypeScript-ready.
- Validate `tsconfig_path` as app-relative and non-escaping.
- Resolve `app_name` through the existing local-agent app context flow.
- Return a user/project precondition error when TypeScript is not installed or no usable tsconfig is configured.

Tool output should be Markdown suitable for both the model and chat rendering:

````md
## Code exploration: <query>

Found <symbolCount> symbols across <fileCount> files.
Indexed <indexedFileCount> files in <indexMs>ms; searched in <searchMs>ms.

#### src/path/file.ts - AuthService.login, createSession

```ts
42 export class AuthService {
43   async login(...) {
44     return createSession(...);
45   }
```
````

Include truncation notes when file, line, or character caps are hit.

## TypeScript Readiness Gate

The tool should only be enabled for a target app when all of these are true:

- The app has a usable TypeScript package resolvable from the app root.
- A tsconfig is found through `tsconfig_path`, `tsconfig.app.json`, or `tsconfig.json`.
- The parsed config contains source files, or project references that resolve to source files within a bounded cap.

If any condition fails:

- Do not include `explore_code` in the tool set for that app when the app context is known before request construction.
- If the app context is only resolved at execution time, fail with `DyadErrorKind.Precondition` and a concise message such as `Code explorer requires TypeScript to be installed and configured in this app.`

This differs from the existing TS checker fallback behavior: `explore_code` should not use bundled Dyad TypeScript to explore arbitrary projects. The experiment is meant to measure TypeScript-aware navigation on projects that are actually configured for TypeScript.

## Implementation Design

### Worker

Add a dedicated worker modeled after the existing TypeScript checker worker:

- New worker entry for code exploration.
- Shared protocol types for worker requests/responses.
- Main-process processor/service that owns worker lifecycle, request IDs, timeouts, and idle termination.
- One cached worker/index per app path plus tsconfig path.
- Idle termination after a fixed timeout, for example 10 minutes.

The worker should load TypeScript from the target app using Node resolution from the app root. If that fails, report the precondition error instead of falling back to Dyad's bundled TypeScript.

Recommended implementation split:

- `shared/code_explorer_types.ts`: worker input/output and rendered result types only.
- `workers/code_explorer/core/*`: pure TypeScript compiler API core with no Electron imports.
- `workers/code_explorer/code_explorer_worker.ts`: thin `parentPort` wrapper around the pure core.
- `src/ipc/processors/code_explorer.ts`: main-process worker orchestrator.
- `src/pro/main/ipc/handlers/local_agent/tools/explore_code.ts`: local-agent tool wrapper.

The pure core should be importable from unit tests without launching Electron. Every core function should receive the app-local `typescript` module as an injected dependency instead of importing `typescript` directly.

Worker build wiring:

- Add a worker Vite config for the code explorer worker.
- Add a Forge build entry so `code_explorer_worker.js` is emitted next to the existing worker outputs.
- Keep Node built-ins external.
- Keep `typescript` external so resolution comes from the target app, not from Dyad.

### Project Discovery

Config selection order:

1. Explicit `tsconfig_path`, if provided.
2. `tsconfig.app.json`.
3. `tsconfig.json`.

Project reference handling:

- If the selected config has no direct source files but has project references, follow references up to a small fixed cap.
- Keep all referenced configs inside the app directory.
- Return a precondition error if no source files are discovered.

### Graph Construction

Build an in-memory graph from the TypeScript Program / Language Service:

- Nodes: files, classes, interfaces, functions, methods, variables, properties, type aliases, enums.
- Include arrow functions assigned to constants and object methods where TypeScript exposes useful declarations.
- Edges: contains, imports, calls, references, extends, implements.
- Resolve aliases where practical through the TypeScript checker.
- Stable IDs: app-relative file path, symbol kind, qualified name, and declaration start.

Suggested pure-core modules:

- `program.ts`: discover/parse tsconfig and create the TypeScript Program.
- `indexer.ts`: walk source files, create graph nodes, and populate graph edges.
- `search.ts`: extract query terms and score candidate symbols.
- `expand.ts`: run bounded bidirectional graph traversal.
- `render.ts`: group selected symbols by file and emit capped source windows.
- `index.ts`: single `exploreCode(ts, input)` entrypoint used by the worker and tests.

### Search And Expansion

Follow the approach from `~/codegraph/NOTES.md`:

- Extract meaningful terms from the query.
- Score exact symbol names, qualified-name matches, prefix matches, contains matches, file basename hits, and directory hits.
- Boost classes/functions/methods slightly.
- Down-weight tests unless the query includes test-oriented terms such as `test`, `spec`, or `vitest`.
- Pick root symbols, then run bounded bidirectional BFS across graph edges.
- Score files by root hits, proximity, lexical matches, and symbol density.
- Return at most `max_files`.

Source-window caps:

- Default `max_files`: 5.
- Hard max files: 8.
- Line padding around symbols: 4.
- Merge ranges within 12 lines.
- Max windows per file: 3.
- Max lines per file: 120.
- Max total returned lines: 450.
- Max returned characters: about 40k.

## Chat Rendering

Add support for a new custom tag:

```xml
<dyad-explore-code>...</dyad-explore-code>
```

Renderer behavior:

- Compact completed card with a code/search icon, query, file count, symbol count, and timing.
- Expanded state shows the Markdown/source windows.
- Loading state mirrors existing local-agent tool cards.
- Error state shows the precondition or validation message.
- Add a stable test id such as `dyad-explore-code`.

## Error Handling

Use `DyadError` for expected user/project failures:

- `DyadErrorKind.Precondition`: missing app-local TypeScript, missing tsconfig, no source files, unsupported project shape.
- `DyadErrorKind.Validation`: invalid arguments, invalid bounds, escaping `tsconfig_path`.
- `DyadErrorKind.NotFound`: unknown `app_name`, via existing app resolution.

Unexpected compiler API failures should still surface as bugs with enough context for debugging, without dumping large source content into logs.

## Test Plan

Unit tests:

- Settings schema, defaults, and settings search include `enableCodeExplorer`.
- Tool gating excludes `explore_code` by default and includes it when the experiment is enabled and the app is TypeScript-ready.
- Tool gating excludes the tool when the app has no app-local TypeScript or no tsconfig.
- Input validation rejects out-of-range caps and escaping `tsconfig_path`.
- Graph/search on a temp TypeScript project returns expected cross-file symbols and line-numbered source windows.
- Expected readiness failures are classified as `DyadErrorKind.Precondition`.
- Chat parser and renderer recognize `dyad-explore-code`.

E2E test:

- Add a small import fixture app with:
  - app-local TypeScript dependency
  - `tsconfig.json`
  - cross-file auth/session TypeScript code
- Add a fake local-agent fixture that calls `explore_code` with a query such as `login session auth service flow`.
- New E2E spec should:
  - import the fixture app
  - verify request snapshots do not include `explore_code` when the setting is off
  - enable `enableCodeExplorer`
  - send the fixture prompt
  - assert the rendered `dyad-explore-code` card is visible
  - assert expected file names and line-numbered snippets appear
- Run `npm run build` before the E2E test, then run the targeted Playwright spec.

## Benchmark Study

Add a manual benchmark command:

```sh
npm run benchmark:code-explorer
```

The benchmark should launch packaged Dyad programmatically with a real LLM provider and run paired baseline/experiment trials.

Repositories:

- Excalidraw: `https://github.com/excalidraw/excalidraw`
- Mattermost webapp: `https://github.com/mattermost/mattermost`, app root `webapp/channels`
- Cal.com: `https://github.com/calcom/cal.com`
- Supabase: `https://github.com/supabase/supabase`

Trial setup:

- Same packaged Dyad build.
- Same Dyad Engine provider path.
- Read `DYAD_PRO_KEY` from `.env` and use it to authenticate Dyad Engine calls.
- Do not print or persist the key in benchmark logs, JSONL events, or reports.
- Same repo commit.
- Same prompt.
- Fresh chat per trial.
- Baseline: `enableCodeExplorer=false`.
- Experiment: `enableCodeExplorer=true`.
- Local-agent mode.
- Real Dyad Engine calls only; no fake-provider benchmark path.

Benchmark prompts:

- Use a fixed prompt manifest with realistic code-navigation tasks.
- Include multiple prompts per repo, with a default of 3 tasks per repo.
- Each task should ask the agent to trace implementation flow, identify key files/symbols, or explain where a behavior is implemented.
- Each task should have a lightweight rubric of expected files or symbols so failed/low-quality answers are not counted as wins.

Metrics:

- Total provider tokens.
- Input tokens.
- Output tokens.
- Tool-call count.
- Tool-call count by tool name.
- Provider step count.
- Wall-clock elapsed time.
- Success/failure against the prompt rubric.

Instrumentation:

- Add benchmark-only JSONL recording behind an environment variable such as `DYAD_BENCHMARK_RUN_ID`.
- Record provider usage, local-agent tool calls, stream steps, elapsed time, final answer text, and errors.
- Write results under `benchmark-results/code-explorer/<run-id>/`.
- Generate `summary.json` and `summary.md`.

Programmatic Dyad driver:

- Launch the packaged Electron app from a Node CLI script with a fresh user data directory per trial.
- Import each benchmark repo using the existing app import path with copy disabled when possible.
- Load `.env`, require `DYAD_PRO_KEY`, and configure the app to use Dyad Engine for both arms.
- Configure the same model for both arms.
- Start local-agent chats programmatically through the existing chat IPC path.
- Read final chat state and benchmark JSONL events after each run.
- Do not replace Dyad's real agent loop with a standalone AI SDK harness; the benchmark should measure the product path users actually exercise.

Repeat count:

- Default to 1 paired repeat per prompt to keep the study cheap and fast enough to run regularly.
- Support `--repeats=N` for deeper studies when we want stronger evidence against real LLM latency, routing, and output-length variance.

Success bar:

- Only compare trials that pass the prompt rubric.
- Aggregate results per repo across that repo's tasks.
- Treat the experiment as proven only if successful repo-level results show lower total tokens and lower tool calls on at least 3 of 4 repos. When `--repeats=N` is greater than 1, use medians per task before aggregating.
- The experiment should not regress median elapsed time by more than 10%.
- If the result does not meet the bar, the report should explicitly say the study did not prove a win and include diagnostics by repo/prompt.

## Implementation Notes

- Reuse existing local-agent tool patterns and consent/rendering primitives.
- Keep the tool read-only and available in plan/ask modes only when gated in.
- Keep the graph in memory; do not add SQLite or migrations.
- Rebuild the graph on detected source/config mtime-size changes for v1 instead of implementing fine-grained file watching.
- Avoid dependency installation during the benchmark by default. The selected benchmark repos should already have TypeScript configured in their checked-in dependency manifests, and readiness should be based on app-local dependency resolution from installed dependencies when the benchmark setup opts into installation.
- Document benchmark prerequisites clearly, including `DYAD_PRO_KEY` in `.env`, packaged build requirement, and whether repo dependencies should be installed before running.

## Risks And Mitigations

- Target app lacks installed TypeScript: hide the tool when readiness can be checked before request construction; otherwise return `DyadErrorKind.Precondition`.
- Large repos are slow or memory-heavy: skip `node_modules` and `.d.ts`, scope benchmark apps to relevant subdirectories, cap graph expansion, and terminate idle workers.
- Tool output is too large: enforce file, window, line, and character caps before returning content to the model.
- Chat tag renders as raw XML: add both the streaming parser tag and the Markdown renderer case in the same change.
- Benchmark results are noisy: default to one repeat for cost, but support `--repeats=N`, pinned repo commits, fixed prompts, rubric checks, and paired baseline/experiment runs.
- Benchmark contaminates normal app behavior: write JSONL only when `DYAD_BENCHMARK_RUN_ID` is set.

## Ordered Implementation Sequence

1. Add settings schema/default/search/UI for `enableCodeExplorer`.
2. Add shared code explorer worker protocol types.
3. Add pure core modules and unit tests for program discovery, indexing, search, expansion, and rendering.
4. Add the worker shell, worker Vite config, and Forge build entry.
5. Add the main-process code explorer processor.
6. Add the `explore_code` local-agent tool and register it behind the experiment/readiness gate.
7. Add chat streaming parser and renderer support for `dyad-explore-code`.
8. Add the E2E fixture, fake local-agent fixture, and targeted E2E spec.
9. Add benchmark instrumentation behind `DYAD_BENCHMARK_RUN_ID`.
10. Add the packaged-Dyad benchmark CLI, repo/task manifests, result writer, and summary report.
