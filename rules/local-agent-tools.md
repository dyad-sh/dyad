# Local Agent Tool Definitions

Agent tool definitions live in `src/pro/main/ipc/handlers/local_agent/tools/`. Each tool has a `ToolDefinition` with optional flags.

## Read-only / plan-only mode

- **`modifiesState: true`** must be set on any tool that writes to disk or modifies external state (files, database, etc.). This flag controls whether the tool is available in read-only (ask) mode and plan-only mode — see `buildAgentToolSet` in `tool_definitions.ts`.
- If a read/inspection wrapper tool gains a state-changing host function (for example a new sandbox `write_file` capability inside `execute_sandbox_script`), either mark the parent tool `modifiesState: true` or make `modifiesState` a context predicate that returns true whenever the writable host function is exposed. Otherwise read-only / plan-only filtering can still expose writes through the wrapper tool. Prompt descriptions, tool filtering, and runtime capability injection should all derive from the same turn-scoped flag so ask/plan mode can keep the read-only surface without advertising or exposing writes.
- Similarly, code in the `handleLocalAgentStream` handler that writes to the workspace (e.g., `ensureDyadGitignored`, injecting synthetic todo reminders) should be guarded with `if (!readOnly && !planModeOnly)` checks. Injecting instructions that reference state-changing tools into non-writable runs will confuse the model since those tools are filtered out.
- Native Git commands are not automatically non-executing: repository-local configuration can launch `core.fsmonitor`, and checkout/restore conversion can launch configured smudge or `filter.process` commands. Agent-facing inspection wrappers must override process-spawning config (at minimum `core.fsmonitor=false` for status), and historical restore should materialize verified regular-file blobs directly instead of using checkout/restore filtering. Reject historical symlinks before downstream sync/deploy side effects can follow them outside the app.

## Async I/O

- Use `fs.promises` (not sync `fs` methods) in any code running on the Electron main process (e.g., `todo_persistence.ts`) to avoid blocking the event loop.

## User-visible tool output

- AI SDK tool input validation can fail before the tool's `execute` callback runs (`InvalidToolInputError` / `NoSuchToolError`). If a tool starts an XML streaming preview before validation completes, handle those `tool-error` stream parts at the handler boundary so the preview is cleared only after a persistent terminal status reaches the renderer; do not duplicate errors thrown by `execute`, which the tool wrapper already renders.
- Do not rely on Zod `refine` / `superRefine` constraints being represented in the JSON schema shown to the model. For optional fields that models may combine despite prose guidance, normalize a single unambiguous read-only intent (for example, an explicit target ID taking precedence over pagination) or encode the modes structurally in the tool schema.
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

- When extending `handleLocalAgentStream` retry behavior, do not only match transport errors like `"terminated"`. Providers can emit structured stream errors such as `{ type: "error", error: { type: "server_error", ... } }`, and those transient 5xx / rate-limit failures need explicit retry classification too.
- Anthropic rejects any assistant `tool_use` unless the immediately following message contains every matching `tool_result`. When changing local-agent history assembly, retry replay, message injection, or `aiMessagesJson` persistence, run the transcript through the shared tool-call sanitizer at the provider/persistence boundary rather than relying only on the injection site to preserve ordering.
- In `prepareStep`-style paths, normalize the step message array even when `prepareStepMessages` returns `undefined`; split parallel tool results can still need merging on no-injection/no-compaction steps. Prefer the shared `sanitizeStepMessages` helper over ad hoc reference comparisons.
- Persisted assistant Git hashes (`sourceCommitHash` / `commitHash`) are database metadata, not part of `content` or `aiMessagesJson`. When local-agent replay needs that provenance, append an in-memory annotation only after `parseAiMessagesJson` has reconstructed the complete database message. Prefer the final `commitHash`; use `sourceCommitHash` only when no final commit exists, and never rewrite the stored transcript or insert the annotation inside a tool-call/tool-result pair.

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
