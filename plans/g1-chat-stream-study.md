# G1 — Chat-stream/main feasibility study

## Status and decision

**Decision: GO for C3, after the app-run remote-actor pilot proves the common
transport. Do not lift the renderer controller into main unchanged.**

The feasible design is a main-owned per-chat lifecycle actor plus a
main-owned prompt queue with an explicit per-entry persistence policy. A
serialized turn intent replaces `StreamRequest` callbacks. SQLite acceptance
is the durable linearization point for a user message. Windows materialize
ordered message deltas and revisioned read models; they do not own stream,
queue, or handoff lifecycle.

This is a design gate, not implementation approval for every detail. C3 may
start only with:

1. the common remote actor bootstrap/receipt protocol proven by the app-run
   pilot;
2. the turn-intent and queue schemas reviewed together;
3. the acceptance transaction tested under crash injection;
4. the WindowRegistry presentation and capability-routing APIs available.

A callback-preserving process move, a renderer `QueueStore`, or a
revision-free renderer `MessagesStore` is a **no-go**.

## Inputs and fixed decisions

This study uses:

- the ten questions and five artifacts required by
  `plans/cleanup-state-machines.md`;
- recorded product decisions 1–5 and the Remote intent policy in that plan;
- the `chat_stream` actor lifecycle row;
- the chat-stream study and durable protocol actor pattern in
  `plans/distrbuted-machines.md`;
- the reader inventories and preservation constraints in
  `plans/claude-cleanup-machines.md`;
- current `src/chat_stream/`, queue persistence, plan handoff, and user-input
  follow-up code.

G1a is settled. This study assumes:

- `StreamState` is the sole streaming-status authority;
- no controller/read-model entry means idle;
- status reads use the G1a selectors and facade;
- external errors enter the machine as an event;
- the bounded last-error behavior follows G1a.

It does not reopen those choices.

One requested input has moved: `src/user_input/follow_up_handoff.ts` does not
exist in the current tree. Commit `39013e294` deleted it in favor of the
memory-owned recovery described in
`docs/user-input-follow-up-recovery.md`. The live callback bridge is now
`createUserInputChatStreamFacade` in
`src/app_wiring/registerRendererIpcListeners.ts:25-62`. The current contract
survives renderer reload while main remains alive, but intentionally drops the
owner on a full app-process restart
(`docs/user-input-follow-up-recovery.md:41-51`).

## Current boundary in one paragraph

Main already owns admission barriers, the `AbortController`, the LLM/tool
execution, the durable message insert, cancellation unwind, and the unique
follow-up acceptance key
(`src/ipc/handlers/chat_stream_handlers.ts:606-737`,
`src/ipc/handlers/chat_turn_acceptance.ts:27-90`). The renderer owns a second
lifecycle controller, callback-bearing requests, the editable queue, queue
persistence orchestration, message materialization, finalization effects, and
completion listeners. Moving authority to main is therefore a consolidation,
but only after callbacks, browser `File` objects, Jotai transactions, and
presentation effects are replaced by explicit protocol boundaries.

## The ten G1 decisions

### 1. Who owns optimistic and durably accepted messages?

**Recommendation**

Main/SQLite owns accepted messages. A window may show an initiator-local
optimistic row keyed by a stable `intentId`, but that row is presentation
state, is not broadcast, and is never considered accepted. It reconciles only
from a typed acceptance result or the message read model.

Every ordinary submit receives an `intentId` before crossing IPC. Durable
acceptance means one SQLite transaction has:

- validated the immutable intent envelope;
- inserted or observed the idempotent user message;
- latched/reconciled first-turn chat mode;
- advanced the intent/queue record to `accepted`;
- advanced the message read-model revision/outbox.

The current database insert is already the strongest existing boundary:
`acceptChatTurn` inserts the user message and latches chat mode atomically
(`src/ipc/handlers/chat_turn_acceptance.ts:27-90`). Follow-ups additionally
deduplicate on `(chat_id, user_input_request_id)`
(`src/db/schema.ts:151-193`). C3 generalizes this to every turn with an
immutable `intentId` and payload hash.

Accepted does not mean model/tool execution completed. Execution and terminal
outcomes remain lifecycle facts.

**Alternatives rejected**

- **Renderer messages are authoritative until finalization.** This creates a
  multi-primary message history and loses accepted content on renderer
  destruction.
- **Treat dispatch commit as message acceptance.** The actor can commit before
  the database command runs; commit is not durable acceptance.
- **Use the current first chunk as the acceptance acknowledgement.** The chunk
  is a lossy notification and its callback disappears on reload.
- **Broadcast optimistic rows to all windows.** A rejected or altered intent
  would become shared fiction. Other windows see it only after main accepts it.

### 2. What belongs in lifecycle snapshots versus the chunk path?

**Recommendation**

The actor snapshot carries low-frequency lifecycle and correlation only:
phase, active intent/invocation, target app, cancellation/finalization facts,
G1a error, capabilities, and revisions. LLM text, full message arrays,
streaming patches, tool preview text, console output, and attachment bytes stay
off actor snapshots.

The existing chunk protocol already separates full message replacement,
tail-patch updates, and preview overlays
(`src/ipc/types/chat.ts:218-246`). Retain that shape behind an
interest-keyed, per-`webContents` high-volume subscription. Add an ordered
cursor and bootstrap contract. A terminal flush supplies the canonical message
revision so an attached window can reconcile server-assigned fields such as
`commitHash`, which the renderer currently fetches at finalization
(`src/chat_stream/commands.ts:560-591`).

Runtime handles stay in an ephemeral table beside the actor, never in its
snapshot: `AbortController`, running promise/task, admission waiters, partial
response buffers, transport subscribers, and ack timers.

**Alternatives rejected**

- **Put messages or chunks in `StreamState`.** Every token would republish the
  lifecycle snapshot to all status subscribers and make snapshots large.
- **Keep callback-based per-stream IPC.** Its registry is renderer-memory-owned
  and cannot bootstrap a replacement window.
- **Use only React Query refetches.** It cannot provide token-rate updates or
  preserve ordered patch bases.

### 3. Who owns the editable queue, and how is it persisted?

**Recommendation**

Main owns one per-chat queue aggregate containing entries and pause state.
Queue mutations are serialized through that aggregate. Ordinary user entries
and durable-protocol entries persist in SQLite. A memory-owned user-input
follow-up remains explicitly `main-session` and is not persisted until it
reaches the message-acceptance transaction; this preserves the current
full-process-restart boundary and the rule against persisted shells whose
owner is memory-only. Attachment bytes are staged before durable queue
acceptance and referenced by stable attachment IDs; they are not embedded in
lifecycle snapshots.

The aggregate preserves all existing behavior:

- FIFO order and stable item IDs;
- append-before-poke semantics;
- atomic “if not paused, claim head”;
- edit/reorder only for user-owned pending entries;
- machine-owned entries cannot be edited or removed without owner settlement;
- remove/clear claims invocation-time items before settlement, restores failed
  owners in place, and preserves concurrently appended entries;
- `undefined` versus `null` requested-chat-mode semantics;
- restored queues are paused for review.

Queue mutation intent is state-sensitive and carries `expectedQueueRevision`.
Pause/resume, edit, reorder, remove, and clear return authoritative receipts.
A queued submit returns `durably-queued` or `queued-for-main-session`, not
stream success.

On full app restart, durable queued entries hydrate paused. Session-only
follow-ups are absent with their memory owners. An intent already accepted as
a message but interrupted during execution is not put back in the editable
queue; it becomes an explicit interrupted turn eligible for user-directed
retry. C3 does not promise exactly-once external tool effects.

**Alternatives rejected**

- **Build the appendix’s renderer `QueueStore`.** It would be a temporary
  authority and remains unsafe with two windows.
- **Keep full-snapshot renderer writes to `.dyad/queue`.** The current store
  assumes one writer (`src/main/queue_store.ts:139-142`) and cannot atomically
  couple dequeue with message acceptance.
- **Persist callback-bearing owner entries.** Restart would produce immutable,
  callback-less orphan shells; the current code correctly filters them out
  (`src/hooks/useQueuePersistence.ts:16-45`).
- **Split pause and entries into separate stores.** The conditional pop would
  again observe torn state.

### 4. How do callbacks become receipts and observable outcomes?

**Recommendation**

Replace all four `StreamRequest` callbacks with IDs and typed outcomes:

- `intentId` correlates one submission and all UI outcomes;
- `invocationRef` identifies the active execution and cancellation target;
- an optional owner protocol key identifies a durable handoff;
- the remote dispatch receipt reports rejected, ignored, committed, or
  transport failure;
- a domain acceptance result reports `durably-queued`,
  `message-accepted`, `message-replayed`, or typed rejection;
- lifecycle/read-model events report execution completion, cancellation,
  interruption, and failure.

`onSettled` consumers subscribe by `intentId` or invocation and derive their
one-shot behavior from a deduplicated terminal record. Queue admission settles
the submission operation without pretending the queued turn completed.
Expected failures are data, not rejected transport promises. Presentation
consumers may register live callbacks in a window adapter, but those callbacks
are downstream of the serializable protocol and never stored in host state.

**Alternatives rejected**

- **Serialize callback names.** There is no durable callable owner after window
  destruction, and a name does not define settlement semantics.
- **One `dispatchAndWaitForEffects` promise.** It conflates actor commit,
  durable acceptance, and long-running completion.
- **Infer success by comparing snapshots.** Command-only events and duplicate
  acceptance make this ambiguous.

### 5. How does the user-input follow-up hand off durably?

**Recommendation**

Move the handoff entirely into main and use the user-input `requestId` as the
domain idempotency key. The current user-input request remains memory-owned
across the app-process lifetime; G1 does **not** restore the deleted second
user-input lifecycle table. “Durable handoff” here means receiver acceptance
is durable before user-input settles, not that the original parked waiter
survives process death.

The main user-input registry calls a typed chat-turn acceptance facade
directly. Before the acceptance transaction, the facade verifies that the
memory-owned request is still due. In the transaction, the receiver:

1. loads the immutable turn-intent envelope;
2. verifies chat, prompt/mode payload hash, and request identity;
3. inserts or observes the keyed user message;
4. marks the turn intent accepted;
5. returns a typed accepted/replayed result.

Only after commit does the in-memory user-input registry transition to
`dispatched`. If that local transition fails without process death, retry
observes the same accepted intent and completes settlement. Same-key/different
chat or different-payload replay is `Conflict`, not acceptance. This closes
the current gap in which a chunk callback fires and a second IPC separately
settles user-input
(`src/user_input/projection.ts:298-341`).

Full main-process restart retains the recorded product behavior: unaccepted
memory-owned follow-ups are dropped. If the message transaction committed
before the crash, the message remains accepted and the turn is reconciled as
interrupted; it is not silently executed twice. If product later requires
cross-restart delivery, that is a separate durable protocol actor with an
explicit recovery UX, not a reason to persist callbacks.

**Alternatives rejected**

- **Restore the deleted owner-session table as-is.** Its historical recovery
  rejected previous-session work; it was bookkeeping, not resumable delivery.
- **Keep renderer callback acknowledgement.** Renderer reload is an avoidable
  participant in a main-to-main handoff.
- **Use only the message uniqueness constraint.** It does not validate an
  immutable payload or record pending/rejected/interrupted protocol state.
- **Promise exactly-once model execution.** Provider calls and agent tools do
  not provide that guarantee.

### 6. Where does plan handoff run?

**Recommendation**

`plan_handoff` becomes a main-owned durable protocol actor and depends on the
main chat-turn facade. The acceptance boundary captures:

- source chat and app;
- `acceptInNewChat`;
- immutable plan identity/version and content hash;
- handoff idempotency key;
- initiating window for presentation routing.

The actor checkpoints plan persistence, chat creation or mode switch, waiting
for stream idle, and implementation-turn acceptance. Chat creation and final
`/implement-plan=` submission each have stable idempotency keys. It reports
“implementation started” only after the receiver accepts the implementation
turn, not immediately after calling submit as today
(`src/plan_handoff/commands.ts:208-216`).

Navigation, preview-mode changes, accepted badges, and failure toasts are
renderer presentation/read-model consumers. The latest editable plan document
remains renderer data until accept; accept captures an immutable version so a
reload or another window cannot change the in-flight handoff.

**Alternatives rejected**

- **Keep plan handoff renderer-owned.** It loses its timer/checkpoints on reload,
  crosses chats, and can outlive the initiating window.
- **Move only the final submit to main.** The earlier persist/create/switch
  steps remain non-recoverable and can duplicate.
- **Let main lazily read `planStateAtom`.** Main cannot read a window-local atom,
  and “latest” is undefined with multiple windows.

### 7. What happens on renderer reload, window close, quit, and restart?

**Recommendation**

The `chat_stream` lifecycle matrix becomes:

| Boundary                 | Required behavior                                                                                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No subscribers           | Active stream and queue continue. Idle actors may evict after their retained read models are safe.                                                                                                                                             |
| Renderer reload          | Release that `webContents` subscriptions and presentation callbacks. Main work continues. New renderer bootstraps lifecycle, messages, queue, handoff, and completion cursors.                                                                 |
| Initiating window closes | Work continues. Operation presentation falls back by recorded product decision 5. Closing is not cancel.                                                                                                                                       |
| Last window closes       | Follow platform convention. On macOS, main work continues while the app remains alive. Windows/Linux follow actual app shutdown, not subscriber count.                                                                                         |
| App quit                 | Stop admission; mark executing turns interrupted; abort streams; await bounded write unwind; flush queue/intent transactions and actor read models; do not wait indefinitely for providers.                                                    |
| App restart              | Hydrate queued entries paused. Reconcile `accepted`/`executing` intents to interrupted, never silently auto-run agent/tool work. Memory-owned user-input follow-ups are absent by the recorded current policy.                                 |
| Chat/app deletion        | Atomically claim queue and protocol records; settle/reject owners; cancel and unwind the active invocation; delete read models and staged attachments; only then delete the entity. Settlement failure restores the claim and blocks deletion. |

This preserves product decisions 2 and 3 while making the current renderer
disposal behavior obsolete. Today controller disposal settles callbacks,
publishes idle, and releases transport
(`src/chat_stream/controller.ts:97-148`); after C3, window disposal must not
publish authoritative idle or settle main-owned work.

Entity deletion uses the main registry's authoritative sweep, not a renderer
callback. It first claims the affected queue entries so no driver can start
them. If settling a session owner unexpectedly fails, the claim is restored
and deletion fails visibly; the database cascade does not proceed. App quit
uses its separately defined bounded shutdown sweep and may record interruption,
but that does not weaken interactive chat/app deletion.

**Alternatives rejected**

- **Cancel when the initiating window disappears.** This contradicts recorded
  decision 2 and makes multi-window ownership depend on presentation.
- **Auto-resume interrupted agent turns after restart.** External effects may
  already have occurred.
- **Restore the queue unpaused.** It creates hidden work after an hours-later
  restart; current restore-paused behavior is intentionally transparent
  (`src/hooks/useQueuePersistence.ts:165-185`).

### 8. How are notifications and screenshots routed?

**Recommendation**

Terminal domain facts commit in main before presentation routing.

- Inline shared errors are visible in every subscribed chat view.
- Operation toasts, navigation, preview-open, and scroll/focus effects target
  the initiating window, then use recorded fallback decision 5.
- If no eligible window remains, important completion uses a native
  notification from main.
- Query invalidations use the global invalidation epoch and reach every
  relevant window, including origin.
- A screenshot is a typed presentation capability request keyed by
  `(invocationRef, targetAppId, "post-stream")`. WindowRegistry leases exactly
  one visible, matching iframe capability. It is never broadcast
  first-response-wins.
- Lease loss before acknowledgement permits a bounded reroute. No eligible
  capability means `skipped-no-capability`; it does not fail stream
  finalization or create an unbounded durable backlog.

Each live presentation event has a stable `presentationEventId`. Windows
deduplicate it. Missing a toast, scroll, or screenshot never changes domain
state.

The current renderer command directly opens preview, bumps reload, and writes
a screenshot mailbox (`src/chat_stream/commands.ts:518-529`). Those become
post-commit routed effects; no actor state imports renderer atoms.

**Alternatives rejected**

- **Send every effect to every subscribed window.** Duplicate navigation,
  toasts, and screenshots are incorrect.
- **Bind chat stream to one singleton screenshot manager.** It cannot select a
  valid iframe in a multi-window app.
- **Make screenshot success part of stream success.** A DOM capability is
  optional presentation, not durable chat completion.

### 9. Does completion history belong in lifecycle state?

**Recommendation**

No. Lifecycle state contains only the current phase and, while needed for G1a,
the current/last error. Completion records live in a separate bounded,
session-scoped read model:

```ts
interface ChatCompletionRecord {
  completionSeq: number;
  chatId: number;
  intentId: string;
  invocationRef: ChatStreamInvocationRef;
  outcome: "completed" | "cancelled" | "errored" | "interrupted";
  completedAt: number;
  chatSummary?: string;
  updatedFiles: boolean;
  pausePromptQueue: boolean;
}
```

The actor appends after terminal commit. Consumers use
`(actorInstanceId, completionSeq)` for deduplication. Retain a small per-chat
ring plus a global bound; prune metadata with entries. The history survives
renderer reload while main remains alive but is not replayed as a fresh toast
after full app restart. Durable message/intent recovery facts supply crash
recovery.

This replaces the current ephemeral `subscribeStreamFinished` callback
(`src/chat_stream/manager.ts:136-141,207-253`) without growing lifecycle
snapshots or pinning terminal actors.

**Alternatives rejected**

- **Retain terminal history inside `StreamState`.** It prevents quiescent actor
  eviction and republishes unrelated history on each transition.
- **Keep live callback listeners only.** Reload can miss the completion edge.
- **Persist notification history as domain state.** It replays stale UI effects
  after restart and duplicates durable message facts.

### 10. What are the revision and bootstrap semantics?

**Recommendation**

Every renderer read model has one main writer, an explicit schema version, and
its own ordering identity:

| Read model               | Ordering                                                      | Gap/bootstrap rule                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lifecycle                | `(actorInstanceId, actorRevision)`                            | Replace on bootstrap; ignore older actor/revision; actor-disposed envelope means absent/idle per G1a.                                                                                                                          |
| Messages/materializer    | `(messageEpoch, messageRevision, invocationRef, deliverySeq)` | Bootstrap canonical messages plus active cursor; patch base/hash or sequence gap triggers chat refetch and a new epoch. `deliverySeq` is host-assigned for every delta and is distinct from optional canned-stream `chunkSeq`. |
| Queue                    | `queueRevision` per chat                                      | Full queue+pause bootstrap; state-sensitive mutations require expected revision; gap replaces from main.                                                                                                                       |
| Plan handoff             | `(actorInstanceId, handoffRevision)`                          | Full protocol projection bootstrap; presentation events are separate and deduped.                                                                                                                                              |
| Completion history       | `completionSeq` within main session                           | Bootstrap retained records, then drain greater sequences; bootstrap records do not replay live-only presentation.                                                                                                              |
| Query cache invalidation | one global `epoch`                                            | Any gap conservatively invalidates affected query families.                                                                                                                                                                    |
| Presentation             | `presentationEventId`                                         | Live-only dedupe; never used to reconstruct domain state.                                                                                                                                                                      |

For each subscription, main:

1. authorizes the entity and installs interest for the `webContents`;
2. captures the snapshot and high-volume cursors;
3. buffers later envelopes for that subscriber;
4. returns/sends the bootstrap;
5. drains only envelopes newer than the captured cursors;
6. removes all interest on `webContents.destroyed`.

The renderer does not expose ready data until the bootstrap is applied. It
distinguishes `uninitialized`, `bootstrapping`, and `ready` even when a ready
chat has zero messages. This preserves the current `Map.has(chatId)`
loaded-empty distinction used by `ChatPanel`.

**Alternatives rejected**

- **Revision-free replacement stores.** Async hydration can overwrite live
  chunks and a second window cannot detect staleness.
- **One global revision for all read models.** Chunk, queue, query, and actor
  revisions have different writers and gap recovery.
- **Timestamp ordering.** It is neither a causal identity nor safe across
  processes.
- **Apply chunks received before bootstrap immediately.** Their patch base is
  unknown.

## Artifact 1 — serializability inventory

| Current value                                                          | Why it cannot cross/persist as actor data                         | Target                                                                                                               |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `StreamRequest.attachments: FileAttachment[]` (`state.ts:45-65`)       | Contains browser `File` objects                                   | Validate and stage serializable `ChatAttachment` data before durable intent acceptance; store stable attachment refs |
| `onAccepted`, `onAcceptanceError`, `onAcceptanceRejected`, `onSettled` | Functions, `Error`, and promises are renderer-memory capabilities | `intentId`, typed dispatch receipt, acceptance result, terminal record                                               |
| Active `StreamState.request` (`state.ts:92-120`)                       | Contaminates every active snapshot with the fields above          | Actor stores `intentId` and serializable immutable intent facts                                                      |
| Commands carrying `StreamRequest` (`state.ts:171-205`)                 | Same contamination                                                | Commands carry intent/invocation IDs and load immutable host intent                                                  |
| Command `emit`/`isStale` closures (`commands.ts:58-97`)                | Runtime behavior, not data                                        | Host dispatcher/context and invocation checks                                                                        |
| Jotai store, QueryClient, PostHog getter (`commands.ts:102-107`)       | Renderer resources                                                | Renderer read-model/presentation adapters; main invalidation and telemetry facades                                   |
| `AbortController`, completion promises, admission waiter closures      | Ephemeral main resources                                          | Host runtime table keyed by invocation; reconstruct as absent/interrupted after restart                              |
| `WebContents` sender and callback stream registry                      | Ephemeral renderer lifetime                                       | `webContents` subscription ownership plus WindowRegistry routing                                                     |
| Queue callbacks and browser attachments (`chatAtoms.ts:528-548`)       | Cannot persist or transfer                                        | Serializable queue entry plus optional protocol-owner key                                                            |
| Queue `WeakMap` encoding cache (`useQueuePersistence.ts:81-88`)        | Identity optimization tied to renderer objects                    | Main attachment staging/cache, outside read models                                                                   |
| `TaskScope`, timers, listener sets                                     | Resource handles                                                  | Host-owned disposable runtime scopes                                                                                 |
| Plan navigation function and Jotai plan lookup                         | Window capability/local store                                     | Captured plan version in durable handoff; routed presentation event                                                  |

Already serializable and reusable:

- `InvocationRef`;
- prompt, chat/app IDs, `redo`, selected-component descriptors, and requested
  mode after schema validation;
- `ChatResponseEnd` and error strings;
- current full-message, tail-patch, and preview wire schemas;
- the owner/request ID as an idempotency key, once separated from callbacks.

## Artifact 2 — target state and read-model schemas

The following are contract sketches, not production declarations.

```ts
interface SerializableChatTurnIntentEnvelope {
  schemaVersion: 1;
  intentId: string; // durable idempotency identity
  chatId: number;
  originWindowSessionId?: string; // presentation routing only
  prompt: string;
  payloadHash: string; // immutable replay validation
  appId?: number;
  redo?: boolean;
  attachmentRefs: readonly string[];
  selectedComponents: readonly ComponentSelection[];
  requestedChatMode?: ChatMode | null;
  owner?:
    | { kind: "user-input-follow-up"; requestId: string }
    | { kind: "plan-handoff"; handoffId: string };
}

interface DurableChatTurnIntentRecord {
  envelope: SerializableChatTurnIntentEnvelope;
  acceptance: "queued" | "message-accepted" | "rejected";
  recovery: "not-started" | "started" | "interrupted" | "terminal";
  acceptedMessageId?: number;
  queuePosition?: number;
}

interface SessionQueueEntry {
  // Never persisted. Its live user-input registry owner is the authority.
  envelope: SerializableChatTurnIntentEnvelope & {
    owner: { kind: "user-input-follow-up"; requestId: string };
  };
  persistence: "main-session";
}

type ChatStreamHostState =
  | { type: "idle" }
  | {
      type: "admitting" | "streaming" | "cancelling" | "finalizing";
      intentId: string;
      invocationRef: ChatStreamInvocationRef;
      targetAppId: number | null;
      cancelRequested: boolean;
    }
  | {
      type: "errored";
      error: string; // follows G1a
    };

interface ChatStreamLifecycleReadModel {
  schemaVersion: 1;
  chatId: number;
  actorInstanceId: string;
  actorRevision: number;
  transactionSequence: number;
  state: ChatStreamHostState;
  capabilities: {
    canSubmit: boolean;
    canCancel: boolean;
    canPauseQueue: boolean;
    canResumeQueue: boolean;
  };
}

interface ChatMessagesBootstrap {
  schemaVersion: 1;
  chatId: number;
  messageEpoch: string;
  messageRevision: number;
  messages: readonly Message[];
  activeCursor?: {
    invocationRef: ChatStreamInvocationRef;
    deliverySeq: number;
  };
  preview?: StreamingPreview;
}

interface ChatMessageDelta {
  chatId: number;
  messageEpoch: string;
  messageRevision: number;
  invocationRef: ChatStreamInvocationRef;
  deliverySeq: number; // mandatory host order, not canned-stream chunkSeq
  update:
    | { kind: "replace"; messages: readonly Message[] }
    | {
        kind: "patch";
        streamingMessageId: number;
        patch: StreamingPatch;
      }
    | { kind: "preview"; preview?: StreamingPreview };
}

interface ChatQueueReadModel {
  schemaVersion: 1;
  chatId: number;
  queueRevision: number;
  paused: boolean;
  entries: readonly {
    itemId: string;
    intentId: string;
    prompt: string;
    attachmentSummaries: readonly AttachmentSummary[];
    selectedComponents: readonly ComponentSelection[];
    redo?: boolean;
    appId?: number;
    requestedChatMode?: ChatMode | null;
    persistence: "durable" | "main-session";
    editable: boolean;
    removable: boolean;
  }[];
}

interface PlanHandoffReadModel {
  schemaVersion: 1;
  handoffId: string;
  actorInstanceId: string;
  handoffRevision: number;
  sourceChatId: number;
  targetChatId?: number;
  planId: string;
  planVersion: string;
  phase:
    | "accepted"
    | "persisting"
    | "preparing-chat"
    | "awaiting-stream-idle"
    | "submitting"
    | "started"
    | "failed"
    | "cancelled";
  failure?: string;
}

type RendererReadModel<T> =
  | { status: "uninitialized" }
  | { status: "bootstrapping"; subscriptionId: string }
  | { status: "ready"; subscriptionId: string; value: T }
  | {
      status: "absent";
      reason: "actor-disposed" | "entity-deleted";
    };

// For RendererReadModel<ChatStreamLifecycleReadModel>, "absent" selects idle
// exactly as G1a requires. Messages, queue, plan handoff, and completion use
// the same explicit bootstrap union and their domain-specific revisions.
```

The completion schema is defined in decision 9. The host snapshot may contain
main-only fields, but the remote lifecycle schema is an explicit safe
projection and never includes secrets, paths, prompt content, or attachment
bytes unnecessarily.

`DurableChatTurnIntentRecord.acceptance` and `.recovery` are persistence and
crash-reconciliation facts, not live streaming status and not renderer
capabilities. `ChatStreamHostState` remains the sole live lifecycle authority
under G1a. Completion history is a projection of terminal commits; it is not a
second writable status.

### Remote intent classification

| Intent                              | Class and admission contract                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Submit a new user turn              | Idempotent/current-agnostic with immutable `intentId`; transition still validates current chat and chooses immediate versus queued |
| Retry an interrupted turn           | State-sensitive, with `expectedRevision` and a new execution invocation while retaining the accepted intent facts                  |
| Cancel                              | Cancellation; must carry the active `invocationRef`, never just chat or window                                                     |
| Pause/resume queue                  | State-sensitive mutation with `expectedQueueRevision`                                                                              |
| Edit/reorder/remove/clear queue     | State-sensitive mutation with `expectedQueueRevision`; owner settlement is part of remove/clear semantics                          |
| User-input follow-up                | Main-session handoff with `requestId` as receiver idempotency key; durable only at message acceptance                              |
| Plan implementation submit          | Durable handoff with `handoffId`/step idempotency key                                                                              |
| Toast/navigation/preview/screenshot | Presentation-only, emitted post-commit and routed by WindowRegistry                                                                |
| Message/chunk subscription          | Idempotent read/subscription with explicit bootstrap cursors                                                                       |

## Artifact 3 — acceptance transaction

There are two related transactions.

### A. Submit/queue admission

Within the per-chat actor FIFO:

1. authorize sender and chat;
2. validate intent schema, attachment staging refs, size limits, and immutable
   payload hash;
3. deduplicate `intentId`;
4. if a turn is active:
   - for a durable entry, use one SQLite transaction to insert the intent and
     queue row at the next stable position, increment `queueRevision`, and
     append the queue read-model outbox record; after commit return
     `durably-queued`;
   - for a `main-session` entry, validate its live owner, append it only to the
     main-owned aggregate, and return `queued-for-main-session`; never write a
     persistence shell;
5. if idle, reserve it as the actor's active intent and proceed directly to
   the turn-acceptance transaction below.

Same-key/same-payload retry returns the original result. Same key with a
different chat or payload is a typed conflict.

The public submission facade does not report `message-accepted` before the
turn-acceptance transaction commits. The generic actor receipt may report that
the submit event committed, but callers cannot treat it as durable admission;
the domain acceptance result is authoritative.

### B. Turn acceptance

In one SQLite transaction:

1. load or create the durable intent from the immutable envelope and verify
   any durable owner protocol record; when accepting a `SessionQueueEntry`,
   persist its envelope as a durable intent for the first time in this
   transaction, with no earlier owner-bearing persistence shell;
2. verify it is the queue head/reserved active intent when it came from queue;
3. insert-or-observe the user message by `(chatId, intentId)` and, for
   user-input, the owner key;
4. latch or reconcile first-turn chat mode;
5. set the intent acceptance fact to `message-accepted`;
6. delete/advance the queue head and increment `queueRevision` if applicable;
7. mark a durable owner protocol accepted/dispatched when one exists;
8. increment `messageRevision` and append message/queue read-model outbox rows;
9. commit.

After commit, the actor transitions to executing, publishes read models,
settles any memory-owned user-input owner, and starts the provider/tool
command. A crash after commit but before command start recovers as interrupted,
never as an editable queued item and never as a second message.

Finalization is a separate actor transaction: persist terminal message facts
and intent recovery facts, atomically persist `pausePromptQueue`, append the
completion record, and, when the queue is unpaused, accept at most one head
intent using the same message-acceptance steps above. The head is removed only
as its message/intent acceptance commits. Validation failure leaves it queued
and pauses the queue with a typed error. Thus there is no free-standing
in-memory “next reservation” to lose on restart. Command/provider completion
cannot retroactively change the already-issued acceptance result.

### Attachment staging lifecycle

- Staging creates a content-addressed temporary blob with an unclaimed
  timestamp; it is not queue acceptance.
- Durable queue/intent acceptance claims attachment refs in the same SQLite
  transaction as the owning row.
- Edit, remove, clear, terminal pruning, and entity deletion decrement or
  transfer refs transactionally; physical deletion happens after commit.
- Rejected intents delete unclaimed blobs. Startup sweeps expired unclaimed
  blobs and zero-ref blobs, never referenced blobs.
- Legacy `.dyad/queue` migration stages and validates all attachment payloads
  before committing new queue rows. Failure leaves the legacy file untouched.
- Fault injection covers stage/write/claim/commit/physical-delete boundaries;
  leaked unclaimed data must be collectible and committed refs must never
  disappear.

Required fault-injection tests cut power/fail after every numbered database
step and between database commit, actor commit, read-model publication, and
command start.

## Artifact 4 — migration sequence

1. **Characterize without moving authority.** Add tests for loaded-empty
   message bootstrap, chunk/hydrate and version-replace conflicts, queue
   claim/rollback and restore-paused behavior, duplicate intent payload
   conflicts, cancel/admission barriers, and plan acceptance snapshotting.
2. **Land the host-independent A6b subset.** Add message and plan-document
   reader facades backed by the existing atoms and inject `getPlanData`; make
   no new message/queue/accepted-plan store.
3. **Prove common transport in app-run.** Require actor instance/revision
   bootstrap, ticketed receipts, window destruction cleanup, two-window
   dispatch, gap recovery, WindowRegistry routing, and query invalidation
   epochs.
4. **Add serialized chat intent and outcome contracts.** Convert attachments
   before durable admission. Introduce `intentId` at UI and machine-owner
   boundaries. Replace the renderer user-input callback bridge with an
   ID/outcome adapter and direct main facade. Preserve the existing renderer
   controller behind an adapter during this step; callbacks may exist only in
   the window adapter, never in intent/state/command data.
5. **Create main queue/intent persistence and acceptance transaction.** Migrate
   `.dyad/queue` entries once, paused, into the main aggregate. Keep the old
   files read-only for one compatibility release; never dual-write.
6. **Move plan-handoff acceptance to IDs/checkpoints.** Capture an immutable
   plan version, add handoff and step idempotency keys, and keep renderer
   navigation/toasts behind presentation adapters. It may still call the old
   renderer lifecycle through the serialized facade at this point.
7. **Host lifecycle in main.** Join the current main admission engine and
   renderer lifecycle transition into one authoritative actor. Keep
   AbortControllers and tasks in the runtime table. Run the existing
   main-model and renderer transition/cosim invariants against the production
   actor.
8. **Install revisioned renderer read models.** Bootstrap lifecycle, messages,
   queue, completion history, and query epochs before flipping readers. Retain
   the high-volume chunk channel with cursors and interest keys.
9. **Flip queue mutations and terminal effects.** UI edits use expected
   revisions; notification/screenshot consumers dedupe typed post-commit
   events. Verify initiating-window close and same-chat two-window races.
10. **Delete compatibility code.** Remove renderer lifecycle/controller,
    callback fields, queue persistence hook/full-snapshot IPC, direct atom
    writers, and obsolete boundary exceptions only after telemetry and tests
    show no legacy callers.

Rollback boundaries exist after steps 4 and 8. Step 5 is irreversible after
the new writer accepts its first mutation unless an explicit reverse export
first merges current SQLite queue state back into the legacy format. Once step
7 makes main the single lifecycle authority, rollback must switch the complete
protocol, never reenable a renderer writer beside it.

## Artifact 5 — deletion budget

The budget is a set of obligations, not a promise to delete all chat code.
Current candidate implementation totals approximately 3,947 lines across the
renderer lifecycle, queue persistence, queue IPC/store, and callback wiring;
main actor/read-model code replaces part of it.

### Must delete or eliminate as authorities

- `src/chat_stream/controller.ts`
- `src/chat_stream/manager.ts`
- `src/chat_stream/ChatStreamProvider.tsx`
- renderer lifecycle portions of `src/chat_stream/state.ts`,
  `transition.ts`, and `commands.ts`
- callback fields on `StreamRequest` and `QueuedMessageItem`
- `createUserInputChatStreamFacade` callback/promise bridge
- `queuedMessagesByIdAtom` and `queuePausedByIdAtom`
- `useQueuePersistence.ts`, its `pagehide` flush, `WeakMap` encoder cache, and
  full-snapshot writer
- current all-queue `getQueuedPrompts`/`setQueuedPrompts` renderer-authority
  contracts and the one-renderer write assumption in `queue_store.ts`
- renderer `syncProjection`/atom cleanup for chat lifecycle after A6a
- direct message writes from chat commands, ChatPanel/ChatInput hydrators, and
  version preview after the message read model owns them
- `chatMessagesByIdAtom` after all readers use the materializer facade
- `mark-plan-accepted`, `updatePlanState`, and the fused `planStateAtom`
- obsolete writable-atom boundary allowlist entries and atom-seeding test
  helpers

### Replace, then delete shadow copies

- replace `main_model.ts` with the production main transition while retaining
  its invariants/cosim coverage; then delete the shadow model;
- narrow `protocol.ts` to the production high-volume and compatibility wire
  contracts;
- split renderer-only presentation/read-model application out of
  `commands.ts`, then delete the old mixed adapter;
- rewrite controller/manager/queue tests as actor-host, remote bootstrap,
  acceptance-transaction, and multi-window tests before deleting old suites.

### Intentionally retained

- pure streaming patch, resync, cancellation-annotation, and preview helpers;
- high-volume chunk schemas and batched transport concepts;
- message rendering components and selector-facing hooks;
- WindowRegistry presentation consumers;
- plan document UI state;
- the G1a status/error selectors and facade contract, now backed by the remote
  lifecycle read model.

### Budget pass/fail

C3 passes the deletion gate only if it:

- leaves one lifecycle writer, one queue writer, and one message-delta writer;
- removes every callback from host state/commands;
- removes full-snapshot renderer queue persistence;
- removes the shadow main-versus-renderer lifecycle split;
- reduces domain-specific lifecycle/transport glue after common actor runtime
  code is excluded.

Adding remote wrappers while retaining the renderer controller or atom
authorities fails the gate.

## A6b subset safe before C3

Only the following renderer work is safe regardless of whether C3 is delayed
or the host implementation changes:

1. Add `useChatMessages(chatId)`, `useChatMessageCount(chatId)`, and
   `useLastChatMessage(chatId)` as reader facades over the **existing**
   `chatMessagesByIdAtom`, then migrate read-only consumers. The backing source
   can later become the revisioned materializer without another component
   migration.
2. Add a plan-document reader facade over the existing fused `planStateAtom`
   and inject `getPlanData(chatId)` into plan-handoff. Do not split the atom
   yet: `acceptedChatIds` would need a temporary renderer home. During C3, move
   accepted state to the revisioned main read model and then rename the
   remaining renderer-owned documents half to `planDocumentsAtom` (or the
   established query cache). Preserve the current dual-source plan-document
   race as an explicitly separate issue.
3. Add characterization tests and extract pure schemas/helpers for:
   loaded-empty versus unbootstrapped messages; patch/hydration/version
   conflicts; queue conditional pop, owner rollback, restore-paused, and
   `undefined`/`null`; plan acceptance invalidation on a new draft.
4. Keep queue UI behind the existing `useStreamChat` facade so its backing can
   switch later without changing components.

Do **not** build a renderer `MessagesStore`, renderer `QueueStore`, or retained
renderer accepted-chat projection. Do not move message hydration into a
renderer machine command. Do not persist machine-owned queue entries.

## Final gate recommendation

**GO for C3 with the design above.** Main placement is feasible and removes a
real multi-window authority split. The critical path is not chunk throughput;
the existing patch channel is reusable. The critical path is the durable,
immutable intent plus transactional queue/message acceptance boundary.

Proceed after the app-run pilot proves remote actor bootstrap and WindowRegistry
routing. Treat the acceptance transaction, queue aggregate, user-input direct
handoff, and plan-handoff checkpoints as one protocol review. If C3 cannot
atomically couple queue claim with message acceptance, or cannot remove
callback-bearing renderer authority, the implementation is **no-go** and A6b
must stop at the host-independent reader/document subset above.
