# TypeScript Tooling Migration

## Summary

Remove the legacy Build-mode “Auto-fix problems” feature and its user setting, move all remaining on-disk type checks to the app’s local TypeScript CLI, and let Code Explorer fall back to a Dyad-packaged TypeScript 6 compiler API when an installed local TypeScript does not expose the legacy API (notably TypeScript 7).

The Problems panel remains available through its explicit **Run checks** and **Fix selected** actions, and Local Agent keeps `run_type_checks`. Dyad will not automatically type-check after a file save, proposal approval, or Build-mode response. Projects without an installed `typescript` package remain unsupported by both type checking and Code Explorer.

## 1. Unship Build-mode Auto-fix Problems

- Remove the `enableAutoFixProblems` setting end-to-end: defaults and active schema, Settings UI/switch, Settings search entry and ID, all locale strings, help/debug-report fields, test setup options, and settings snapshots. Retain it only as a deprecated stored-settings field so older files parse, then strip it during migration; it disappears on a later settings write.
- Delete the Build-mode repair loop in `chat_stream_handlers.ts`, including speculative type checks, `<dyad-problem-report>` generation, retry prompts, and the virtual codebase assembled from pending write/rename/delete tags. Preserve parsing/rendering and transcript cleanup for `<dyad-problem-report>` so historical chats continue to display and replay safely.
- Remove automatic Problems-query triggers from file saves, proposal approval, and completed Build turns. Make `useCheckProblems` manual-only (`enabled: false`) while retaining its `refetch` API for the Problems panel. Local Agent continues updating the Problems cache through `agent-tool:problems-update` after `run_type_checks`.
- Keep manual Problems workflows unchanged: users can run checks, select diagnostics, and ask Build mode to fix the selected problems through `createProblemFixPrompt`.
- Remove the auto-fix-only E2E cases, fixtures, page-object helpers, and snapshots. Update remaining Problems tests to invoke **Run checks** explicitly before asserting diagnostics or using **Fix selected/Fix all**.

## 2. Use the App-local TypeScript CLI for Type Checking

### Runtime behavior

- Replace `generateProblemReport({ fullResponse, appPath })` with an on-disk API such as `runTypeScriptCheck({ appPath })`; update the Problems IPC handler, Local Agent tool, hybrid mocks, and tests. No virtual changes remain in this contract.
- Delete the now-unused synchronous/asynchronous virtual filesystem implementation and virtual-change protocol together with the TSC worker that still consumes it at the start of this phase. Simplify `extractCodebase` and its helpers to read the real filesystem only, removing their optional virtual-filesystem parameters. Remove the obsolete TSC worker entry, worker config/directory, Forge build entry, and worker-only shared types.
- Establish eligibility by resolving `typescript/package.json` from `appPath`. Preserve the existing guidance split:
  - declared but not installed/incomplete: tell the user to rebuild dependencies;
  - not declared/installed: explain that TypeScript must be added;
  - no `tsconfig.app.json` or `tsconfig.json`: return the existing tsconfig precondition guidance.
- Resolve the local executable from `appPath/node_modules/.bin/tsc` (`tsc.cmd` on Windows), never through `npx`, a global compiler, or a package-defined `typecheck` script. Prepend the app’s `.bin` directory to `getPackageManagerCommandEnv()` so the selected system/custom/managed Node runtime launches the project-local shim. Treat a missing shim after the package resolved as an incomplete-install precondition. Resolve and cache the actual CLI version with that same shim’s `--version` output (keyed by shim realpath/mtime), rather than assuming it matches `typescript/package.json`; this preserves the official side-by-side layout where `typescript` can expose the TS6 API while another local alias owns the TS7 `tsc` shim.
- Preserve config selection order: `tsconfig.app.json`, then `tsconfig.json`. Run the local CLI from `appPath` with fixed arguments equivalent to:

  ```text
  tsc --pretty false --noEmit --incremental --tsBuildInfoFile <dyad-cache-file> --project <config>
  ```

  Store build info under Dyad’s TypeScript cache, keyed by app path, config path, and local TypeScript version, so checks never write generated files into the user project and caches are not shared across compiler versions.

- Continue running checks inside `typescriptUtilityProcessScheduler.runExclusive("tsc", ...)`. The external CLI process does not register as a resident utility process, but the scheduler must stop a resident Code Explorer before launching it and must hold the slot until the CLI child has fully exited. This preserves the existing protection against simultaneous memory-heavy TypeScript workloads and keeps performance activity labeled as `tsc`.
- Reuse the bounded process runner and existing five-minute type-check timeout. Execute the command/arguments without an interpolated shell command; extend the runner options only as needed to support a larger explicit diagnostic-output cap. Terminate the entire process tree on timeout.

### Diagnostic contract

- Add a pure parser for non-pretty TypeScript CLI diagnostics. Recognize file diagnostics of the form `path(line,column): error TS####: message`, attach indented/continuation lines to the preceding diagnostic, normalize paths to app-relative forward-slash paths, and preserve numeric code, 1-based line/column, and multiline message text.
- Reconstruct the existing three-line `snippet` after parsing by asynchronously reading the reported source file. Do not read outside the app root; external diagnostics may be reported with an empty snippet.
- Exit code `0` returns `{ problems: [] }`. A normal non-zero diagnostic exit returns a `ProblemReport` when all meaningful output was parsed as file diagnostics. Config/global diagnostics, spawn failures, signals, timeouts, unrecognized output, or output truncation must fail clearly instead of returning a misleading partial or empty report.
- Keep `ProblemReport`, Problems IPC output, Problems-panel rendering, and `agent-tool:problems-update` wire shapes unchanged. Rename worker-specific error types to type-checker terminology while preserving the existing `typescript-not-found` and `tsconfig-not-found` precondition behavior.

## 3. Add the Code Explorer TypeScript 6 Fallback

- Add the official `@typescript/typescript6` compatibility package as an exact runtime dependency (initially the current 6.0.x release) and lock its transitive compiler dependency. Package one external copy rather than inlining the compiler into the worker bundle: externalize it in the Code Explorer Vite config and allow both `@typescript/typescript6` and its `@typescript/old` dependency through Forge’s package filter.
- Centralize Code Explorer compiler resolution in the worker:
  1. Resolve `typescript/package.json` from the app. If it is absent, keep the existing `typescript_not_installed` precondition and do **not** use the fallback.
  2. Attempt to load the app-local `typescript` module.
  3. Validate the complete legacy API surface Code Explorer consumes (system/config parsing, program and incremental-host creation, AST traversal/guards, syntax and symbol enums, and diagnostic formatting).
  4. Use the local module when compatible; if loading fails or the required API is missing, load Dyad’s packaged `@typescript/typescript6` module and log the local version/reason and fallback version.
- Keep `getCodeExplorerAvailability` based on an installed local TypeScript package plus a discoverable tsconfig. A TS7 app therefore remains eligible and uses the fallback; an app with a tsconfig but no TypeScript installation remains ineligible.
- Cache compiler resolution per app as today, recording `{ module, source: "local" | "bundled-ts6", version }` so logs and failures identify the active engine. Clear this cache with existing worker test-cache cleanup.
- Use the chosen compiler for config discovery, program construction, cache freshness checks, and indexing. When bundled TS6 reports recoverable configuration diagnostics for TS7-only options, continue with a best-effort index and surface a warning that identifies the fallback compiler, the ignored configuration, and the possibility of incomplete results. Fail only when the incompatibility prevents a meaningful index, such as an unreadable configuration or no resolved source files.
- Keep the TypeScript 7 unstable API and LSP out of scope. The resolver is the seam for a future stable TS7 API adapter.

## Public/Internal Interface Changes

- Remove `enableAutoFixProblems` from `UserSettings`, debug settings, help output, translations, and renderer behavior.
- Change the internal type-check entry point to accept only `appPath`; callers and IPC response shapes remain otherwise unchanged.
- Remove `WorkerInput`/`WorkerOutput`, virtual-change types, and the TSC worker build artifact.
- Add an internal Code Explorer compiler-resolution result containing compiler source and version; the `explore_code` tool input/output remains unchanged.
- Do not add a compiler selector setting or expose the bundled TS6 fallback to projects that lack TypeScript.

## Test Plan

- **Setting/removal tests:** update settings defaults/snapshots and Settings search/UI coverage; assert the switch and setting no longer exist and old persisted keys do not affect parsed settings.
- **CLI resolver/runner unit tests:** cover missing package, declared-but-uninstalled package, missing local `tsc` shim, config selection, local `.bin` precedence over global PATH, fixed argument construction, version-keyed build-info paths, successful exit, diagnostic exit, spawn failure, timeout/signal cleanup, and truncated output.
- **Diagnostic parser unit tests:** cover POSIX and Windows paths, multiline messages, multiple files/codes, CRLF output, source snippets at first/middle/last lines, external-file snippet suppression, config/global diagnostics, and unrecognized output.
- **Scheduler tests:** adapt the existing TSC/Code Explorer exclusion test to a mocked CLI child; prove Code Explorer fully exits before CLI launch, the CLI fully exits before Code Explorer restarts, and queued checks remain serialized.
- **Code Explorer resolver tests:** cover compatible local TS selection, a TS7-like/version-only module selecting bundled TS6, local load failure selecting bundled TS6, no local TypeScript refusing fallback, missing bundled package failure, and cache reset. Retain existing injected-compiler core/index tests.
- **Code Explorer compatibility tests:** cover a TS7-only compiler option that bundled TS6 does not recognize, proving that useful files and symbols are still returned together with a bounded degradation warning; retain hard failures for unreadable configuration and zero resolved source files.
- **Packaging verification:** build the packaged app and assert the Code Explorer worker plus `@typescript/typescript6`/`@typescript/old` runtime files are present and loadable from ASAR on the target platform.
- **Integration/E2E:**
  - run manual Problems checks and Local Agent `run_type_checks` against a normal TS5/6 fixture;
  - run the same flows against an actual TypeScript 7 fixture and assert TS7 diagnostics are parsed;
  - open Code Explorer against that TS7 fixture and verify indexing succeeds via bundled TS6;
  - verify a project without TypeScript gets the existing unavailable guidance for both checking and Code Explorer;
  - verify file saves, proposal approvals, and completed Build turns do not automatically run checks or launch an auto-fix retry, while manual **Run checks** and **Fix selected** still work.
- Run focused tests first, then `npm run fmt`, `npm run lint`, `npm run ts`, `npm test`, `npm run build`, and the focused Problems/Code Explorer E2E tests.

## Acceptance Criteria and Assumptions

- Type checks use the app-local `tsc`, including native TypeScript 7, and never fall back to Dyad TS6.
- Only Code Explorer may use bundled TS6, and only when the app has an installed but legacy-API-incompatible TypeScript package.
- All automatic and model-driven Build-mode problem checking/fixing is removed; manual Problems-panel and Local Agent checks remain.
- Type checking and Code Explorer remain mutually exclusive memory-heavy workloads.
- No TypeScript command writes emit output or build-info files into the user project.
- Existing Problems and `explore_code` IPC/tool result shapes remain compatible, and historical problem-report chat messages continue rendering.
- Direct `tsc` is intentional: framework-specific wrappers (`vue-tsc`, Angular compilers), arbitrary package scripts, TypeScript 7’s unstable API, and automatic support for projects without TypeScript are out of scope.

## Open Questions

None. Resolved decisions:

- Problems checks are manual-only after the setting is removed.
- Code Explorer falls back only for installed-but-incompatible TypeScript, not missing TypeScript.
- The app-local CLI is authoritative for all remaining type checks; bundled TS6 is Code Explorer-only.
