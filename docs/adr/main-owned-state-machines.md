# Main-owned state machines

- Status: Accepted
- Date: 2026-07-24
- Plan: [Cleanup of the State-Machine Layer](../../plans/cleanup-state-machines.md)
- Related study:
  [Chat-stream/main feasibility study](../../plans/g1-chat-stream-study.md)

## Context and decision

Dyad will support multiple windows that can show and control the same chat or
app. A renderer controller can therefore no longer be both a window-local
object and the authority for a shared lifecycle. Every actor has one
authoritative host. Shared-entity and resource-owning actors run in main;
window-resource actors remain in the renderer that owns the resource. Windows
subscribe to revisioned, renderer-safe read models and dispatch validated
intent to main.

An actor runtime is preferable to incrementally cleaning up the existing
renderer controllers because multi-window is the forcing function, not merely
controller code quality. Incremental cleanup would leave one controller per
window and require synchronization or leader election between equally writable
copies. The actor runtime instead gives each entity one serial event queue,
one commit point, explicit lifecycle and transport contracts, and read-only
fan-out to every window. The detailed motivation and rollout are in the
[plan](../../plans/cleanup-state-machines.md).

## Recorded product decisions

The following decisions are copied verbatim from the plan.

1. **Same-entity concurrency: shared views, both windows may dispatch.**
   The same chat or app may be visible in multiple windows. Main serializes
   events through one actor. Idempotent intent may apply normally;
   state-sensitive or destructive intent uses the current revision and/or
   invocation identity; cancellation identifies the active invocation.
2. **Window close: main-owned work continues.** Closing or reloading the
   initiating window releases its subscriptions and presentation resources
   but does not implicitly cancel streams, runs, checkouts, image jobs, or
   other main-owned work. Explicit Cancel/Stop remains a user action.
   Renderer-owned work tied to destroyed resources settles or stops according
   to its local machine policy.
3. **Last-window close: platform convention.** On macOS, zero windows does
   not itself mean app quit. On Windows/Linux, last-window close may cause
   actual app quit. Main actors respond to the real application-shutdown
   boundary, not merely subscriber count.
4. **Tabs: independent instances over shared entities, with transfer and
   explicit duplication.** A tab has a stable `TabInstanceId` and belongs
   to one `WindowSessionId`. Dragging moves that same tab instance and
   preserves transferable presentation state. Explicit “Open in New Window”
   or duplication creates a new tab instance that may reference the same
   entity; ordinary navigation may focus an existing tab in the current
   window. Independent instances do not automatically share scroll position,
   selected file, iframe history, panels, dialogs, or drafts.
5. **Presentation routing: initiator first, with typed fallbacks.** Persistent
   lifecycle facts render in every subscribed view. Transient effects route
   by type: operation toasts and navigation stay in the initiating window;
   inline shared errors render in every relevant view; actionable user-input
   requests may render in every relevant window with first-response-wins;
   headless important completion uses a native notification. The fallback for
   ordinary effects is initiating window → most-recent focused window showing
   the entity → any window showing the entity → focused app window →
   notification or no transient effect.

Two implementation consequences are mandatory:

- a stale window action is never accepted merely because it came from a
  trusted renderer; every remote machine records whether each event requires
  no revision, an `expectedRevision`, or an invocation ref;
- moving a tab is an acknowledged handoff: capture transferable state, adopt
  it in the destination, then remove the source. Adoption failure leaves the
  source tab intact.

## Architecture rules

### Authority and delivery

- One authoritative host owns each actor. Main actors key by domain entity;
  renderer actors key by the window-local host and entity.
- A transition commit is the actor's linearization point. A committed dispatch
  receipt does not mean its commands completed, a durable receiver accepted a
  handoff, or the overall operation finished. Those outcomes use separate
  domain receipts and observable lifecycle facts.
- Multi-primary replication is forbidden. Windows never own writable shadow
  copies of main lifecycle state, and Jotai never becomes a conflict-resolution
  layer for machine facts.
- Location is explicit at every call site: local actor-to-actor work uses
  `send`; crossing from a renderer to main uses `dispatch` and returns a typed
  receipt. APIs must not hide whether transport, admission, or completion is
  being awaited.
- Commands execute only in the authoritative host. A transition may commit
  before a command starts, and command settlement re-enters the host as a
  correlated event.

### Security boundary

Remote definitions live in a static manifest; a renderer cannot name an
arbitrary machine or command. Outer envelopes and per-event codecs are
validated, and the event codecs are the allowlist of dispatchable renderer
intent. Every definition supplies entity-scoped authorization in addition to
trusting the renderer process. Commands and runtime handles never cross from
the renderer, and renderer projections explicitly exclude main-only data such
as secrets, process handles, internal paths, prompt content, and unnecessary
attachment bytes. Focus and visibility may select a presentation destination
or capability lease but never authorize a domain mutation.

## Actor lifecycle matrix

The `chat_stream` row incorporates the accepted G1 study. `plan_handoff` rides
that design and is included explicitly because G1 made it a main-owned durable
protocol actor.

| Machine            | No subscribers                                                                             | Window reload                                                                                              | Last window closes                                        | App quit                                                                                                                             | App restart                                                                                                                              | Entity deletion                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_run`          | Active process retained; idle policy bounded                                               | Reattach to main snapshot/output                                                                           | Platform convention; active work retained on macOS        | Bounded child-process teardown                                                                                                       | Ephemeral unless separately recovered                                                                                                    | Stop/dispose actor and process                                                                                                                  |
| `user_input`       | Live waiter retained to deadline                                                           | Rehydrate read model                                                                                       | Continue while application remains alive                  | Settle/sweep by shutdown policy                                                                                                      | Recover only durable pending records                                                                                                     | Settle requests for deleted entity                                                                                                              |
| `connection_flow`  | Continue to timeout                                                                        | Reattach read model                                                                                        | Continue while application remains alive                  | Cancel listeners/timers safely                                                                                                       | Domain-specific unsolicited return                                                                                                       | N/A/provider cleanup                                                                                                                            |
| `mcp_oauth`        | Continue to timeout                                                                        | Reattach status if exposed                                                                                 | Continue while application remains alive                  | Close listeners and settle waiters                                                                                                   | No implicit recovery                                                                                                                     | Dispose server/flow-owned resources                                                                                                             |
| `github_ops`       | Active mutation retained                                                                   | Reattach                                                                                                   | Continue while application remains alive                  | Finish or enter explicit recovery                                                                                                    | Reconcile repository state                                                                                                               | Dispose actor after safe settlement                                                                                                             |
| `version_preview`  | Active checkout/recovery retained                                                          | Reattach                                                                                                   | Continue while application remains alive                  | Preserve/enter recovery contract                                                                                                     | Reconcile branch/checkout state                                                                                                          | Dispose after safe return/settlement                                                                                                            |
| `image_generation` | Active jobs retained                                                                       | Reattach                                                                                                   | Continue while application remains alive                  | Stop admission, request best-effort cancellation, and wait only for a bounded settlement window                                      | Do not persist or resume active jobs; retain only already committed image/media records                                                  | Cancel/prune jobs for deleted entity                                                                                                            |
| `chat_stream`      | Active stream and queue continue; idle actor may evict after retained read models are safe | Release old subscriptions/callbacks; bootstrap lifecycle, messages, queue, handoff, and completion cursors | Follow platform convention and the real shutdown boundary | Stop admission; mark turns interrupted; abort streams; perform bounded write unwind; flush queue/intent transactions and read models | Hydrate durable queue entries paused; reconcile accepted/executing intents to interrupted; do not auto-run; omit memory-owned follow-ups | Claim queue/protocol records; settle owners; cancel/unwind the invocation; delete read models and staged attachments before deleting the entity |
| `plan_handoff`     | Active durable handoff continues                                                           | Bootstrap protocol projection; presentation callbacks are reacquired                                       | Continue while application remains alive                  | Stop new handoffs; checkpoint or fail the current step and bound shutdown                                                            | Hydrate durable protocol checkpoints; never repeat an accepted step without its idempotency key                                          | Settle/reject the handoff and clean its records before deleting either participating entity                                                     |

Image-generation app-quit rationale: providers may not acknowledge
cancellation, so shutdown attempts cleanup but must not wait indefinitely.

Image-generation restart rationale: generation may cost money and may already
have produced an external side effect, so Dyad must not silently replay it
after a crash; completed files that were committed before shutdown remain.

Renderer-local machines die with their renderer resources and must settle or
compensate their callers. No-subscriber behavior is a per-definition lifecycle
policy, not an implicit cancellation rule.

## App-run pilot deletion budget

C1 is not complete until the following current renderer modules or
responsibilities are deleted or replaced:

- Delete `src/app_run/controller.ts` and
  `src/app_run/controller.test.ts`; the main actor and host conformance tests
  replace `AppRunController`.
- Delete `src/app_run/manager.ts` and `src/app_run/manager.test.ts`, including
  its renderer `KeyedControllerHost`, `InvocationRegistry`, `activeRefs`,
  admitted-exit fallback stores, reload-token stores, and lifecycle listener
  registry.
- Delete `src/app_run/AppRunProvider.tsx`. Replace its manager context and
  renderer entity disposer with the per-window remote actor client/ref.
- Delete the renderer-to-main lifecycle executor in
  `src/app_run/commands.ts`. Main executes start/restart/stop and owns process
  settlement; independently justified renderer console, warning, error, and
  iframe presentation effects move behind typed post-commit consumers.
- Replace `src/hooks/useAppRun.ts` manager subscriptions with selectors over
  the remote lifecycle read model. Remove the manager-backed app-exit fallback
  and reload-token projection APIs.
- Remove lifecycle routing in `src/hooks/useRunApp.ts`: its
  `beginExternal`/`settleExternal` bridge, renderer ownership of run/restart/
  rebuild/stop dispatch, and producer-event admission. The hook may remain as
  a UI facade over remote dispatch receipts and keyed console subscriptions.
- Replace the `AppRunStateSubscriptionFacade` implementation in
  `src/app_wiring/cross_machine_facades.ts` and the manager wiring in
  `src/app/layout.tsx` with the renderer remote read model. Keep
  `preview_iframe` renderer-owned.
- Remove `PreviewIframeProvider`'s dependency on `AppRunManager` in
  `src/preview_iframe/PreviewIframeProvider.tsx`; feed it typed post-commit
  app-run lifecycle events carrying actor/invocation identity.
- Remove timestamp/map-edge inference embodied by the admitted-exit fallback
  and `selectAppExit` timestamp comparison in `src/app_run/manager.ts`.
  `src/app_run/selectors.ts` may remain only for pure selection over the safe
  remote schema; no timestamp may stand in for invocation identity.
- Rewrite affected renderer-centric tests in `src/hooks/useRunApp.test.tsx`
  and `src/preview_iframe/usePreviewIframe.test.tsx` as remote-bootstrap,
  cross-window dispatch, post-commit composition, and capability-routing
  tests before deleting their manager fixtures.

The pure transition/state definitions may move to main and remain if they
still describe the authoritative actor. Console buffers, package-manager
warnings, preview errors, and iframe state are retained only where they have
an independent owner and are not lifecycle authorities.

## Remote intent classification

The tables account for every event in the current unions. “Host-only” is not
an additional remote intent class: it means the event is deliberately absent
from the remote codec allowlist and can enter only through an authorized main
producer or command settlement. Classifications describe the target remote
contract, so they also identify required schema changes to today's
renderer-owned unions.

For state-sensitive mutations the caller supplies `expectedRevision`; queue
mutations use `expectedQueueRevision`. Cancellation supplies the active
invocation ref. Idempotent/current-agnostic intent requires no revision but
still carries its domain idempotency/correlation key where noted. Presentation
intent never changes domain state and is routed after commit.

### `app_run`

| Event                                                                                       | Classification and admission                                                                                                  |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `START`, `RESTART`, `REBUILD`                                                               | State-sensitive; require `expectedRevision`. Main mints the new invocation on admission.                                      |
| `STOP`                                                                                      | Cancellation; require the active app-run `invocationRef`.                                                                     |
| `MANUAL_RELOAD`                                                                             | Idempotent/current-agnostic; no revision. It is valid only when the current snapshot supports reload.                         |
| `EXTERNAL_RESTART`                                                                          | Host-only producer admission; main correlates the external request and mints or validates its invocation.                     |
| `RUN_IPC_RESOLVED`, `RUN_IPC_FAILED`, `STOP_IPC_RESOLVED`, `STOP_IPC_FAILED`, `RELOAD_DONE` | Host-only command settlement; require the exact invocation ref internally.                                                    |
| `PROXY_READY`, `HMR_DETECTED`, `APP_EXIT`                                                   | Host-only process/proxy events. Ref-capable producers require the invocation; legacy ref-less compatibility is removed by C1. |

### `user_input`

| Event                                                                                                            | Classification and admission                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `human-decided`                                                                                                  | State-sensitive; authorize the request, require its `requestId` and `expectedRevision`, and preserve first-applied-wins. |
| `requested`                                                                                                      | Host-only request creation; the trusted main caller supplies the descriptor and deadline.                                |
| `classifier-decided`, `timed-out`, `chat-swept`, `stream-finished`, `follow-up-dispatched`, `follow-up-rejected` | Host-only correlated classifier, timer, sweep, chat lifecycle, or durable-handoff settlement.                            |

Actionable user-input presentation is broadcast according to recorded decision
5, but a presentation event is not a second way to mutate the waiter.

### `connection_flow`

| Event                                                                                   | Classification and admission                                                                               |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `start`                                                                                 | State-sensitive; require `expectedRevision`; `flowId` is the new invocation identity.                      |
| `cancel`                                                                                | Cancellation; require the active `flowId` as the invocation ref.                                           |
| `acknowledge`                                                                           | State-sensitive; require `expectedRevision` and matching `flowId`.                                         |
| `prepared`, `return-received`, `token-exchanged`, `resources-loaded`, `timeout`, `fail` | Host-only preparation, deep-link, command, timer, or failure events; require matching `flowId` internally. |

### `mcp_oauth`

| Event                                                                                                             | Classification and admission                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONNECT`                                                                                                         | State-sensitive; require `expectedRevision`. `flowId` is the new invocation identity, and superseding an active flow must settle the displaced caller.    |
| `SOCKETS_CLOSED`, `BINDS_SETTLED`, `AUTHORIZED_SILENTLY`, `CALLBACK`, `TIMEOUT`, `EXCHANGE_OK`, `EXCHANGE_FAILED` | Host-only listener, callback, timer, or command-settlement events; require matching `flowId` internally. OAuth callback state is validated independently. |

### `github_ops`

| Event                                                                                                                                                                  | Classification and admission                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `OP_REQUESTED` with `fetch`                                                                                                                                            | Idempotent/current-agnostic; no revision, though the transition may ignore it while another operation is active.     |
| `OP_REQUESTED` with `rebase-abort` or `merge-abort`                                                                                                                    | Cancellation; require the active Git operation invocation ref, not merely `appId`.                                   |
| `OP_REQUESTED` with `push`, `pull`, `rebase`, `rebase-continue`, `merge`, `switch`, `create-branch`, `delete-branch`, `rename-branch`, `disconnect`, or `connect-repo` | State-sensitive; require `expectedRevision`.                                                                         |
| `ABORT_AND_SWITCH_CONFIRMED`, `BLOCKED_DISMISSED`, `RESOLVE_WITH_AI_STARTED`                                                                                           | State-sensitive; require `expectedRevision`.                                                                         |
| `BANNER_DISMISSED`, `RECONCILE_REQUESTED`                                                                                                                              | Idempotent/current-agnostic; no revision. Reconciliation probes repository truth before applying a lifecycle change. |
| `OP_SUCCEEDED`, `OP_FAILED`, `CONFLICTS`, `GIT_STATE`                                                                                                                  | Host-only command/probe settlement correlated to the active operation internally.                                    |

### `version_preview`

| Event                                                                                                                                                                                                                 | Classification and admission                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `OPEN`, `CLOSE_VERSION_DIFF`, `VIEW_VERSION_DIFF`, `SELECT_DIFF_FILE`                                                                                                                                                 | Presentation-only after the C2 split; they stay window-local and never mutate the main checkout actor.                 |
| `CLOSE`, `APP_CHANGED`, `SELECT_VERSION`, `SWITCH_BRANCH`, `RESTORE`, `RESTORE_TO_MESSAGE`, `RETRY_RETURN`                                                                                                            | State-sensitive; require `expectedRevision` because each can start, queue, retry, or compensate a repository mutation. |
| `ORIGIN_RESOLVED`, `ORIGIN_RESOLUTION_FAILED`, `CHECKOUT_SUCCEEDED`, `CHECKOUT_FAILED`, `RESTORE_SUCCEEDED`, `RESTORE_FAILED`, `RETURN_SUCCEEDED`, `RETURN_FAILED`, `SWITCH_BRANCH_SUCCEEDED`, `SWITCH_BRANCH_FAILED` | Host-only command settlement, correlated to the active checkout/recovery invocation internally.                        |

`OPEN` is listed as presentation-only because opening a pane is not domain
work. Any origin-resolution needed before a later checkout starts from that
state-sensitive checkout intent, not from pane visibility.

### `image_generation`

| Event                                                                           | Classification and admission                                                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Job creation (currently manager construction rather than an event-union member) | Idempotent/current-agnostic with immutable `jobId`; no revision. Same-key/different-payload replay is rejected. |
| `CANCEL_REQUESTED`                                                              | Cancellation; the remote form must add and require the active image-job invocation ref.                         |
| `JOB_SUCCEEDED`, `JOB_FAILED`, `CANCEL_CONFIRMED`                               | Host-only provider/cancellation settlement correlated to the job invocation internally.                         |

### `chat_stream` (accepted G1 target; current union provisional)

G1 is accepted, but the current renderer event union predates its target
protocol. The first table classifies every current `StreamEvent`
provisionally; C3 replaces it with the accepted intents in the second table.

| Current event                                                                                           | Provisional classification and admission                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `submit`                                                                                                | Idempotent/current-agnostic with immutable `intentId`; no actor revision. The transition still chooses immediate versus queued admission. |
| `cancel`                                                                                                | Cancellation; the remote form must add and require the active `invocationRef`.                                                            |
| `queue-poked`                                                                                           | Host-only queue-driver signal; renderer pause/resume becomes an explicit revisioned mutation.                                             |
| `registered`, `stream-context`, `chunk-received`, `stream-ended`, `stream-errored`, `finalize-complete` | Host-only admission, producer, stream, or command-settlement events correlated by `invocationRef`.                                        |

| G1 target intent                    | Classification and admission                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Submit a new user turn              | Idempotent/current-agnostic with immutable `intentId`; no revision.                                               |
| Retry an interrupted turn           | State-sensitive with `expectedRevision` and a new execution invocation while retaining accepted intent facts.     |
| Cancel                              | Cancellation; require the active `invocationRef`.                                                                 |
| Pause/resume queue                  | State-sensitive with `expectedQueueRevision`.                                                                     |
| Edit/reorder/remove/clear queue     | State-sensitive with `expectedQueueRevision`; remove/clear includes owner settlement.                             |
| User-input follow-up                | Durable handoff; use `requestId` as the receiver idempotency key and acknowledge only durable message acceptance. |
| Plan implementation submit          | Durable handoff; use `handoffId` and step idempotency keys.                                                       |
| Toast/navigation/preview/screenshot | Presentation-only; emit post-commit and route through `WindowRegistry`.                                           |
| Message/chunk subscription          | Idempotent/current-agnostic read/subscription with explicit bootstrap cursors; no revision for admission.         |

### `plan_handoff` (accepted G1 target; current union provisional)

| Current event                                                                                                                                     | Provisional classification and admission                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLAN_ACCEPTED`                                                                                                                                   | Durable handoff; the remote form requires an immutable plan version/content hash and `handoffId`. Actor commit is not receiver acceptance.  |
| `STREAM_CANCEL_FINISHED`                                                                                                                          | Host-only cancellation settlement correlated to the planning-stream invocation.                                                             |
| `TRANSITION_DISPLAY_DONE`                                                                                                                         | Host-only timer/presentation acknowledgement in the current union. C3 must not let a lost window acknowledgement gate the durable protocol. |
| `PLAN_PERSISTED`, `PLAN_DATA_MISSING`, `PLAN_PERSIST_FAILED`, `CHAT_READY`, `CHAT_PREPARE_FAILED`, `STREAM_BECAME_IDLE`, `IMPLEMENTATION_STARTED` | Host-only command, watcher, or durable receiver settlement correlated to the handoff and step idempotency key.                              |

The G1 target exposes plan acceptance and the final implementation submission
as durable handoffs. Navigation, preview-mode changes, accepted badges, and
failure toasts are presentation-only post-commit events and are not fed back
as domain authority.
