# Fine-Grained Supabase Edge Function Redeploys

## Summary

Avoid redeploying every Supabase Edge Function when a file under `supabase/functions/_shared/` changes. Instead, use TypeScript-based static dependency analysis to identify which functions transitively import the changed shared module, redeploy only those functions, and fall back to the current all-functions redeploy whenever analysis is ambiguous.

The goal is to make common shared-module edits faster without risking stale deployed functions.

## Problem

Dyad currently treats any `_shared` change as affecting all Supabase Edge Functions:

- Agent tools set `ctx.isSharedModulesChanged = true` when editing `supabase/functions/_shared/**`.
- Later, `deployAllFunctionsIfNeeded(...)` calls `deployAllSupabaseFunctions(...)`.
- The legacy response processor has the same behavior after detecting shared-module changes.

This is safe, but slow for apps with many functions. In most real projects, a shared module is only imported by a subset of functions.

## Goals

- Redeploy only affected functions after ordinary TypeScript shared-module edits.
- Preserve the existing all-functions deploy as the fallback path.
- Make the dependency analysis conservative: ambiguous cases must over-deploy, never under-deploy.
- Reuse the existing Supabase deploy queueing behavior. Bundling may remain concurrent, while activation remains serialized per project.
- Keep the implementation local to Supabase function deployment logic and its callers.

## Non-Goals

- Perfectly emulate Deno's full module resolution.
- Support arbitrary import maps or aliases in the first pass.
- Support `.js` import specifiers resolving to `.ts` source files in the first pass.
- Add user-visible settings for this optimization.
- Change deploy behavior for direct edits inside `supabase/functions/{functionName}/**`; those already deploy individual functions where possible.

## Current Code Paths

Primary files:

- `src/supabase_admin/supabase_utils.ts`
  - `isServerFunction(...)`
  - `isSharedServerModule(...)`
  - `extractFunctionNameFromPath(...)`
  - `deployAllSupabaseFunctions(...)`
- `src/pro/main/ipc/handlers/local_agent/processors/file_operations.ts`
  - `deployAllFunctionsIfNeeded(...)`
- `src/ipc/processors/response_processor.ts`
  - legacy full-response file operation processing
- Local-agent tools that set `isSharedModulesChanged`
  - `write_file.ts`
  - `search_replace.ts`
  - `rename_file.ts`
  - `delete_file.ts`
  - `copy_file.ts` / `src/ipc/utils/copy_file_utils.ts`

## Proposed Design

### 1. Track Changed Shared Paths

The current boolean `isSharedModulesChanged` is enough to decide that some shared module changed, but not enough to know which shared module changed.

Add a changed-path accumulator alongside the boolean:

```ts
sharedServerModulePaths: string[];
```

For the local-agent path, add this to `AgentContext` and append any changed `_shared` path when write, search-replace, rename, delete, or copy touches `supabase/functions/_shared/**`.

For the legacy response processor, keep a local `changedSharedModulePaths: string[]` array while processing tags.

For renames, include both `from` and `to` when either path is under `_shared`; a rename should be treated conservatively because dependents may now have unresolved imports.

### 1b. Track Functions Whose Individual Deploy Was Skipped (correctness)

This is required to avoid an under-deploy regression. Today, every individual function deploy is guarded on `!isSharedModulesChanged`:

- Local-agent: `write_file.ts`, `search_replace.ts`, `rename_file.ts` (the `isServerFunction(...) && !ctx.isSharedModulesChanged` deploy paths), and the copy path in `copy_file_utils.ts`.
- Legacy: `response_processor.ts` individual-deploy branches for write / search-replace / rename.

That guard is safe only because the current fallback redeploys **all** functions, which incidentally covers any function whose individual deploy was skipped. Partial deploy breaks that assumption:

> In one turn the agent edits `_shared/foo.ts` (flag flips true), then writes `function-bar/index.ts` where `bar` does not import `foo`. `bar`'s individual deploy is skipped (flag is true), and the shared-module analysis returns only functions that import `foo`. `bar` would never be deployed. The behavior is also order-dependent: if `bar` were written before the shared edit, it would deploy.

Fix: record the function name at each guard site whenever an individual server-function deploy is **skipped because `isSharedModulesChanged` was already true**.

```ts
// local-agent: AgentContext
pendingFunctionDeploys: string[];
```

For the legacy path, keep a local `pendingFunctionDeploys: string[]` alongside `changedSharedModulePaths`.

At each individual-deploy site, replace the silent skip with:

```ts
if (supabaseProjectId && isServerFunction(path)) {
  if (!isSharedModulesChanged) {
    // existing individual deploy
  } else {
    pendingFunctionDeploys.push(extractFunctionNameFromPath(path));
  }
}
```

Recording only the _skipped_ deploys (not every edited function) keeps the rescue set minimal: functions already deployed individually before the shared edit are not re-listed. This set is later unioned into the deploy set (see Section 6). Functions deleted via the delete tool are not added (they are pruned/removed, not deployed).

### 2. Add Affected Function Analysis

Add a helper in `src/supabase_admin/supabase_utils.ts`:

```ts
type SupabaseFunctionImpact =
  | { kind: "partial"; functionNames: string[] }
  | { kind: "all"; reason: string };

export async function getSupabaseFunctionsAffectedBySharedModules({
  appPath,
  changedSharedModulePaths,
}: {
  appPath: string;
  changedSharedModulePaths: string[];
}): Promise<SupabaseFunctionImpact>;
```

Behavior:

0. Load the app's TypeScript via `require.resolve("typescript", { paths: [appPath] })`. If unavailable, return `{ kind: "all", reason: "typescript_not_installed" }`.
1. Locate `supabase/functions`.
2. Find valid function entrypoints: non-underscore directories with `index.ts`.
3. Build a dependency graph for local ESM source files under `supabase/functions/**`.
4. Walk each function's graph from its `index.ts`.
5. If the graph reaches any changed shared path, mark that function affected.
6. If any part of graph construction or traversal is ambiguous, return `{ kind: "all", reason }`.

If no valid function directories exist, return `{ kind: "partial", functionNames: [] }`.

### 3. Use TypeScript Compiler Parsing

Use the TypeScript compiler API rather than regex or Babel.

**Load TypeScript from the target app, not from Dyad's own bundle.** Dyad does not ship `typescript` in the main-process bundle: it is a devDependency, and the existing main-process consumers (`tsc.ts`, `code_explorer.ts`) run the compiler in worker threads with `typescript` marked external and resolved from the app's `node_modules`. A direct `import ts from "typescript"` in `supabase_utils.ts` would either bloat the main bundle or fail to resolve at runtime.

Reuse the established pattern from `code_explorer.ts`:

```ts
import { createRequire } from "node:module";

function loadAppTypeScript(
  appPath: string,
): typeof import("typescript") | null {
  try {
    const tsPath = require.resolve("typescript", { paths: [appPath] });
    return createRequire(import.meta.url)(tsPath);
  } catch {
    return null; // typescript_not_installed
  }
}
```

If the app does not have `typescript` installed, the analysis returns `{ kind: "all", reason: "typescript_not_installed" }` and we redeploy all functions exactly as today. This keeps the optimization purely additive: apps with TypeScript get fine-grained deploys, apps without it keep current behavior. This is listed as a safety-rule fallback below.

(Whether to run the analysis inline in the main process or in a worker thread like `tsc`/`code_explorer` is an implementation detail; parsing the small `supabase/functions/**` tree is cheap, so inline is acceptable for the first pass. Revisit if profiling shows it blocking the event loop on large function sets.)

Parse each source file with:

```ts
ts.createSourceFile(
  filePath,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  scriptKindForPath(filePath),
);
```

Use `ScriptKind` based on the file extension:

- `.ts`, `.mts`, `.cts` -> `ts.ScriptKind.TS`
- `.tsx` -> `ts.ScriptKind.TSX`
- `.js`, `.mjs`, `.cjs` -> `ts.ScriptKind.JS`
- `.jsx` -> `ts.ScriptKind.JSX`

Collect module specifiers from:

- `ImportDeclaration`
- `ExportDeclaration`
- dynamic `import(...)` calls

Detect, but do not support in the first pass:

- `ImportEqualsDeclaration` with an external module reference, e.g. `import foo = require("../_shared/foo")`

Rules:

- Static relative string imports are supported.
- Dynamic imports with a string literal are supported.
- Dynamic imports with a non-literal expression are unsafe and trigger all-functions redeploy.
- Standard ESM in `.js` and `.jsx` files is supported with the same rules as TypeScript files.
- CommonJS `require(...)` is unsafe in the first pass and should trigger all-functions redeploy. Even literal `require("../_shared/foo")` is not worth partially supporting until there is a clear need, because computed and conditionally executed requires are easy to misread.
- TypeScript `import foo = require("...")` syntax is unsafe in the first pass and should trigger all-functions redeploy.
- Dyad's Supabase prompt encourages shared imports with explicit `.ts` specifiers, e.g. `../_shared/logger.ts`, so the first pass should optimize for exact TypeScript source imports.
- Bare external specifiers are ignored when clearly external, such as `npm:`, `jsr:`, `http://`, `https://`, `@supabase/...`.
- Bare local aliases or unknown bare specifiers are unsafe unless support is intentionally added.

### 4. Conservative Module Resolution

Resolve only local relative imports that stay within `supabase/functions/**`.

Support extension and directory variants commonly used in Supabase function code:

- Exact path as written
- `.ts`
- `.tsx`
- `.js`
- `.jsx`
- `.mjs`
- `.cjs`
- `.mts`
- `.cts`
- `/index.ts`
- `/index.tsx`
- `/index.js`
- `/index.jsx`
- `/index.mjs`
- `/index.cjs`
- `/index.mts`
- `/index.cts`

If a relative import cannot be resolved to an existing file, return `{ kind: "all", reason }`.

If a relative import resolves outside `supabase/functions/**`, return `{ kind: "all", reason }`. The Supabase prompt tells agents not to import project code from Edge Functions, but existing user code may violate that rule. Falling back prevents stale deployments when a function depends on files outside the graph.

Do not resolve `.js` specifiers to `.ts` source files in the first pass. For example, if a file imports `./foo.js` but only `foo.ts` exists, return `{ kind: "all", reason }`. Dyad-generated Supabase code is prompted to use explicit `.ts` shared-module specifiers, so this fallback should not affect the common path.

If a changed `_shared` path is not a TypeScript-like source file, return `{ kind: "all", reason }`. Initial supported extensions:

- `.ts`
- `.tsx`
- `.js`
- `.jsx`
- `.mjs`
- `.cjs`
- `.mts`
- `.cts`

Deletion and rename cases may cause imports to become unresolved; that should naturally trigger all-functions redeploy.

### 5. Deploy A Subset

Refactor `deployAllSupabaseFunctions(...)` to support an optional subset:

```ts
export async function deploySupabaseFunctions({
  appPath,
  supabaseProjectId,
  supabaseOrganizationSlug,
  skipPruneEdgeFunctions,
  functionNames,
  onProgress,
}: {
  appPath: string;
  supabaseProjectId: string;
  supabaseOrganizationSlug: string | null;
  skipPruneEdgeFunctions: boolean;
  functionNames?: string[];
  onProgress?: (progress: SupabaseDeployProgress) => void;
}): Promise<string[]>;
```

Then keep `deployAllSupabaseFunctions(...)` as a wrapper or compatibility function:

```ts
export async function deployAllSupabaseFunctions(args) {
  return deploySupabaseFunctions(args);
}
```

When `functionNames` is provided:

- Bundle and activate only those function names.
- Validate each name still has `supabase/functions/{name}/index.ts`.
- Do not skip pruning unconditionally. Pruning is still valid during partial redeploys if the deploy helper has enumerated the complete local function set.
- Compute `localFunctionNames` from all valid local function directories, not from the partial `functionNames` subset.
- When `skipPruneEdgeFunctions` is false, compare deployed functions against the complete `localFunctionNames` set and prune dangling deployed functions exactly as the all-functions deploy path does.
- If the helper cannot enumerate the complete local function set, return an error or fall back to all-functions deploy rather than silently skipping pruning.

### 6. Replace Shared-Module Redeploy Calls

In `deployAllFunctionsIfNeeded(...)`:

1. If no Supabase project, return success. If no shared-module changes **and** `pendingFunctionDeploys` is empty, return success.
2. Call `getSupabaseFunctionsAffectedBySharedModules(...)`.
3. If `kind === "partial"`, compute the deploy set as the **union** of `functionNames` (functions affected by the shared change) and `pendingFunctionDeploys` (functions whose individual deploy was skipped — see Section 1b), de-duplicated. Call `deploySupabaseFunctions(...)` with that set. If the union is empty, return success without deploying.
4. If `kind === "all"`, call `deployAllSupabaseFunctions(...)`. (The `pendingFunctionDeploys` set is subsumed by the all-functions deploy.)
5. Include the analysis mode in logs:
   - `Shared modules changed, redeploying affected Supabase functions: a, b`
   - `Shared module dependency analysis fell back to all functions: <reason>`

Note on wiring: `deployAllFunctionsIfNeeded` currently accepts `Pick<AgentContext, ...>`. Add the new `sharedServerModulePaths` and `pendingFunctionDeploys` fields to that `Pick`, to the `AgentContext` interface in `tools/types.ts`, and to the context initializer in `local_agent_handler.ts`.

Apply the same partial/union/fallback behavior in `response_processor.ts`, using its local `changedSharedModulePaths` and `pendingFunctionDeploys` arrays. Note that without the union, a function directly edited after a shared edit in the same response would be silently dropped here too.

## Safety Rules

The implementation must choose all-functions redeploy for:

- The app does not have `typescript` installed (`require.resolve` fails).
- Non-literal dynamic import.
- Any `require(...)` call in an analyzed local source file.
- Any `ImportEqualsDeclaration` with an external module reference.
- Unresolved relative import.
- Relative import that resolves outside `supabase/functions/**`.
- Parse failure.
- Unknown local alias or import-map style specifier.
- Changed shared file with unsupported extension.
- Changed shared directory where the exact file set cannot be inferred.
- Function graph traversal cycle bugs or unexpected graph state.

Cycles in valid static imports are not unsafe by themselves. Track visited files during traversal to avoid infinite loops.

The optimization is acceptable only if uncertainty deploys too many functions, not too few.

## User Experience

This should be invisible except for faster deploys and clearer status text/logging.

For streamed deploy progress, keep the existing `<dyad-status>` format. The `total` should reflect the number of functions being deployed in the current operation, so partial deploys show accurate progress.

No new user setting is needed. If the analysis cannot prove a smaller affected set, the user gets today's behavior.

## Testing Plan

### Unit Tests

Add tests in `src/supabase_admin/supabase_utils.test.ts` or a new focused test file.

Cover:

- Direct shared import:
  - `function-a/index.ts` imports `../_shared/foo.ts`
  - only `function-a` is affected.
- Transitive import:
  - `function-a/index.ts` imports `./lib/service.ts`
  - `service.ts` imports `../_shared/foo.ts`
  - `function-a` is affected.
- Re-export:
  - `service.ts` uses `export * from "../../_shared/foo.ts"`
  - dependent function is affected.
- Multiple functions:
  - only functions whose graph reaches changed shared file are returned.
- Unused shared module:
  - changed `_shared/unused.ts` returns an empty partial set.
- Dynamic literal import:
  - `await import("../_shared/foo.ts")` is supported.
- Dynamic non-literal import:
  - `await import("../_shared/" + name)` returns `kind: "all"`.
- JS and JSX ESM:
  - `.js` and `.jsx` files with static imports are analyzed correctly.
- CommonJS:
  - `require("../_shared/foo")` returns `kind: "all"` in the first pass.
- TypeScript import equals:
  - `import foo = require("../_shared/foo")` returns `kind: "all"` in the first pass.
- Import outside `supabase/functions`:
  - `import helper from "../../../src/helper.ts"` returns `kind: "all"`.
- JS-to-TS extension mismatch:
  - `import "./foo.js"` with only `foo.ts` present returns `kind: "all"`.
- Unresolved relative import:
  - returns `kind: "all"`.
- Unsupported changed shared file extension:
  - returns `kind: "all"`.
- Directory import resolution:
  - resolves `../_shared/foo` to `../_shared/foo/index.ts`.
- Cyclic imports:
  - does not infinite loop and still finds affected functions.

### Deploy Tests

Extend `src/supabase_admin/supabase_deploy_progress.test.ts` or add a new test:

- `deploySupabaseFunctions(..., functionNames: ["alpha"])` bundles and activates only `alpha`.
- Partial deploy progress `total` equals the subset count.
- Partial deploy with `skipPruneEdgeFunctions: false` prunes deployed functions that are absent from the complete local function set.
- Partial deploy with `skipPruneEdgeFunctions: true` does not call prune logic.
- Partial deploy pruning does not treat functions outside the partial `functionNames` subset as dangling when they still exist locally.
- All deploy behavior remains unchanged when no subset is provided.

### Processor Tests

Add focused tests for:

- Local-agent shared change with partial analysis deploys only affected functions.
- Analysis fallback deploys all functions.
- Legacy `response_processor.ts` path follows the same partial/fallback behavior.
- **Under-deploy regression guard:** a turn that edits a `_shared` file and then edits an unrelated server function (one that does not import the changed shared file) deploys both the shared-affected functions and the unrelated function. Verify the unrelated function is in the deploy set even though its individual deploy was skipped. Test both the local-agent and `response_processor.ts` paths.
- **typescript_not_installed fallback:** when the app has no `typescript` installed, a shared change deploys all functions (`kind: "all"`, reason `typescript_not_installed`).

## Rollout Plan

1. Add dependency analysis helper (loading the app's TypeScript via `require.resolve`, falling back to `kind: "all"` when absent) and unit tests.
2. Refactor deployment helper to support optional function subsets.
3. Track changed shared paths **and skipped individual function deploys** (`pendingFunctionDeploys`) in local-agent contexts and legacy response processing.
4. Wire partial/union/fallback behavior into shared-module redeploy call sites.
5. Run focused unit tests:

```sh
npm test -- src/supabase_admin/supabase_utils.test.ts
npm test -- src/supabase_admin/supabase_deploy_progress.test.ts
```

6. Run broader checks before commit:

```sh
npm run fmt
npm run lint
npm run ts
```

## Premise

Generated Dyad apps mostly reference `_shared` via relative path imports (`../_shared/foo.ts`), so the optimization fires in the common case. Import maps (`deno.json` / `import_map.json`) are the residual exception: any `_shared` reference through an import-map alias is treated as an unknown bare specifier and falls back to `kind: "all"`, which is safe. No further premise validation is needed before building.

## Open Questions

- Should we eventually support import-map aliases for local `_shared` imports, or keep falling back to all for those? (Not blocking — current fallback is safe; revisit only if alias usage grows.)
- Should partial redeploy pruning failure block the partial activation result, or match today's behavior by returning a deploy warning/error after successful activation?

## Acceptance Criteria

- A `_shared` TypeScript edit redeploys only functions that statically and transitively import that changed file.
- Ambiguous dependency graphs fall back to the current all-functions redeploy behavior.
- Partial deploys still use existing Supabase deploy queue semantics.
- Tests prove common partial cases and fallback cases.
- Existing all-functions deployment behavior remains available and unchanged for non-optimized paths.
