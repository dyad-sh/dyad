# Electron IPC Architecture

This project uses a **contract-driven IPC architecture**. Contracts in `src/ipc/types/*.ts` are the single source of truth for channel names, input/output schemas (Zod), and auto-generated clients.

## Three IPC patterns

1. **Invoke/response** (`defineContract` + `createClient`) — Standard request-response calls.
2. **Events** (`defineEvent` + `createEventClient`) — Main-to-renderer pub/sub push events.
3. **Streams** (`defineStream` + `createStreamClient`) — Invoke that returns chunked data over multiple events (e.g., chat streaming).

## Key files

| Layer                      | File                                                            | Role                                                               |
| -------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| Contract core              | `src/ipc/contracts/core.ts`                                     | `defineContract`, `defineEvent`, `defineStream`, client generators |
| Domain contracts + clients | `src/ipc/types/*.ts` (e.g., `settings.ts`, `app.ts`, `chat.ts`) | Per-domain contracts and auto-generated clients                    |
| Unified client             | `src/ipc/types/index.ts`                                        | Re-exports all clients; also exports `ipc` namespace object        |
| Preload allowlist          | `src/preload.ts` + `src/ipc/preload/channels.ts`                | Channel whitelist auto-derived from contracts                      |
| Handler registration       | `src/ipc/ipc_host.ts`                                           | Calls `register*Handlers()` from `src/ipc/handlers/`               |
| Handler base               | `src/ipc/handlers/base.ts`                                      | `createTypedHandler` with runtime Zod validation                   |

## Adding a new IPC endpoint

1. Define contracts in the relevant `src/ipc/types/<domain>.ts` file using `defineContract()`.
2. Export the client via `createClient(contracts)` from the same file.
3. Re-export the contract, client, and types from `src/ipc/types/index.ts`.
4. The preload allowlist is auto-derived from contracts — no manual channel registration needed.
5. Register the handler in `src/ipc/handlers/<domain>_handlers.ts` using `createTypedHandler(contract, handler)`.
6. Import and call the registration function in `src/ipc/ipc_host.ts`.

## Renderer usage

```ts
// Individual domain client
import { appClient } from "@/ipc/types";
const app = await appClient.getApp({ appId });

// Or use the unified ipc namespace
import { ipc } from "@/ipc/types";
const settings = await ipc.settings.getUserSettings();

// Event subscriptions (main -> renderer)
const unsub = ipc.events.agent.onTodosUpdate((payload) => { ... });

// Streaming
ipc.chatStream.start(params, { onChunk, onEnd, onError });
```

## Stream client notes

- `createStreamClient(...).start(input, callbacks, opts?)` returns a monotonic `streamId` (number) identifying that `start()` call. It is an operation-identity token, not an abort handle — aborting still goes through the domain channel (e.g. `chat:cancel`).
- Each key holds at most one entry; a new `start()` for the same key replaces the previous entry, so events can never reach a replaced entry's callbacks (structural stale-event rejection).
- Terminal stream callbacks may synchronously start a replacement stream with the same key. Cleanup after `onEnd`/`onError` (including invoke rejection) must delete the entry only when the map still points to the generation that ended; an unconditional keyed delete can orphan the replacement stream.
- By default the entry is removed when the end/error event arrives (`autoRelease: true`). Pass `{ autoRelease: false }` to keep receiving events after a terminal event, and call `release(key, streamId)` when done — the chat stream machine uses this to keep entry ownership with its controller until finalization side effects complete (`release` with a stale `streamId` is a no-op).
- Chat streams: do NOT guard against duplicate streams with ad-hoc flags. The per-chat state machine in `src/chat_stream/` is the single source of truth for the chat stream lifecycle — submit through it (`useStreamChat().streamMessage`) and it serializes/queues by construction. If you must start a chat stream outside the machine (see `startImplementationStream` in `src/plan_handoff/commands.ts`), your terminal handlers must clear `isStreamingByIdAtom` yourself AND poke the machine (`ensureController(chatId).send({ type: "queue-poked" })`) so queued prompts drain.
- If a legacy UI path appends directly to `queuedMessagesByIdAtom` instead of submitting through the machine, poke the chat controller immediately after the synchronous atom write. The render that chose the queue path may be stale after finalization's one automatic dispatch, otherwise leaving the new item without a driver.
- **Never gate global-state cleanup in `onEnd`/`onError` on a local `isMountedRef`.** Stream callbacks outlive the component that started them. If the user navigates away mid-stream, an unmount-guarded `onEnd` skips `setIsStreamingByIdAtom(false)` and `syncChatFromDb`, leaving the chat permanently `isStreaming=true` — `ChatPanel.fetchChatMessages` then skips IPC fetches forever and only a page refresh recovers. Always run global Jotai state writes and DB syncs unconditionally; only guard UI-only side effects (toasts, console logs, local React state) on mount. See `src/chat_stream/commands.ts` for the no-guard pattern.

## Settings write safety (`writeSettings`)

`writeSettings(partial)` does a **shallow top-level merge**: `{ ...currentSettings, ...partial }`. This means passing `{ supabase: { organizations: { ... } } }` replaces the entire `supabase` key, losing sibling fields like legacy tokens. Callers must spread the existing parent object:

```ts
// WRONG — destroys supabase.organizations and other fields
writeSettings({ supabase: { accessToken: { value: newToken } } });

// RIGHT — preserves sibling fields
const settings = readSettings();
writeSettings({
  supabase: { ...settings.supabase, accessToken: { value: newToken } },
});
```

**Stale-read race condition:** If you call `readSettings()` before an async operation (network call, file I/O), then use the snapshot to construct the write, any concurrent settings changes during the async gap will be silently overwritten. Always call `readSettings()` immediately before `writeSettings()` — never across an `await` boundary.

**Stream-admission barrier atomicity:** In `chat_stream_handlers.ts`, a stream's final admission-block check (`streamAdmissionBlockCounts`) and its `admissionPendingStreams.delete(controller)` "start" transition must run in the **same synchronous frame — no `await` between them**. `cancelActiveStreamsForApp` (used by restore-to-message) deliberately skips controllers still in `admissionPendingStreams`, so a restore that installs its `blockNewStreamsForApp` barrier in a gap between the check and the marker removal would neither cancel the stream nor make it re-observe the new barrier — letting it start mid-restore and dirty the freshly reverted tree. Adding any `await` in that window silently reintroduces this race.

**Electron readiness:** `readSettings()` and `writeSettings()` may decrypt/encrypt secrets through Electron `safeStorage`, which throws `safeStorage cannot be used before app is ready` before `app.whenReady()`. Queue pre-ready entry points like deep links (`open-url`, `second-instance`) until the app/window is ready before calling OAuth/settings handlers.

**Custom-protocol debugging:** Before using `git bisect` on a `dyad://` flow, quit every dev and packaged Dyad instance and verify which build owns the protocol registration. macOS may route the link to a different running/registered build, producing a convincing but false good/bad result.

## Handler expectations

- Handlers should `throw new Error("...")` on failure instead of returning `{ success: false }` style payloads.
- For **non-bug** failures (validation, not found, auth, user refusal, etc.), prefer `DyadError` with the right `DyadErrorKind` so PostHog does not flood with `$exception` events — see [rules/dyad-errors.md](dyad-errors.md).
- Use `createTypedHandler(contract, handler)` which validates inputs at runtime via Zod.
- Production invoke handlers must register through `createTypedHandler`, `createLoggedHandler`, or `registerTrustedIpcHandler`; never call `ipcMain.handle` or `ipcMain.handleOnce` directly outside `trusted_handle.ts`. The facade enforces the trusted-main-frame policy for both contract and legacy channels.
- When migrating a large inline `ipcMain.handle` callback to the trusted facade, extract a named local handler first. Adding another wrapper level around the inline callback makes the formatter reindent the entire body and obscures the security-only diff.
- Treat output schemas as type/validation contracts, not production serializers: `createTypedHandler` returns the handler result unchanged outside development. Explicitly project and map renderer-visible database columns before returning, especially for large or main-only fields such as `aiMessagesJson`.
- When editing shared IPC contract code imported by `src/preload.ts` (especially `src/ipc/contracts/core.ts`), run `npm run build` before E2E. The preload Vite target may not resolve `@/...` aliases from those shared modules; use relative imports for preload-reachable shared code when packaging reports `Rollup failed to resolve import "@/..."`.
- Avoid unguarded top-level `app.on(...)` or similar Electron API calls in modules that are imported broadly by tests. Many unit tests mock only the Electron APIs they touch, so prefer guarded calls like `app?.on?.(...)` or move event registration behind an explicit initialization function.
- Electron lifecycle events do not await async handlers. When `before-quit` must finish asynchronous cleanup, call `event.preventDefault()` synchronously, wait with a hard timeout, then call `app.quit()` again behind a re-entry guard so cleanup cannot hang or recursively restart shutdown.
- When main awaits a correlated renderer decision that can auto-settle on timeout or abort, emit a request-specific terminal event for every settlement path. Key every actionable renderer projection (including native notifications) by that request ID, consume the terminal event in each projection, and guard async UI setup so it cannot create stale UI after settlement; stream-end cleanup alone may be delayed or never run.
- When splitting large handlers behind service boundaries, leave the handler responsible for IPC registration and request orchestration while moving runtime/policy logic into `src/ipc/services/*`. Preserve any intentional module side effects in the extracted service, such as `fixPath()` for child process PATH setup.
- Electron `net.request()` response typings do not expose every runtime stream event. If download code needs a `close` guard in addition to `aborted`/`error`, cast the response through `EventEmitter` instead of dropping the guard to appease `npm run ts`.

## React Query key factory

All React Query keys must be defined in `src/lib/queryKeys.ts` using the centralized factory pattern. This provides:

- Type-safe query keys with full autocomplete
- Hierarchical structure for easy invalidation (invalidate parent to invalidate children)
- Consistent naming across the codebase
- Single source of truth for all query keys

**Usage:**

```ts
import { queryKeys } from "@/lib/queryKeys";
import { appClient } from "@/ipc/types";

// In useQuery:
useQuery({
  queryKey: queryKeys.apps.detail({ appId }),
  queryFn: () => appClient.getApp({ appId }),
});

// Invalidating queries:
queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
```

**Adding new keys:** Add entries to the appropriate domain in `queryKeys.ts`. Follow the existing pattern with `all` for the base key and factory functions using object parameters for parameterized keys.

## High-volume event batching

When an IPC event can fire at very high frequency (e.g., stdout/stderr from child processes), **batch messages and flush on a timer** instead of sending each message individually. This prevents IPC channel saturation, excessive array allocations in the renderer, and unnecessary React re-renders.

**Pattern** (see `app_handlers.ts` `enqueueAppOutput`/`flushAllAppOutputs`):

- Buffer outgoing events in a `Map<WebContents, Payload[]>`.
- Start a `setTimeout` on first enqueue; flush all buffered messages as a single batch event (e.g., `app:output-batch`) when the timer fires (100ms default).
- Flush immediately on process exit so no messages are lost.
- Keep latency-sensitive events (e.g., `input-requested`) on an immediate, unbatched channel.
- On the renderer side, process the entire batch array in a single state update (`setConsoleEntries(prev => [...prev, ...newEntries])`) instead of one update per message.

## Streaming chunk optimizations

The `chat:response:chunk` event supports two modes:

1. **Full update** — `messages` field contains the complete messages array. Used for initial message load, post-compaction refresh, and lazy-edit completions.
2. **Tail-only patch** — `streamingMessageId` + `streamingPatch: { offset, content }` fields. The renderer reconstructs the full content as `current.slice(0, offset) + content`. `offset` is the longest-common-prefix length between the previously sent content and the new full response (not simply the old length), because `cleanFullResponse` may retroactively rewrite bytes inside in-progress dyad-tag attribute values. Used for all normal high-frequency text-delta streaming. Implemented via `computeStreamingPatch` in `src/ipc/utils/stream_text_utils.ts`.

When modifying `ChatResponseChunkSchema` or adding new `safeSend("chat:response:chunk", ...)` call sites, decide which mode is appropriate. All frontend consumers (`useStreamChat`, `usePlanImplementation`, `useResolveMergeConflictsWithAI`) must handle both modes.

**Tail-diff baseline invariant:** Never call `safeSend("chat:response:chunk", { messages: ... })` directly in `local_agent_handler.ts`. Route all full-update sends through `sendResponseChunk(..., true, lastSentRef)` so `lastSentRef` stays in sync automatically. A bare `safeSend` bypasses the sync and leaves `lastSentRef` stale, causing the next patch to compute LCP against the wrong baseline and corrupting streamed output.

**Zod schema contract changes:** Making a field optional (e.g., `messages` → `messages.optional()`) causes TypeScript errors in all consumers that assume the field is always present. Search for all destructuring/usage sites and add guards before committing.

**Renderer-visible fields must be in the output schema:** `createTypedHandler` validates handler output through the contract's Zod schema. If the handler returns extra fields that are not declared in the output schema, renderer code cannot type-safely consume them and they may be stripped by parsing. Add any consumed fields (for example `appId` on `ChatSchema`) to the IPC output schema when relying on them in renderer code.

**Model refusals are stream completions, not errors:** AI SDK providers can normalize a successful safety refusal to `finishReason: "content-filter"` while preserving a provider-specific value such as `rawFinishReason: "refusal"`. Route every stream-consumption path (including continuation/fix streams) through the shared refusal handling, treat refusal as terminal for follow-up generation, discard incomplete output from the refused attempt, and persist a renderer-visible warning in both renderer content and AI history instead of relying on `onError` or matching generated text.

## End-of-turn warnings

When a main-process workflow needs to show a user-facing warning toast after a turn completes, thread it through every completion path, not just `chat:response:end`. Build-mode auto-approve and local-agent flows use `ChatResponseEndSchema`, while manual proposal approval uses `ApproveProposalResultSchema`; surface the warning in both `useStreamChat` and `ChatInput` so the behavior stays consistent.

## Package install command policy

When changing install-policy constants or helpers in `src/ipc/utils/socket_firewall.ts`, search all command builders before committing. The same policy can be consumed by add-dependency processing, app startup (`src/ipc/services/app_runtime_service.ts`), and cloud sandbox setup, so removing an export like `NPM_INSTALL_POLICY_ARGS` can leave stale imports that only `npm run ts` catches.

Do not treat "pnpm is available but older than the minimumReleaseAge-supporting version" the same as "pnpm is unavailable." `PNPM_INSTALL_POLICY_ARGS` currently use `--config.*` flags, which pnpm 10.15.0 and 9.0.0 accept on `pnpm install`; keep using pnpm with those flags when it is present, and only fall back to npm when the pnpm binary cannot be run.

When validating pnpm flag compatibility, test real subcommands such as `pnpm install`, `pnpm run`, and `pnpm add`, AND `pnpm --version` separately — the failure modes differ. Empirically (tested 8.15.9, 9.0.0, 9.15.4): older pnpm accepts arbitrary `--config.*` flags on real subcommands but rejects them on `--version` (`ERROR Unknown option: 'version'`). Keep availability probes flag-free (`pnpm --version` with `getPackageManagerCommandEnv()`, which delivers the same settings via `npm_config_*` env vars), or a working pnpm gets misreported as unavailable and Dyad silently falls back to npm.

When running Dyad-managed package-manager install/add/probe commands from inside an app directory, use `getPackageManagerCommandEnv()` so Corepack ignores stale project `packageManager` pins via `COREPACK_ENABLE_PROJECT_SPEC=0`. Apply this to `pnpm --version` probes and `npx sfw ...` wrappers too, since the wrapped package manager inherits the parent env; avoid forcing it onto user-authored custom commands unless intentionally changing their package-manager semantics.

When generating `pnpm-workspace.yaml` for install policy (`allowBuilds`, `minimumReleaseAge`), include a top-level `packages:` block such as `packages: ["." ]` if one does not already exist. pnpm 9 treats `pnpm-workspace.yaml` as a workspace manifest and fails with `packages field missing or empty` when the file only contains config keys.

Automated `pnpm add` commands that run in an app root with a generated `pnpm-workspace.yaml` must pass `--ignore-workspace-root-check`. Otherwise older pnpm versions can fail with `ERR_PNPM_ADDING_TO_ROOT` even though Dyad intentionally installs into that app root.

## React + IPC integration pattern

When creating hooks/components that call IPC handlers:

- Wrap reads in `useQuery`, using keys from `queryKeys` factory (see above), async `queryFn` that calls the relevant domain client (e.g., `appClient.getApp(...)`) or unified `ipc` namespace, and conditionally use `enabled`/`initialData`/`meta` as needed.
- Wrap writes in `useMutation`; validate inputs locally, call the domain client, and invalidate related queries on success. Use shared utilities (e.g., toast helpers) in `onError`.
- When a mutation changes fields exposed by both `apps.detail(...)` and `apps.all` (for example linking or unlinking a GitHub repository), invalidate both query families. Refreshing only the detail query can leave parent pages that derive conditional UI from the apps list stale.
- Synchronize TanStack Query data with any global state (like Jotai atoms) via `useEffect` only if required.
- Treat `queryClient.getQueryData(...)` as an optional cache peek. When a
  mutation post-effect must inspect IPC-backed data to decide correctness-critical
  work (such as restarting a runtime), use `fetchQuery`/`ensureQueryData` with
  the canonical query key and query function so cache eviction cannot skip it.
- For renderer launch telemetry that needs first-run state, do not infer it from `settings.hasRunBefore` after startup. `onFirstRunMaybe` flips that setting before `createWindow()`, so expose the pre-write value through an IPC/query context instead.
- Renderer-side `isProviderSetup()` env-var detection only sees env vars whitelisted by the `get-env-vars` handler in `src/ipc/handlers/app_handlers.ts`, which returns one `envVarName` per provider. Providers needing extra env vars (e.g. Azure's `AZURE_RESOURCE_NAME`) must have those keys added to the handler explicitly, or the renderer reports the provider as not set up even though the main process can use it.

## Unit-testing IPC handlers with the harness

`src/testing/handler_test_harness.ts` (`setupHandlerTestHarness` + `harness.invokeHandler("channel", input)`) gives you a real in-memory DB and works even for heavyweight modules: `registerAppHandlers` loads in vitest with just `vi.mock("electron")` plus module mocks for `@/paths/paths` (point `getDyadAppPath` at a temp dir), `@/ipc/services/git_service`, `createFromTemplate`, `gitignoreUtils`, and `chat_mode_resolution`.

- Only handlers registered via `createTypedHandler` land in the harness registry. Handlers registered with `createLoggedHandler`/`handle(...)` (e.g. `import_handlers.ts`) must be captured through the mocked `ipcMain.handle` — and their return value is an IPC envelope shaped `{ ok, value, error }` (NOT `{ success, data }`), so unwrap accordingly.
- Tests that invoke a captured `ipcMain.handle` listener run through the production trust facade. Call `configureTrustedRenderer(...)` and pass an event whose `senderFrame` matches `sender.mainFrame`; an empty `{}` event now fails with `Renderer trust policy is not configured` before the tested handler runs.

## Renderer trust and child windows

- In packaged builds, TanStack Router history updates turn the loaded `index.html` URL into root-relative locations such as `file:///chat` (`file:///C:/chat` on Windows). IPC trust must require `senderFrame === sender.mainFrame`, `file:` with an empty host, the configured file-volume prefix, and an allowlisted renderer route; pinning only the built entry pathname breaks packaged IPC, while accepting arbitrary file paths is unsafe.
- Electron's `setWindowOpenHandler` details do not identify the initiating frame. When preview iframes need popups, fail closed on missing or privileged request details and construct allowed HTTP(S) popups yourself after removing inherited `preload` and forcing sandboxed, Node-disabled web preferences; `about:blank` cannot be safely overridden this way.
- Keep a strong `BrowserWindow` reference for every popup created through a custom `createWindow` callback until its `closed` event. A callback-local window can be garbage-collected and close an active OAuth or payment flow; remove the reference on close so the owner collection remains bounded.
