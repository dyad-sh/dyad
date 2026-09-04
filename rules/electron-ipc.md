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

For a domain's first main-to-renderer event, also import its event-contract
object in `src/ipc/preload/channels.ts` and include it with
`getReceiveChannels(...)`. The receive allowlist is derived from imported event
objects, so defining and exporting an event alone does not make its channel
available through preload. Add the domain to `channels.test.ts` to prevent a
runtime `Invalid channel` failure that TypeScript cannot detect.

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

- `createStreamClient(...).start(input, callbacks, opts?)` returns the correlation identity for that `start()` call: an `InvocationRef` when supplied, or a legacy monotonic numeric `streamId`. It is not an abort handle — aborting still goes through the domain channel (e.g. `chat:cancel`).
- Each key holds at most one entry; a new `start()` for the same key replaces the previous entry, so events can never reach a replaced entry's callbacks (structural stale-event rejection).
- Stream payloads should echo the renderer's complete `InvocationRef`. When present, `createStreamClient` routes chunk/end/error events only to the matching operation; an absent ref preserves legacy key-only routing for in-flight streams crossing an app update. Numeric `streamId` matching remains only for older stream contracts.
- When changing stream correlation, audit every delegated producer that emits the same channels, not only the owning IPC handler. Keep executable models and co-sim inputs faithful to the real optional wire shape; do not fabricate a legacy identity on the new path.
- Mint an `InvocationRef` through the injected `IdSource` at the authoritative start boundary. Globally unique operation IDs eliminate cross-controller lifetime reuse without retaining per-key generation maps.
- Terminal stream callbacks may synchronously start a replacement stream with the same key. Cleanup after `onEnd`/`onError` (including invoke rejection) must delete the entry only when the map still points to the generation that ended; an unconditional keyed delete can orphan the replacement stream.
- By default the entry is removed when the end/error event arrives (`autoRelease: true`). Pass `{ autoRelease: false }` to keep receiving events after a terminal event, and call `release(key, { invocationRef })` when done — the chat stream machine uses this to keep entry ownership with its controller until finalization side effects complete (a stale release is a no-op).
- Chat streams: do NOT call `ipc.chatStream.start` or guard against duplicate streams from renderer code. The main-owned `chat_stream` actor is the single lifecycle and queue authority; submit through `useStreamChat().streamMessage` or `ChatStreamRemoteManager.ensure(chatId).send({ type: "submit", ... })`.
- Gate renderer queries that derive actions from the latest persisted assistant
  message while that chat is streaming. Main may persist an intermediate message,
  and caching a fallback result before the terminal invalidation can hide the
  completed proposal; disable the query during streaming and re-enable it on end.
  Force a fresh read on re-enable: an older in-flight request can settle after
  the terminal invalidation, clear its invalidated flag, and otherwise leave its
  intermediate result fresh under the global query `staleTime`.
- A null chat mode means the automatic default is still implicit. Renderer
  submissions must preserve that distinction with the existing null
  `requestedChatMode` sentinel instead of sending the computed display mode as
  an explicit override; otherwise main cannot apply the latest provider/quota
  state before the first turn.
- Apply model/mode compatibility rules in the authoritative main-process
  resolution as well as renderer previews. Share the normalization helper so
  an automatic mode cannot be displayed as valid and then latched as an
  incompatible mode when provider or quota state changes.
- Pass an authoritative per-turn model selection through an explicit
  `ModelSelection` parameter. Do not hide it inside a `UserSettings` override or
  detect it by duck-typing `settings.selectedModel`; that reverses chat/model
  precedence and creates an undeclared type contract. When changing
  `GetProviderOptionsParams`, audit every `getProviderOptions` caller, including
  assertion synthesis, compaction, and local-agent subagents.
- Keep durable first-turn acceptance atomic with latching an implicit chat
  mode. The idempotent user-message insert and conditional mode update belong
  in one synchronous SQLite transaction, duplicate replay must repair legacy
  null rows, and a concurrent conditional-update loser must use the stored
  winner before choosing prompts or tools.
- Run synchronous precondition checks that can reject a chat turn before its
  idempotency insert, implicit-mode latch, and renderer acceptance event.
  Otherwise a rejected request leaves durable state and replays as accepted
  even though no model turn ran.
- Queue mutations must go through the main actor's revisioned events. Pass the
  revision from the exact snapshot that rendered the action; falling back to a
  newer client snapshot can accept stale clear/edit/reorder intent against
  prompts the user never saw. Do not add renderer-owned queue atoms or
  full-snapshot queue persistence.
- Mirror bounded chat-prompt validation in the renderer before clearing the
  composer. A main-only schema rejection otherwise discards the user's draft
  before they can shorten it.
- Terminal observation and cleanup belong to the main actor and must not depend on renderer liveness. Renderer callbacks are window-local receipts only.
- The remote-machine transport rejects dispatch envelopes above 256 KiB before
  running the event codec and reports `invalid-event`. If a bounded domain
  schema legitimately permits larger payloads (for example base64 chat
  attachments), set that machine's `remote.maxDispatchEnvelopeBytes` to match
  the schema limit instead of raising the global transport limit.

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

**Electron readiness:** `readSettings()` and `writeSettings()` may decrypt/encrypt secrets through Electron `safeStorage`, which throws `safeStorage cannot be used before app is ready` before `app.whenReady()`. Queue pre-ready entry points like deep links (`open-url`, `second-instance`) until the app/window is ready before calling OAuth/settings handlers. In a multi-window flow, tie renderer readiness to the current delivery target: mark delivery not-ready when the target changes to a loading window, and drain only after that target finishes loading. A global first-window-ready flag can flush payloads to a different renderer before its listeners exist.
`did-finish-load` can still precede React effect subscriptions, so fire-and-forget startup events must register a renderer-module-level listener before bootstrap and replay buffered payloads when their UI consumer mounts.
Mark transport readiness before development-only completed-load filters: a DevTools reload can abort the initial navigation, making the filtered completion the window's only `did-finish-load` event.
Clear a window's renderer readiness only for a non-in-place main-frame `did-start-navigation`. `did-start-loading` is broader and can leave deep links queued when a usable renderer triggers loading activity that has no matching top-level `did-finish-load`.
When explicit window creation awaits `loadURL()` / `loadFile()`, start any
development-only DevTools reload only after that initial load promise resolves.
Scheduling the reload first can reject the awaited promise with
`ERR_ABORTED (-3)` and incorrectly roll back a healthy window.
When a loaded window consumes and clears a persisted one-shot event, send the
event through that known-ready window rather than `BrowserWindow.getAllWindows()[0]`.
In multi-window startup the first global window may still be loading, which
would drop the only replay before its early listener exists.
For cross-window ownership transfer, a successful `webContents.send()` is not
an acknowledgement. Buffer the request before React mounts, require a
correlated renderer receipt after local persistence, retain the main-process
transfer until that receipt arrives, and roll back source or destination state
on timeout/failure so the same stable identity cannot remain in both windows.
The typed IPC handler must return/await the receipt promise; dropping it reports
success early and turns later rejection into an unhandled main-process promise.
The persistence path used for the receipt must propagate or verify write
failure—best-effort storage adapters that log and swallow errors do not prove
durability.
If either side writes ownership to durable renderer storage before the receipt,
also reconcile duplicate stable identities across restorable sessions during
bootstrap. An in-memory coordinator cannot resolve the crash/restart window by
itself.
If the source durably removes transferred state before the destination observes
its acknowledgement, persist a correlated removal marker until the destination
observes that acknowledgement. On a lost receipt, the destination can use the
marker to keep its durable adoption instead of rolling back both copies.
The receipt timeout must retain that correlated settlement long enough for a
late confirmation; the destination's explicit rollback/rejection is the abort
decision that makes later source confirmation invalid.

When a replayed renderer event mutates persisted session state, do not consume
it until the session's derived atoms have hydrated. Persisting from empty
pre-hydration atoms can erase unrelated restored entities.

**Custom-protocol debugging:** Before using `git bisect` on a `dyad://` flow, quit every dev and packaged Dyad instance and verify which build owns the protocol registration. macOS may route the link to a different running/registered build, producing a convincing but false good/bad result.

## Handler expectations

- Keep handler registration free of database-dependent startup work. Handlers
  register before `onReady()` initializes SQLite; run restart reconciliation
  immediately after `initializeDatabase()` instead, or the first access fails
  once and is never retried.
- Handlers should `throw new Error("...")` on failure instead of returning `{ success: false }` style payloads.
- Entity-loading handlers that enrich a valid local row with optional external metadata must catch enrichment failures and return the base entity with nullable enrichment fields. Letting an OAuth/API failure reject the whole load can make renderer queries misreport an existing entity as missing.
- For **non-bug** failures (validation, not found, auth, user refusal, etc.), prefer `DyadError` with the right `DyadErrorKind` so PostHog does not flood with `$exception` events — see [rules/dyad-errors.md](dyad-errors.md).
- Use `createTypedHandler(contract, handler)` which validates inputs at runtime via Zod.
- Production invoke handlers must register through `createTypedHandler`, `createLoggedHandler`, or `registerTrustedIpcHandler`; never call `ipcMain.handle` or `ipcMain.handleOnce` directly outside `trusted_handle.ts`. The facade enforces the trusted-main-frame policy for both contract and legacy channels.
- When migrating a large inline `ipcMain.handle` callback to the trusted facade, extract a named local handler first. Adding another wrapper level around the inline callback makes the formatter reindent the entire body and obscures the security-only diff.
- Treat output schemas as type/validation contracts, not production serializers: `createTypedHandler` returns the handler result unchanged outside development. Explicitly project and map renderer-visible database columns before returning, especially for large or main-only fields such as `aiMessagesJson`.
- When editing shared IPC contract code imported by `src/preload.ts` (especially `src/ipc/contracts/core.ts`), run `npm run build` before E2E. The preload Vite target may not resolve `@/...` aliases from those shared modules; use relative imports for preload-reachable shared code when packaging reports `Rollup failed to resolve import "@/..."`.
- Avoid unguarded top-level `app.on(...)` or similar Electron API calls in modules that are imported broadly by tests. Many unit tests mock only the Electron APIs they touch, so prefer guarded calls like `app?.on?.(...)` or move event registration behind an explicit initialization function.
- Keep best-effort persistence failures from escaping `BrowserWindow` close
  callbacks. Catch and log file writes before continuing in-memory registry,
  focused-window, and delivery-target cleanup; otherwise a closed window can
  remain the authoritative target.
- Electron lifecycle events do not await async handlers. When `before-quit` must finish asynchronous cleanup, call `event.preventDefault()` synchronously, wait with a hard timeout, then call `app.quit()` again behind a re-entry guard so cleanup cannot hang or recursively restart shutdown.
- Treat the main process as terminal once `before-quit` starts disposing process-lifetime services. macOS `activate`/`open-url` and Electron `second-instance` can still arrive during that asynchronous gap; never create a replacement window or dispatch protocol work in the half-disposed process. A prevented quit can leave existing windows present, so count `activate` as a reopen request only when the normal activation policy would create a window. Preserve any new protocol URL in one shared relaunch request, strip stale protocol URLs from explicit relaunch arguments even for payload-free reopens, and call `app.relaunch()` exactly once immediately before the final guarded `app.quit()` instead of scheduling it in individual restart paths.
- When main awaits a correlated renderer decision that can auto-settle on timeout or abort, emit a request-specific terminal event for every settlement path. Key every actionable renderer projection (including native notifications) by that request ID, consume the terminal event in each projection, and guard async UI setup so it cannot create stale UI after settlement; stream-end cleanup alone may be delayed or never run.
- When splitting large handlers behind service boundaries, leave the handler responsible for IPC registration and request orchestration while moving runtime/policy logic into `src/ipc/services/*`. Preserve any intentional module side effects in the extracted service, such as `fixPath()` for child process PATH setup.
- Electron `net.request()` response typings do not expose every runtime stream event. If download code needs a `close` guard in addition to `aborted`/`error`, cast the response through `EventEmitter` instead of dropping the guard to appease `npm run ts`.
- When combining a user-controlled signal with `AbortSignal.timeout()` via `AbortSignal.any()`, do not identify every fetch cancellation by matching `AbortError`: Node propagates the timeout signal's `TimeoutError` reason. Check the original controller's `signal.aborted` and the timeout signal's `aborted` state separately so user cancellation and timeout keep their intended error classifications.
- Chat/provider retry backoff must race the request's `AbortSignal`, clear its timer and listener on either settlement, and recheck cancellation immediately before starting the next attempt. Otherwise Stop can remain pending for the full delay and launch another provider request after cancellation.
- A handler that registers `event.sender.once("destroyed", ...)` **after** its first `await` can miss the event entirely — it fires once, and a window that closed during the await is already gone. Registering earlier is often impossible (the cleanup closure does not exist yet), so also check the `event.sender.isDestroyed?.()` flag immediately after registering: it is state, not an event, and still reports an owner that left. This matters most for handlers that hold long-lived resources (`recording:start` holds the app's coordinator claims for 30 minutes); pair it with an `AbortSignal.aborted` check at the top of the coordinated callback so a session ended before admission never sets anything up.
- For cancellable file persistence, passing an `AbortSignal` to `fs.promises.writeFile` is not sufficient because cancellation is best-effort and may leave a partial file. Write to a same-directory temporary path, remove it on failure or abort, check cancellation before and after an atomic rename, and remove the finalized path if cancellation raced the rename.

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

## Events and invoke replies are not ordered relative to each other

An `invoke` reply and a `safeSend`/`webContents.send` event travel different Electron interfaces, so a renderer can observe them in either order even when main emits the event strictly before the handler returns. Never let an event handler reset state that an in-flight invoke's continuation is about to set — the reset can land last and wipe the result.

Symptom: a flow works, then intermittently "does nothing", as if the successful path never ran. Fix by making the event handler ignore endings the renderer itself requested (e.g. `recording:ended` with `reason === "stopped"` in `useTestRecorder`), rather than relying on the ordering that happens to hold today.

For cancellable operations that cross an irreversible boundary, close
cancellation in main synchronously immediately before starting that mutation,
and make later cancel invokes return `false`. A renderer progress event is only
presentation; it can arrive after a cancel invoke on a separate IPC interface.

When app-scoped lifecycle state explains why another workflow is waiting,
preserve and check the operation source or correlation identity. An app id plus
phase is insufficient when a panel-started operation can overlap an unrelated
chat cancellation and make otherwise accurate explanatory copy misleading.

## High-volume event batching

When an IPC event can fire at very high frequency (e.g., stdout/stderr from child processes), **batch messages and flush on a timer** instead of sending each message individually. This prevents IPC channel saturation, excessive array allocations in the renderer, and unnecessary React re-renders.

**Pattern** (see `app_handlers.ts` `enqueueAppOutput`/`flushAllAppOutputs`):

- Buffer outgoing events by registered window identity and keyed entity
  interest. A renderer closing or crashing can make `send()` throw after a
  liveness check, so catch per destination (and per payload for individual
  delivery) to ensure one failed window cannot abort fanout to healthy peers or
  escape from a timer callback.
- A proxy that masks `WebContents.isDestroyed()` to observe terminal sends must
  dynamically expose a non-integer producer ID once its real target is gone.
  Otherwise high-volume routing can re-register the destroyed endpoint.
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

**Peer-stream correlation:** A multi-window passive stream consumer may project
chunks classified as unsolicited because that renderer has no local invocation
owner. It must not project chunks classified as stale: those belong to a
superseded local invocation and retaining the old correlation rejection prevents
late output from overwriting the current stream.

**Zod schema contract changes:** Making a field optional (e.g., `messages` → `messages.optional()`) causes TypeScript errors in all consumers that assume the field is always present. Search for all destructuring/usage sites and add guards before committing.

**Renderer-visible fields must be in the output schema:** `createTypedHandler` validates handler output through the contract's Zod schema. If the handler returns extra fields that are not declared in the output schema, renderer code cannot type-safely consume them and they may be stripped by parsing. Add any consumed fields (for example `appId` on `ChatSchema`) to the IPC output schema when relying on them in renderer code.

When one IPC producer needs stronger presentation semantics (for example, a persistent multiline error toast), carry that intent as an explicit optional event field and scope it at the producer. Do not infer global renderer behavior from message shape such as the presence of a newline; shared toast/event consumers serve unrelated features and tests.

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

Electron `WebContentsView` surfaces are composited above the renderer DOM, so
portals and higher CSS `z-index` values cannot cover them. For overlapping
workbench UI, hide the native view with `setVisible(false)` and paint a
renderer-side in-memory `capturePage()` fallback; pass `{ stayHidden: true }`
when capturing a hidden view so Electron cannot flash it back above the DOM.

When creating hooks/components that call IPC handlers:

- When diagnosing a preview stuck at `Waiting for server logs…`, distinguish the
  ordinary selection IPC from the app-run actor transport: `App <id> selected for preview`
  without a later `Starting app`, `already running`, or
  `Restarting app` entry means selection succeeded but lifecycle dispatch never
  reached main. Switching apps cannot repair a renderer-owned app-run manager
  that is stuck in that state.
- Treat a window-session ID as potentially durable even when BrowserWindow
  layout is process-local: renderer storage may use it as a namespace. Keep the
  primary ID stable or migrate its storage before pruning old session keys.
- On macOS, `activate` can arrive while asynchronous startup is still running.
  Gate Dock window creation until the initial window exists, or use one
  idempotent ensure-window path, so startup cannot create stacked renderers.
- Before destroying a BrowserWindow during creation rollback, remove its
  session descriptor from authoritative state. Electron may emit `closed`
  synchronously, and close handlers must not retain a failed window for Dock
  activation.
- Treat request/correlation IDs as identifiers, not capabilities. If an ID can
  appear in a shared snapshot, operation wait and cancellation paths must also
  verify the invoking window-session ownership before exposing or mutating the
  correlated outcome.
- For renderer event streams with a bootstrap/replay epoch, subscribe before
  bootstrapping, pass the last applied epoch (`0` for a fresh cache), and dedupe
  buffered live events against replay. Advancing directly to the bootstrap's
  current epoch can acknowledge and discard an event received during startup.
  Retry failed bootstrap attempts with bounded backoff, clearing pending data
  that the next epoch replay will recover so a half-initialized listener cannot
  grow an unbounded queue. Keep long-term gap-recovery history bounded by
  compacting entity-specific scopes to family-root invalidations once precision
  is no longer required; a bounded event journal alone does not bound a
  lifetime recovery-scope map.
- Async keyed subscription attach must use a generation/current-state check
  after awaiting bootstrap and roll back that generation on rejection.
  Otherwise detach or replacement during bootstrap can deliver stale data, and
  a rejected bootstrap can leave later payloads buffered forever. Pending
  delivery queues must also retain the interest/generation key so replacement
  can discard superseded payloads before sending its bootstrap.
- Contract-declared query invalidation runs only through typed handler wrappers.
  Legacy handlers registered through `createLoggedHandler`/`handle(...)` must
  publish after their authoritative mutation explicitly or migrate to a typed
  contract. When the origin renderer installs only some mutation scopes
  locally, carry the exact handled scopes with the invalidation event: peers
  invalidate every scope, while the origin skips only equivalent local data
  and still receives its unhandled scopes. Omitted origin-handled metadata must
  default to no handled scopes; only declare `originHandles` when every caller
  of that contract performs the matching local cache update/invalidation.
- Wrap reads in `useQuery`, using keys from `queryKeys` factory (see above), async `queryFn` that calls the relevant domain client (e.g., `appClient.getApp(...)`) or unified `ipc` namespace, and conditionally use `enabled`/`initialData`/`meta` as needed.
- Wrap writes in `useMutation`; validate inputs locally, call the domain client, and invalidate related queries on success. Use shared utilities (e.g., toast helpers) in `onError`.
- When a mutation changes fields exposed by both `apps.detail(...)` and `apps.all` (for example linking or unlinking a GitHub repository), invalidate both query families. Refreshing only the detail query can leave parent pages that derive conditional UI from the apps list stale.
- Synchronize TanStack Query data with any global state (like Jotai atoms) via `useEffect` only if required.
- Root-mounted effects that automatically persist settings must depend on
  stable derived values rather than hook-returned callback identities. Set an
  in-flight ref before invoking the mutation to survive Strict Mode effect
  replay and mutation-state rerenders, and handle the returned promise so
  transient write failures do not become unhandled rejections.
- Treat `queryClient.getQueryData(...)` as an optional cache peek. When a
  mutation post-effect must inspect IPC-backed data to decide correctness-critical
  work (such as restarting a runtime), use `fetchQuery`/`ensureQueryData` with
  the canonical query key and query function so cache eviction cannot skip it.
- For renderer launch telemetry that needs first-run state, do not infer it from `settings.hasRunBefore` after startup. `onFirstRunMaybe` flips that setting before `createWindow()`, so expose the pre-write value through an IPC/query context instead.
- Renderer-side `isProviderSetup()` env-var detection only sees env vars whitelisted by the `get-env-vars` handler in `src/ipc/handlers/app_handlers.ts`, which returns one `envVarName` per provider. Providers needing extra env vars (e.g. Azure's `AZURE_RESOURCE_NAME`) must have those keys added to the handler explicitly, or the renderer reports the provider as not set up even though the main process can use it.

## Unit-testing IPC handlers with the harness

`src/testing/handler_test_harness.ts` (`setupHandlerTestHarness` + `harness.invokeHandler("channel", input)`) gives you a real in-memory DB and works even for heavyweight modules: `registerAppHandlers` loads in vitest with just `vi.mock("electron")` plus module mocks for `@/paths/paths` (point `getDyadAppPath` at a temp dir), `@/ipc/services/git_service`, `createFromTemplate`, `gitignoreUtils`, and `chat_mode_resolution`.

- Preserve async helper contracts used by IPC handlers unless every caller and
  test mock is migrated together. A still-async mock consumed without `await`
  can pass a `Promise` into a database binding and fail far from the changed
  helper.
- Only handlers registered via `createTypedHandler` land in the harness registry. Handlers registered with `createLoggedHandler`/`handle(...)` (e.g. `import_handlers.ts`) must be captured through the mocked `ipcMain.handle` — and their return value is an IPC envelope shaped `{ ok, value, error }` (NOT `{ success, data }`), so unwrap accordingly.
- Tests that invoke a captured `ipcMain.handle` listener run through the production trust facade. Call `configureTrustedRenderer(...)` and pass an event whose `senderFrame` matches `sender.mainFrame`; an empty `{}` event now fails with `Renderer trust policy is not configured` before the tested handler runs.

## Renderer trust and child windows

- In packaged builds, TanStack Router history updates turn the loaded `index.html` URL into root-relative locations such as `file:///chat` (`file:///C:/chat` on Windows). IPC trust must require `senderFrame === sender.mainFrame`, `file:` with an empty host, the configured file-volume prefix, and an allowlisted renderer route; pinning only the built entry pathname breaks packaged IPC, while accepting arbitrary file paths is unsafe.
- Electron's `setWindowOpenHandler` details do not identify the initiating frame. When preview iframes need popups, fail closed on missing or privileged request details and construct allowed HTTP(S) popups yourself after removing inherited `preload` and forcing sandboxed, Node-disabled web preferences; `about:blank` cannot be safely overridden this way.
- Keep a strong `BrowserWindow` reference for every popup created through a custom `createWindow` callback until its `closed` event. A callback-local window can be garbage-collected and close an active OAuth or payment flow; remove the reference on close so the owner collection remains bounded.
- Cookies are scoped by host, never port. A clear for `http://localhost:<port>` therefore affects every localhost preview in the session. By default, previews avoid that collision with stable `app-<id>.localhost` hostnames; scoped clearing must derive the active runtime's origin and validate that exact per-app hostname before calling `session.clearStorageData`. If the user explicitly disables localhost preview isolation, shared-session clearing is allowed only for a validated loopback preview and the UI must warn that other previews may be signed out.
