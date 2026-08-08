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

- `createStreamClient(...).start()` returns `void`, not a cleanup/unsubscribe function. You cannot capture a handle to abort or clean up an active stream from the caller side.
- To guard against duplicate streams, use a module-level `Set` (like `pendingStreamChatIds` in `useStreamChat.ts`) or a React state/ref-based lock, not the return value.
- **Never gate global-state cleanup in `onEnd`/`onError` on a local `isMountedRef`.** Stream callbacks outlive the component that started them. If the user navigates away mid-stream, an unmount-guarded `onEnd` skips `setIsStreamingByIdAtom(false)` and `syncChatFromDb`, leaving the chat permanently `isStreaming=true` — `ChatPanel.fetchChatMessages` then skips IPC fetches forever and only a page refresh recovers. Always run global Jotai state writes and DB syncs unconditionally; only guard UI-only side effects (toasts, console logs, local React state) on mount. See `useStreamChat.ts` for the no-guard pattern.

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

**Electron readiness:** `readSettings()` and `writeSettings()` may decrypt/encrypt secrets through Electron `safeStorage`, which throws `safeStorage cannot be used before app is ready` before `app.whenReady()`. Queue pre-ready entry points like deep links (`open-url`, `second-instance`) until the app/window is ready before calling OAuth/settings handlers.

## Handler expectations

- Handlers should `throw new Error("...")` on failure instead of returning `{ success: false }` style payloads.
- For **non-bug** failures (validation, not found, auth, user refusal, etc.), prefer `DyadError` with the right `DyadErrorKind` so PostHog does not flood with `$exception` events — see [rules/dyad-errors.md](dyad-errors.md).
- Use `createTypedHandler(contract, handler)` which validates inputs at runtime via Zod.
- Avoid unguarded top-level `app.on(...)` or similar Electron API calls in modules that are imported broadly by tests. Many unit tests mock only the Electron APIs they touch, so prefer guarded calls like `app?.on?.(...)` or move event registration behind an explicit initialization function.

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

## End-of-turn warnings

When a main-process workflow needs to show a user-facing warning toast after a turn completes, thread it through every completion path, not just `chat:response:end`. Build-mode auto-approve and local-agent flows use `ChatResponseEndSchema`, while manual proposal approval uses `ApproveProposalResultSchema`; surface the warning in both `useStreamChat` and `ChatInput` so the behavior stays consistent.

## React + IPC integration pattern

When creating hooks/components that call IPC handlers:

- Wrap reads in `useQuery`, using keys from `queryKeys` factory (see above), async `queryFn` that calls the relevant domain client (e.g., `appClient.getApp(...)`) or unified `ipc` namespace, and conditionally use `enabled`/`initialData`/`meta` as needed.
- Wrap writes in `useMutation`; validate inputs locally, call the domain client, and invalidate related queries on success. Use shared utilities (e.g., toast helpers) in `onError`.
- Synchronize TanStack Query data with any global state (like Jotai atoms) via `useEffect` only if required.
