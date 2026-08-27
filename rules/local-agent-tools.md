# Local Agent Tool Definitions

Agent tool definitions live in `src/pro/main/ipc/handlers/local_agent/tools/`. Each tool has a `ToolDefinition` with optional flags.

## Read-only / plan-only mode

- **`modifiesState: true`** must be set on any tool that writes to disk or modifies external state (files, database, etc.). This flag controls whether the tool is available in read-only (ask) mode and plan-only mode — see `buildAgentToolSet` in `tool_definitions.ts`.
- A durable orchestration tool that changes only main-process metadata may use `allowInReadOnlyModes` to remain available in Ask and Plan, but its turn-scoped schema must exclude every app- or external-state-mutating capability. Keep `modifiesState: true`; the exception does not make metadata writes read-only.
- If a read/inspection wrapper tool gains a state-changing host function (for example a new sandbox `write_file` capability inside `execute_sandbox_script`), either mark the parent tool `modifiesState: true` or make `modifiesState` a context predicate that returns true whenever the writable host function is exposed. Otherwise read-only / plan-only filtering can still expose writes through the wrapper tool. Prompt descriptions, tool filtering, and runtime capability injection should all derive from the same turn-scoped flag so ask/plan mode can keep the read-only surface without advertising or exposing writes.
- Similarly, code in the `handleLocalAgentStream` handler that writes to the workspace (e.g., `ensureDyadGitignored`, injecting synthetic todo reminders) should be guarded with `if (!readOnly && !planModeOnly)` checks. Injecting instructions that reference state-changing tools into non-writable runs will confuse the model since those tools are filtered out.
- Native Git commands are not automatically non-executing: repository-local configuration can launch `core.fsmonitor`, and checkout/restore conversion can launch configured smudge or `filter.process` commands. Agent-facing inspection wrappers must override process-spawning config (at minimum `core.fsmonitor=false` for status), and historical restore should materialize verified regular-file blobs directly instead of using checkout/restore filtering. Reject historical symlinks before downstream sync/deploy side effects can follow them outside the app.

## Latest-turn review targets

- Writable Local Agent turns normally commit file changes before emitting `chat:response:end`, so the working tree is usually clean immediately after a successful turn. Features that inspect or review the latest assistant turn must use the assistant message's `sourceCommitHash` as the base and `commitHash` as the target. Use the working tree only as a fallback when that message has no valid commit range.
- If a root turn spawns or resumes a writable child, synchronously reserve an owner-scoped run activity before returning the tool result and join that child before root-owned deploy/commit. Cancellation must close and drain only that actor-run generation; after successful cancellation, the root owns complete-diff review and remediation of any preserved edits, and the final response must visibly warn that cancelled-child edits may remain.
- Register mutation activity synchronously before the first async gap. Root tools, Implementer executions, direct MCP calls, and writable sandbox host capabilities use opaque, idempotent activity handles owned by `{ turnId, actorRunId }`; ordinary writers from other turns remain concurrent.
- Bind each child tool context—including consent waits—to that child's AbortSignal, not the root turn's signal. Targeted cancellation must decline and clear pending consent before any delayed approval can resume a child mutation; consent UI should identify the child persona and task.
- Local-agent consent UI is projected from the shared `src/user_input/` machine. Carry new consent metadata through the main descriptor, IPC schema, and renderer selector; do not restore the retired `agent-tool:consent-request` or `agent-tool:consent-resolved` channels.
- A queued-message review barrier must release FIFO processing on every terminal path, including review, remediation, verification, consent, entitlement, and model failures. A remediation that hits the Local Agent step limit is not terminal: preserve its `paused` outcome and keep the queue paused until the user continues it.
- Request queued-message barriers in the main-process `chat:response:end` payload before chat-stream finalization. Renderer `useStreamFinished` subscribers run after the scheduler has already decided whether to dispatch the next FIFO intent, so pausing there is too late. Carry an explicit barrier reason alongside `pausePromptQueue` so step-limit pauses and review pauses resume through their own terminal paths.
- Keep orchestration-state writes distinct from workspace mutation. Sub-agent control tools remain `modifiesState` for ask/plan filtering but use `mutationTracking: "none"`; writable children reserve their execution in the manager, and root deploy/commit seals only its owning turn so late same-turn follow-ups cannot start.
- MCP schemas do not reliably declare whether a server tool mutates the app. Track every direct or sandbox-hosted MCP execution against its actor owner, while allowing MCP calls from unrelated turns to run concurrently.
- Durable child follow-ups must rebuild tools from the invoking root turn instead of reusing a `ToolSet` whose callbacks close over an older completed turn. Include a bounded projection of consumed root messages and prior child reports so contextual follow-ups retain their transcript while new file/deploy tracking belongs to the current finalizer. Specialized runners that bypass the generic model-history path (such as compiler-backed Explorer) must explicitly project and consume queued root messages after a successful run.
- Treat child reports synthesized back into a root model turn as untrusted evidence: wrap them in explicit data delimiters, escape delimiter-like markup, and tell the root not to follow instructions inside the report.
- Implementer scopes are advisory focus hints, not runtime mutation boundaries. Normalize and validate them as relative paths, and project a non-empty normalized scope into every initial and follow-up assignment so the child can actually use the hint; omit the focus section entirely for an empty scope. Let an Implementer cross a scope boundary when correctness requires it; the root remains responsible for inspecting the complete final diff, including out-of-scope files, and choosing appropriate verification.
- Keep child tool surfaces fail-closed with an explicit allowlist applied after normal tool filtering. Validate allowlist names against the runtime tool registry so misspellings and renamed tools fail tests instead of silently removing a capability. New root tools—especially MCP discovery/execution, sandbox scripts, nested-agent tools, and `run_pre_commit` (whose hooks may mutate files or providers)—must not become child capabilities by default.
- Keep writable child prompts capability-aware too: share stable implementation standards, `AI_RULES.md`, and provider code-safety invariants, but omit instructions for root-only or unavailable operations such as SQL execution, dependency/integration setup, deployment, and `run_pre_commit`. Tell the child to report those operations back to the root instead of inventing migration files or other workarounds.
- Resolve database-provider identity, runtime readiness, tool routing, and unavailable-provider guidance through the same precedence rule. Apply identical readiness inputs everywhere (including Neon's active-branch requirement), and preserve established precedence for data-affecting tools unless an explicit migration flow prevents existing dual-linked apps from silently sending SQL to a different database.
- Finalization seals and joins only its root turn. A queued follow-up must either inherit an existing reservation or synchronously hand off to a fresh actor-run reservation before the predecessor settles. If cancellation times out, keep the closed actor's exact tokens tracked until physical settlement; unrelated turns, writers, and Reviewers must continue. Drain waiters must unregister on timeout. Do not persist a terminal cancellation or allow destructive chat/app cleanup until the exact actor drains; expose an honest nonterminal stopping state and make destructive cleanup fail retryably in the meantime.
- Reconcile Supabase function changes against the final local filesystem before external side effects, for both deferred Implementer operations and immediate root deletes: deploy a changed function whose concrete entry point still exists, and delete one whose final local state is absent unless `skipPruneEdgeFunctions` preserves remote-only functions. Derive a function name from the top-level segment under `supabase/functions/`, including for nested source files. Treat a confirmed provider 404 during deferred deletion as idempotent success, but surface every other provider failure.

## Async I/O

- Use `fs.promises` (not sync `fs` methods) in any code running on the Electron main process (e.g., `todo_persistence.ts`) to avoid blocking the event loop.
- `engineFetch` always includes `ctx.abortSignal`, combining it with any
  caller-supplied signal, so Local Agent engine requests structurally inherit
  turn cancellation. The helper owns the default five-minute engine deadline
  (with a per-endpoint override); keep caller aborts,
  deadline timeouts, and ordinary network failures separately classified, and
  keep both cancellation and the deadline active until the response body
  settles. Clean up combined-signal listeners and timers on every settlement
  path.
- Keep the `engineFetch` response surface limited to the body consumers whose
  abort classification is preserved. Node's native `Response` consumers can
  replace a custom stream failure with `EncodingError`, and `clone()` drops
  instance overrides.
- A streaming caller that exits before EOF must cancel its response reader in
  `finally`; releasing the lock alone leaves the socket, deadline timer, and
  turn-signal listeners alive.

## Git subprocesses and mutation tracking

- Local-agent Git commands must use `execGit` from `git_utils.ts`. When a command needs streaming or a bounded process runner, spawn the executable and environment from `getGitProcessEnvironment`; importing Dugite directly bypasses the Windows WSL-PATH filtering and Linux libcurl shim.
- Git-consumer tests that mock `electron-log` must provide `debug` on scoped loggers. The Windows Git environment sanitizer calls it when filtering `WindowsApps`/WSL PATH entries, so an incomplete mock can surface only as an indeterminate fingerprint on Windows CI.
- `fileMutationCount` is for Git-visible workspace mutations, not every file or provider change. Exclude ignored media such as `.dyad/media` and provider-only state changes, and use a result-aware `shouldTrackMutation` predicate for tools that write files only after user approval.
- Adding a tool to `APP_MUTATING_TOOL_NAMES` also requires a result-aware `shouldTrackMutation` and an entry in the exhaustive `FILE_MUTATION_POLICIES` registry. Choose that policy independently: mutation counting gates test retries, while the file policy gates `run_pre_commit` after Git-visible changes.
- Git-state fingerprints must hash raw output bytes, disable fsmonitor, external diffs, and textconv, and include untracked file contents rather than only their paths. Keep path collection and file streaming bounded, and hash symlink targets without following them outside the app.
- Restrict filesystem tests that create invalid UTF-8 path bytes to Linux. macOS rejects those filenames with `EILSEQ`, so cover raw subprocess-byte preservation separately with platform-independent tests.
- Do not spawn Git just to maintain `fileMutationCount` when pre-commit is unavailable. For hook-enabled turns, cache repeated path-visibility checks and classify deletes/renames from their post-mutation Git status so staged removals are not mistaken for ignored-only changes.
- Pre-commit eligibility must follow the staged Git snapshot being committed, not only turn-scoped mutation counters. Persist a measurable post-run fingerprint to reject unchanged retries, but treat fingerprint uncertainty as a bounded follow-up opportunity rather than claiming the snapshot is unchanged.
- A dirty-path superset is safe for idempotent redeploy queueing, not destructive provider reconciliation. Delete a remote function only when its concrete entry point existed before the hook and is absent afterward; if changed-path or entry-point inspection fails, skip reconciliation and surface the uncertainty instead of assuming everything changed.

## App lifecycle tools

- Tools that start or restart the app preview must route through the main-owned
  `app_run` actor. Mint and carry a stable invocation ref through the runtime
  claim, producer output, and actor settlement; `app:output` is presentation
  fan-out, not lifecycle authority. Do not report tool success until the
  preview proxy is ready. The restart service call can settle after spawning
  the process but before the development server is usable.
- Keep lifecycle tool semantics consistent across host, Docker, and cloud
  runtimes. In particular, a tool that claims to rebuild or reinstall
  dependencies must not take an in-place cloud restart shortcut.
- Only honor turn cancellation before a destructive lifecycle mutation starts.
  Once restart or rebuild has begun, wait for the real outcome instead of
  reporting cancellation while teardown or dependency installation continues
  in the background. Allow rebuild readiness substantially more time than an
  ordinary restart because it includes a fresh dependency install.

## Production build snapshots

- Keep the in-place-versus-isolated build decision independent of the host OS.
  Create an isolated build from a detached Git worktree on every platform, then
  overlay the live repository's tracked edits and deletions plus untracked and
  relevant ignored inputs. The overlay copy backend may vary—use clone-on-write
  when Node and the filesystem support it and an ordinary bounded copy on
  Windows—but the resulting inputs must have the same semantics.
- When a preview is Docker-backed, isolate even otherwise preview-safe builds.
  The live dependency tree may contain Linux-native packages installed by the
  container and must not be reused by a host-side production build.
- Preserve the app's path relative to the Git top-level in the temporary
  worktree. Run the package manager from that corresponding app directory, but
  overlay repository-wide changes so monorepo configuration and sibling
  packages match the live workspace. Canonicalize the source app path once and
  use that same path for repository-relative package-manager-root mapping;
  mixing a symlinked app path with a canonical Git root can escape the snapshot.
- Apply overlay exclusions at the same path depth on every backend. Exclude
  `node_modules` anywhere in the repository and known generated output roots
  directly under the target app; never overlay live dependency trees or root
  build output. Do not exclude every nested directory with a common output name
  because paths such as `app/out/page.tsx` can be application source. Enforce
  these exclusions during recursive traversal too: Git can report an untracked
  parent while ignored dependency or root-output directories sit beneath it.
  Preserve an otherwise excluded app-root directory when Git tracks files under
  it; committed `dist` or `out` content may be a build input rather than output.
- An isolated build must exclude the live app's `node_modules` and install a
  clean dependency tree inside the snapshot with the package manager selected
  from the live app's existing signals. Use the lockfile's frozen/CI mode when
  available, prefer the local package cache, stream install output, and surface
  install failures separately without consuming a build attempt. After
  materializing the worktree and overlay, inspect preserved symlinks and
  junctions: remap targets inside the source repository into the worktree, and
  reject targets outside the repository rather than leaving a path back to live
  files.
- A dependency-install failure does not consume one of the build-attempt slots,
  but record it separately and refuse another setup attempt until the workspace
  changes. This preserves useful retries after a fix without allowing repeated
  clean installs against identical inputs.
- For a nested workspace app, use ancestor package-manager and lockfile signals
  only after confirming that the app belongs to that npm/pnpm workspace, then
  install from the applicable workspace root. An unrelated ancestor lockfile
  must not turn a child install into `npm ci`.
- A detached superproject worktree does not populate Git submodules. Materialize
  initialized live submodules from local state without fetching so isolated
  builds retain both their inputs and Git boundary; leave live-uninitialized
  submodules uninitialized.
- On Windows, do not classify junctions from `Dirent`: libuv may report a
  reparse-point directory as an ordinary directory. Use `lstat`, recreate
  directory links as junctions, and copy linked files so snapshot setup does
  not require symbolic-link privileges.
- Bound recursive snapshot traversal with a fixed-size batch or worker pool,
  especially on Windows where every entry uses explicit filesystem calls. An
  unbounded recursive `Promise.all` can queue a large source tree before
  cancellation is observed.
- Keep build worktrees in a Dyad-owned scratch root and write an ownership
  sidecar before registering each one. Keep the sidecar outside the worktree so
  Git-aware tools do not see a Dyad-only untracked file. Startup and stale
  cleanup must require a valid sidecar before deletion; a name pattern alone is
  never proof of ownership. Unregister with `git worktree remove --force`, then
  fall back to filesystem deletion and `git worktree prune` when necessary.
- Start one deadline before snapshot validation/copying and give the build only
  the remaining budget. Stream build output while it runs, and do not consume a
  retry when snapshot setup fails before the build process starts. Record every
  non-user-cancelled setup failure, including snapshot creation and deadline
  expiry, against the current mutation count so unchanged retries are refused.
- Do not run a host-side production build while the active preview uses a cloud
  sandbox. Refuse with guidance to switch to the Host runtime until build
  execution is supported inside the active cloud sandbox.
- Snapshot teardown is best-effort and must not delay a cancelled or timed-out
  turn. Start cleanup without awaiting it; the marked-directory startup sweep
  remains the fallback for interrupted cleanup.
- `AgentContext.onXmlStream` replaces the previous preview with the full accumulated XML; callers receiving delta output chunks must append them to a bounded buffer before emitting each update.
- Throttle full accumulated build-output previews rather than emitting once per
  stdout/stderr chunk, and synchronously flush the final buffered preview when
  the child process settles so batching never hides terminal output.
- Select build mode around preview continuity, not whether a build may generate
  files. With no running preview, build in place. Beside a preview, run the exact
  standard Vite build in place, run Next.js 16+ in place only when `.next/dev`
  confirms separate development output, and isolate Next.js 15 and unknown or
  custom build commands. Keep this decision independent of the host OS.
  Because package managers may execute `prebuild` and `postbuild` around an
  otherwise standard command, isolate any concurrent build with either hook.
- Acquire app-operation claims before reading and validating build scripts,
  lifecycle hooks, and preview facts. Re-detect framework facts from that
  locked workspace instead of using turn-start context, because an integration
  can change a Vite app into Vite/Nitro before `run_build`. If consent is
  requested by the user's tool-permission settings, warn generically that the
  package manager runs the current `prebuild`, `build`, and `postbuild`
  lifecycle.
- A workspace snapshot is an operational boundary for ordinary build outputs,
  not a security sandbox for project code. Build approval must say that project
  and dependency code runs with the user's account; do not claim that changing
  `cwd` prevents an intentionally hostile script from accessing host paths.

## User-visible tool output

- Treat model-generated code as untrusted executable input whenever its prompt
  contains app-, tool-, or user-controlled text. Model provenance plus a
  one-statement/shape check is not a security boundary: before writing or
  running the result, either parse and allowlist a side-effect-free AST grammar
  or show the exact generated code to the user for approval.
- AI SDK tool input validation can fail before the tool's `execute` callback runs. The SDK marks the preceding `tool-call` as `invalid` but stringifies its exception before emitting `tool-error`, so correlate by call ID rather than testing the later error's class. Treat `tool-input-end` as provisional: do not persist `buildXml(..., true)` until the matching `tool-call` validates, or an invalid mutation can leave a false-success card. If the call owns an XML preview, clear it only after a persistent terminal status reaches the renderer; never clear a parallel call's preview or duplicate errors thrown by `execute`, which the tool wrapper already renders.
- Registry-only npm spec validation must explicitly reject unscoped bare names ending in `.tgz`, `.tar`, or `.tar.gz`; npm interprets those as local file specs even though they pass a normal package-name regex. Scoped names with the same suffix remain registry package names.
- If one tool call is implemented as multiple sequential state-changing commands, propagate completed groups and accumulated output when a later command fails. Callers must surface the partial result and count the completed mutation instead of reporting an all-or-nothing failure.
- Do not rely on Zod `refine` / `superRefine` constraints being represented in the JSON schema shown to the model. For optional fields that models may combine despite prose guidance, normalize a single unambiguous read-only intent (for example, an explicit target ID taking precedence over pagination) or encode the modes structurally in the tool schema. If discarded fields have their own bounds or type constraints, normalize with preprocessing before field validation; a later transform cannot recover from an earlier field error.
- For Local Agent post-tool side effects that happen after the model/tool loop (for example shared Supabase function redeploys), use `ctx.onXmlComplete(...)` with escaped `<dyad-output>` content to surface warnings/errors inline. `warningMessages` creates toast warnings, and throwing turns the whole stream into a `ChatErrorBox`.
- Type-check setup guidance must only describe TypeScript as uninstalled when package resolution or CLI-file access actually fails. Preserve process spawn and compiler startup errors instead of classifying them as `typescript-not-found`, or users will be told to rebuild an intact installation and the actionable error will be hidden.
- Resolve app-local runtime packages from fresh `node_modules` filesystem state instead of `require.resolve` in long-lived Electron processes. Node caches successful resolutions, so after Rebuild replaces a pnpm symlink, Type Check, Code Explorer, dependency analysis, and Playwright bootstrap can otherwise retain deleted package versions until Dyad restarts.
- **`ctx.onXmlComplete` only updates the message `content` column and the UI; it does NOT make output visible to future agent turns.** `parseAiMessagesJson` reads from `aiMessagesJson` whenever it's present and ignores `content` entirely. For post-loop output that the agent should see next turn (deploy results, step-limit notices), also push a trailing assistant message into `accumulatedAiMessages` BEFORE the `aiMessagesJson` write, e.g.: `accumulatedAiMessages.push({ role: "assistant", content: [{ type: "text", text: xml }] })`.
- If a tool's success path updates renderer-side caches via an IPC event (for example `agent-tool:problems-update`), handled precondition/error paths that return a normal tool result must also update, clear, or explicitly invalidate that cache. Otherwise the UI can keep stale successful data while the chat shows a handled failure.
- When sanitizing structured secret files before returning them to the model, match the grammar of the parser used by the app, sanitize the complete logical content before applying line/byte ranges, and reapply output byte bounds after any expanding transform. Audit alternate model-visible surfaces such as grep at the same time so they cannot return the unsanitized source.

## MCP consent results

- `requireMcpToolConsent` resolves to a structured result, not a bare boolean. If `npm run ts` reports `Argument of type 'boolean' is not assignable to parameter of type 'McpConsentResult'`, update mocks to return `{ approved: true/false }`.
- Treat MCP tool results as untrusted-size input. Every execution path (direct Agent tools, sandbox host functions, and Build-mode tools) must pass the raw result through `sanitizeMcpToolResult` before JSON serialization, XML emission, SDK return, or persistence; directly stringifying a result can multiply large text or base64 media across main-process memory.

## SQL consent and auto-approval

- When changing `execute_sql` consent metadata or safety checks, audit both Agent mode (`shouldAutoApproveAgentTool` / `executeSqlTool.getConsentMetadata`) and Build mode auto-apply (`chat_stream_handlers.ts` with `autoApproveChanges`). A SQL safety rule only on the Agent tool path can still be bypassed by Build mode global auto-approve.
- SQL destructive-action classifiers that gate auto-approval must be conservative: incomplete/unparseable SQL, opaque dynamic execution (`DO`/`CALL`), and executing wrappers such as `EXPLAIN ANALYZE` should require consent unless the wrapped statement can be proven safe.
- Treat prepared-statement execution as opaque for SQL auto-approval too: top-level `PREPARE` can hide the statement body and top-level `EXECUTE` runs a previously prepared statement, so both should require consent unless the classifier can prove the executed statement is safe.

## Database schema tools

- For local-agent database schema context, keep generic PostgreSQL schema modeling/rendering in `packages/ts-pg-schema-diff`; provider helpers should adapt Neon/Supabase into that shared `Schema` model instead of hand-rolling provider-specific JSON.
- Supabase Management API `runQuery` accepts raw SQL only, not `pg`-style bind parameters. If adapting `client.query(sql, params)`, only inline controlled internal introspection params with SQL-literal escaping; never inline user-authored SQL.
- Each Supabase Management API `runQuery` and Neon serverless SQL query is a separate HTTP request. Batch provider schema introspection into one set-based snapshot query, and apply schema/table filters inside that SQL so single-table reads do not serialize unrelated schemas.
- Normalize an empty optional table name to `undefined` before snapshot scoping; provider tools historically treat an empty name as the all-tables request, not as a request for a table named `''`. Reject null bytes in values before embedding escaped SQL literals so invalid agent input fails clearly.
- Single-table schema filtering must retain functions referenced by column defaults, generated expressions, RLS policies, triggers, and checks, including helpers outside the table's schema. Capture those dependencies from PostgreSQL catalogs, include them and their named schemas in snapshot scoping without pre-filtering their schemas, and sort retained functions/schemas deterministically so provider paths render identically.
- Rendered schema DDL must be replayable: create helper schemas before functions, and defer function-dependent defaults, generated columns, policies, and checks until after function definitions but before indexes, foreign keys, and triggers that may reference deferred columns.
- When filtering schema output to one table, retain unowned sequences because opaque defaults may reference them, but retain an owned sequence only when its owning table is also retained; otherwise replay emits `OWNED BY` for an omitted table.

## Stream retries

- When diagnosing `Sub-agent finished without a report`, inspect both `agent_activities` and `agent_messages`: a completed tool activity only proves the tool ran, while zero child messages means the model returned no durable report. The current tables do not persist per-step `finishReason` or provider warnings, so do not attribute an empty post-tool continuation to a specific provider cause without additional telemetry.
- Sub-agent runners that await `streamText` convenience promises must capture `onError` and propagate the recorded stream failure after draining. Otherwise a rejected post-tool request can resolve with one successful tool step and empty text, masking the provider error as “Sub-agent finished without a report.”
- Call `cancelOrphanedBaseStream(result)` only after code has accessed and is
  consuming `result.fullStream`; calling it before awaiting `result.text`/
  `steps` cancels the primary stream and can leave durable sub-agents stuck in
  `running` forever.
- Engine usage is only known after a model request completes. Before dispatching
  the next local-agent step, add an estimate of newly completed tool results to
  the last exact usage count and compact in `prepareStep` when that projection
  reaches the threshold; otherwise a large tool result can jump over the limit.
  Mirror the SDK's provider-bound result encoding in that estimate: failed tools
  use `error-text` with `getErrorMessage`, since native `Error.message` is not
  enumerable and serializing the exception directly produces `{}`.
- When extending `handleLocalAgentStream` retry behavior, do not only match transport errors like `"terminated"`. Providers can emit structured stream errors such as `{ type: "error", error: { type: "server_error", ... } }`, and those transient 5xx / rate-limit failures need explicit retry classification too.
- Anthropic rejects any assistant `tool_use` unless the immediately following message contains every matching `tool_result`. When changing local-agent history assembly, retry replay, message injection, or `aiMessagesJson` persistence, run the transcript through the shared tool-call sanitizer at the provider/persistence boundary rather than relying only on the injection site to preserve ordering.
- In `prepareStep`-style paths, normalize the step message array even when `prepareStepMessages` returns `undefined`; split parallel tool results can still need merging on no-injection/no-compaction steps. Prefer the shared `sanitizeStepMessages` helper over ad hoc reference comparisons.
- Persisted assistant Git hashes (`sourceCommitHash` / `commitHash`) are database metadata, not part of `content` or `aiMessagesJson`. When local-agent replay needs that provenance, append an in-memory annotation only after `parseAiMessagesJson` has reconstructed the complete database message. Prefer the final `commitHash`; use `sourceCommitHash` only when no final commit exists, and never rewrite the stored transcript or insert the annotation inside a tool-call/tool-result pair.
- Keep clean no-op turns unversioned: retain their `sourceCommitHash` for provenance but leave `commitHash` null. Do not attach the current `HEAD` merely because it exists; that attributes another turn's checkpoint and exposes unrelated files in version UI and snapshots.

## Metadata-only stop tools

- If a metadata-only tool such as `set_chat_summary` is added to `stopWhen`, audit downstream pass gates that inspect the final step's `toolCalls`. A final metadata tool call should not suppress safety follow-up passes such as incomplete todo reminders.

## Prompt and request snapshots

- When changing local-agent prompt text or tool descriptions, update both prompt unit snapshots and E2E request snapshots; stale request snapshots can still contain old tool descriptions even after unit prompt snapshots pass.
- Adding a tool to `TOOL_DEFINITIONS` also breaks two integration tests that assert the exact sorted tool-name arrays — `local_agent_request.integration.test.ts` (Pro toolset) and `local_agent_ask.integration.test.ts` (read-only toolset) — plus the E2E request baselines containing full tool lists (find them with `grep -rl set_chat_summary e2e-tests/snapshots/`). Regenerate the baselines with `npm run pre:e2e` then `npx playwright test <affected specs> --update-snapshots`.
- Search all `e2e-tests/snapshots/` baselines for old tool-description text after regenerating request snapshots. Some request baselines are extensionless files such as `local_agent_explore_code.spec.ts_disabled`, not just `.txt` snapshots.
- When a local-agent tool is gated by a setting or experiment, keep related user-message hints in sync with the same gate. Request snapshots for the default-disabled path should not advertise or include a tool that `buildAgentToolSet` filters out.
- In `testing/fake-llm-server`, keep Anthropic local-agent fixture routing in sync with the OpenAI chat-completions route for synthetic continuation messages (`incomplete todo(s)`, persisted unfinished todos, and stream retry prompts). If Anthropic routing misses those markers, multi-pass fixtures fall back to the canned `file1.txt` response mid-flow.

## Sandbox host functions

- When adding a built-in sandbox host function, add its name to `SANDBOX_HOST_CALL_NAMES` in `src/ipc/utils/sandbox/capabilities.ts`. MCP tool collection seeds collision detection from that list so MCP capabilities do not silently shadow built-ins when capability maps are merged.
- A state-changing host function must enforce cross-cutting preconditions at the capability layer, not via the parent tool's wrapper. `execute_sandbox_script` is exempted from the wrapper-level app-blueprint gate (`CAPABILITY_GATED_BLUEPRINT_TOOLS` in `tool_definitions.ts`) because gating the whole tool would also block read-only scripts and MCP host calls; instead `buildWriteFileCapability` calls `assertAppBlueprintApproved` per write, reading `ctx.enableAppBlueprint`.
- Host functions that WRITE must run `assertSandboxWritePathAllowed` (realpath containment), not just the lexical `assertAllowedGuestPath`. Reads already resolve symlinks via `assertResolvedPathAllowed`; a write path that skips realpath resolution can follow a symlinked directory or file out of the app.
- When enforcing realpath containment or protected-path rules, canonicalize **both** the root and target before calling `path.relative`. Mixing a lexical root with a realpath target can misclassify paths on macOS (`/var/...` canonicalizes to `/private/var/...`) and bypass checks such as referenced-app `.dyad/` protection.
- Consent, file-edit tracking, and blueprint gating shared between `buildAgentToolSet` and sandbox capability bridges live in `tools/tool_invocation.ts` — a cycle-free module (`tool_definitions.ts` imports every tool, so tools cannot import back from it). Use those helpers instead of copying the wrapper's blocks.
- Derive "is this host function enabled" from one predicate: the handler sets `ctx.sandboxWriteFileHostEnabled` via `shouldIncludeTool(writeFileTool, ...)`, and per-call re-checks use `getToolConsent(writeFileTool)` (which honors the tool's `defaultConsent` fallback). Do not read `settings.agentToolConsents` directly — a raw read silently diverges if the default consent changes. `buildExecuteSandboxScriptDescription` requires an explicit `includeWriteFile` for the same reason: only the caller knows the turn context.

## Attachment manifest lifecycle

- When deleting old `.dyad/media` attachment files, also prune `attachments-manifest.json` entries under the `attachments-manifest:${appPath}` lock. Read-time filtering hides broken entries but still leaves stale logical names that force unnecessary suffixes like `notes-2.txt` on future uploads.
- When registering `.dyad/media` files that may already exist (for example repeated `@media:` mentions), reuse an existing manifest entry for the same `storedFileName` before allocating a new logical name. Otherwise repeated references create noisy `attachments:*` aliases like `image-2.png`, `image-3.png`.

## Tool spec mock contexts

- When adding a required field to `AgentContext` (in `tools/types.ts`), grep `src/pro/main/ipc/handlers/local_agent/tools/*.spec.ts` and update every mock context literal. The TS error appears as e.g. `Property 'nitroEnabled' is missing in type ... but required in type 'AgentContext'` and surfaces only via `npm run ts` — `npm run lint` does not catch it.

## Parked user-input tools

- A local-agent tool that parks while waiting for user input must persist its interactive card from `buildXml(..., true)` before the park; `streamingPreview` is renderer-local and disappears on reload or in another window. Append a terminal outcome when the request settles, and make the earlier pending card hide once that durable outcome exists.
