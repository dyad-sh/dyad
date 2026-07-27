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

Documented main-owned resource registries may keep specialized listener,
timer, waiter, claim, and close-barrier internals. They expose only the
consumer-driven projection and intent boundary needed by renderers; those
narrow boundaries still obey revision, correlation, hydration, invalidation,
and multi-window convergence rules.

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
| `connection_flow`  | Continue to timeout                                                                        | Hydrate through `getStates`; resume broadcasts                                                             | Continue while application remains alive                  | Explicitly dispose timers and provider work                                                                                          | No flow recovery; a completed deep link is an unsolicited return                                                                         | N/A; provider hooks release flow resources                                                                                                      |
| `mcp_oauth`        | Continue to timeout                                                                        | No internal lifecycle reattach; settlement publishes MCP scopes through epoch-keyed query invalidation     | Continue while application remains alive                  | Close listeners and settle waiters                                                                                                   | No implicit recovery                                                                                                                     | Cancel/settle and fence stale writes before deletion or OAuth-relevant mutation                                                                 |
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

## Main registries audit

This audit records the current renderer surfaces and the C2 disposition for
the two already-main-authoritative registries. Source locations are the
evidence as of this ADR update; the contracts remain the durable source of
channel names.

### `connection_flow`

Renderer-visible surface:

| Surface                              | Main contract/handler                                                                                           | Renderer consumer and access mode                                                                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection-flow:start`              | `src/ipc/types/connection_flow.ts:83-94`; `src/ipc/handlers/connection_flow_handlers.ts:188-206`                | One-shot wrapper `src/hooks/useConnectionFlow.ts:114-123`; GitHub, Neon, and Supabase Connect actions at `GitHubConnector.tsx:480`, `NeonConnector.tsx:157`, and `SupabaseConnector.tsx:187`                              |
| `connection-flow:cancel`             | `src/ipc/types/connection_flow.ts:96-103`; `src/ipc/handlers/connection_flow_handlers.ts:208-211`               | One-shot wrapper `src/hooks/useConnectionFlow.ts:126-131`; connector cleanup and Cancel actions, including provider-only calls at `GitHubConnector.tsx:753`, `NeonConnector.tsx:897`, and `SupabaseConnector.tsx:390,536` |
| `connection-flow:resources-loaded`   | `src/ipc/types/connection_flow.ts:105-109`; `src/ipc/handlers/connection_flow_handlers.ts:213-222`              | One-shot wrapper `src/hooks/useConnectionFlow.ts:142-147`; sent after renderer query/settings refresh at `GitHubConnector.tsx:495`, `NeonConnector.tsx:124`, and `SupabaseConnector.tsx:112`                              |
| `connection-flow:acknowledge`        | `src/ipc/types/connection_flow.ts:111-115`; `src/ipc/handlers/connection_flow_handlers.ts:224-230`              | One-shot wrapper `src/hooks/useConnectionFlow.ts:134-139`; connector terminal-state effects at `GitHubConnector.tsx:504-506`, `NeonConnector.tsx:129-138`, and `SupabaseConnector.tsx:116-125`                            |
| `connection-flow:get-states`         | `src/ipc/types/connection_flow.ts:117-125`; `src/ipc/handlers/connection_flow_handlers.ts:232-235`              | One-shot hydration guarded against newer pushes at `src/hooks/useConnectionFlow.ts:78-98`                                                                                                                                 |
| `connection-flow:state-changed`      | `src/ipc/types/connection_flow.ts:133-139`; broadcast at `src/ipc/handlers/connection_flow_handlers.ts:90-100`  | Window-global listener and external-store projection at `src/hooks/useConnectionFlow.ts:53-63,101-107,153-164`; read by all three connectors                                                                              |
| `connection-flow:unsolicited-return` | `src/ipc/types/connection_flow.ts:147-153`; broadcast at `src/ipc/handlers/connection_flow_handlers.ts:101-106` | Buffered listener/hook at `src/hooks/useConnectionFlow.ts:65-76,173-191`; provider refresh effects at `GitHubConnector.tsx:514`, `NeonConnector.tsx:147`, and `SupabaseConnector.tsx:132`                                 |

Registry internals:

| Internal                                           | Evidence                                                                                                                         | Classification and disposition                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Per-provider state and pure transition application | `src/connection_flow/registry.ts:125,138-148,163-203`                                                                            | State transaction mechanics. Retain the specialized registry; remote admission adds revisions/correlation without exposing more state.   |
| Watchdog handles and scheduling                    | `src/connection_flow/registry.ts:126,150-156,176-192`                                                                            | Resource ownership. Retain; add explicit idempotent shutdown disposal and late-work fencing.                                             |
| Deep-link/device-flow return claim                 | `src/connection_flow/registry.ts:241-272`; structural-safety rationale in `src/ipc/handlers/connection_flow_handlers.ts:118-145` | Claim/correlation ownership. Retain.                                                                                                     |
| Provider hooks and provider cleanup                | `src/ipc/handlers/connection_flow_handlers.ts:58-88,90-99`                                                                       | Main-owned resource adapter. Retain and include in explicit shutdown disposal.                                                           |
| Broadcast subscriber tracking                      | `src/ipc/handlers/connection_flow_handlers.ts:20-54`                                                                             | Narrow projection transport. Retain until the common transport replaces it only where the connector consumers need revisioned admission. |

Disposition: keep the registry and its narrow lifecycle projection. C2 hardens
`start`/`acknowledge` with authoritative revision admission and replaces the
historical string `flowId` with a typed `ConnectionFlowInvocationRef` minted
through the shared `IdSource`. Cancel and acknowledgment require the exact
active ref; timers, provider callbacks, and every echo-capable boundary carry
it. Deep-link returns that cannot echo it use a documented structural
`InvocationRegistry` claim. C2 also adds explicit shutdown disposal.
`resources-loaded` is not a valid cross-window barrier: after durable
credential persistence, main settles the flow and publishes correlated
provider-status invalidation; each window independently invalidates its local
query families without acknowledging main lifecycle completion.

### `mcp_oauth`

Renderer-visible surface:

| Surface                                         | Main contract/handler                                                                      | Renderer consumer and access mode                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp:start-oauth`                               | `src/ipc/types/mcp.ts:237-253`; `src/ipc/handlers/mcp_handlers.ts:478-491`                 | Long-running one-shot mutation at `src/hooks/useMcp.ts:163-176`, called by `src/components/plugins/usePluginConnect.ts:76-112`; its renderer-local success invalidation is lost if that renderer is destroyed |
| `mcp:list-servers` / `McpServer.oauthConnected` | `src/ipc/types/mcp.ts:23-42,174-178`; derived in `src/ipc/handlers/mcp_handlers.ts:84-103` | Persisted-status query at `src/hooks/useMcp.ts:24-31`; read by plugin list/detail/summary surfaces rather than from the OAuth registry snapshot                                                               |
| `mcp:update-server`                             | `src/ipc/types/mcp.ts:207-211`; `src/ipc/handlers/mcp_handlers.ts:294-362`                 | One-shot mutation at `src/hooks/useMcp.ts:122-146`; OAuth disable/credential/scope/URL/transport changes can invalidate an active flow                                                                        |
| `mcp:delete-server`                             | `src/ipc/types/mcp.ts:213-217`; `src/ipc/handlers/mcp_handlers.ts:364-368`                 | One-shot mutation at `src/hooks/useMcp.ts:148-161`; reachable from `PluginDetailPage.tsx:118` while OAuth is active                                                                                           |
| `mcp:disconnect-oauth`                          | `src/ipc/types/mcp.ts:255-259`; `src/ipc/handlers/mcp_handlers.ts:541-543`                 | One-shot mutation at `src/hooks/useMcp.ts:178-190`, called by `src/components/plugins/usePluginConnect.ts:200-211`                                                                                            |

There is no MCP OAuth lifecycle event, hydration endpoint, or renderer
snapshot consumer today.

Registry internals:

| Internal                                   | Evidence                                          | Classification and disposition                                                                        |
| ------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Per-port states and transition dispatch    | `src/mcp_oauth/registry.ts:93,100-102,334-353`    | State transaction mechanics. Retain; no renderer consumes binding/callback/exchange substates.        |
| Flow-to-port and runtime waiter maps       | `src/mcp_oauth/registry.ts:94-95,111-124,356-381` | Waiter/correlation ownership. Retain; add server-scoped cancel/settle and renderer message-ID dedupe. |
| Loopback listener handles                  | `src/mcp_oauth/registry.ts:96,126-140,161-203`    | Resource ownership. Retain.                                                                           |
| Timeout handles                            | `src/mcp_oauth/registry.ts:97,104-109,206-216`    | Resource ownership. Retain.                                                                           |
| Close barriers and supersession sequencing | `src/mcp_oauth/registry.ts:98,126-140,263-295`    | Resource ownership and race barrier. Retain.                                                          |
| Callback claim/state validation            | `src/mcp_oauth/registry.ts:384-407`               | Claim/correlation ownership. Retain.                                                                  |
| Whole-registry disposal                    | `src/mcp_oauth/registry.ts:410-423`               | Resource cleanup. Retain and wire to the real application-shutdown boundary.                          |

Disposition: do not publish internal lifecycle states. Connect remains
current-agnostic, last-request-wins intent with a renderer-generated message
ID for retry dedupe; main mints a typed `McpOAuthInvocationRef` and settles the
displaced invocation. The ref is echoed through listener, waiter, timer,
callback, exchange, supersession, and settlement boundaries; it is distinct
from the retry-deduplication message ID. After persisted settlement, publish
MCP server/tool scopes through the global epoch-keyed `QueryInvalidationEvent`
channel so reconnect/bootstrap and gap recovery converge every window. Server
deletion, disconnect, OAuth disable, and OAuth-relevant configuration changes
cancel and settle matching flows and fence stale provider persistence before
changing the row. `ActorHost` would not remove the specialized resource maps
or fix these boundary obligations.

## App-run pilot deletion budget

### C1.3 remote-definition security review

The production `app_run` definition satisfies the B3 boundary checklist:

- the main-owned static manifest registers only the literal `app_run`
  definition; renderer input cannot select a module or command runner;
- the generic envelope and strict `AppRunKeySchema` /
  `AppRunIntentEventSchema` validate independently, and producer/settlement
  variants are absent from the renderer event codec;
- subscribe and dispatch authorize the app entity against main-owned database
  state, while stop additionally proves the exact active invocation and
  state-sensitive start/restart intents require the actor revision;
- renderer payloads contain intents only; `RunCommand`, process handles,
  runtime outputs, paths, and sandbox data are constructed and retained in
  main;
- `AppRunRemoteSnapshotSchema` projects only lifecycle phase, operation,
  start time, URL/mode, operation error, exit details, capabilities, revision,
  and invocation diagnostics. Console bytes stay on the keyed, bounded
  high-volume channel.

C1's trailing deletion implements the following checklist:

- [x] Delete `src/app_run/controller.ts` and
      `src/app_run/controller.test.ts`; the main actor and host conformance tests
      replace `AppRunController`.
- [x] Delete `src/app_run/manager.ts` and `src/app_run/manager.test.ts`, including
      its renderer `KeyedControllerHost`, `InvocationRegistry`, `activeRefs`,
      admitted-exit fallback stores, reload-token stores, and lifecycle listener
      registry.
- [x] Delete `src/app_run/AppRunProvider.tsx`. Replace its manager context and
      renderer entity disposer with the per-window remote actor client/ref.
- [x] Delete the renderer-to-main lifecycle executor in
      `src/app_run/commands.ts`. Main executes start/restart/stop and owns process
      settlement; independently justified renderer console, warning, error, and
      iframe presentation effects move behind typed post-commit consumers.
- [x] Replace `src/hooks/useAppRun.ts` manager subscriptions with selectors over
      the remote lifecycle read model. Remove the manager-backed app-exit fallback
      and reload-token projection APIs.
- [x] Remove lifecycle routing in `src/hooks/useRunApp.ts`: its
      `beginExternal`/`settleExternal` bridge, renderer ownership of run/restart/
      rebuild/stop dispatch, and producer-event admission. The hook may remain as
      a UI facade over remote dispatch receipts and keyed console subscriptions.
- [x] Replace the `AppRunStateSubscriptionFacade` implementation in
      `src/app_wiring/cross_machine_facades.ts` and the manager wiring in
      `src/app/layout.tsx` with the renderer remote read model. Keep
      `preview_iframe` renderer-owned.
- [x] Remove `PreviewIframeProvider`'s dependency on `AppRunManager` in
      `src/preview_iframe/PreviewIframeProvider.tsx`; feed it typed post-commit
      app-run lifecycle events carrying actor/invocation identity.
- [x] Remove timestamp/map-edge inference embodied by the admitted-exit fallback
      and `selectAppExit` timestamp comparison in `src/app_run/manager.ts`.
      `src/app_run/selectors.ts` may remain only for pure selection over the safe
      remote schema; no timestamp may stand in for invocation identity.
- [x] Rewrite affected renderer-centric tests in `src/hooks/useRunApp.test.tsx`
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

| Event                                                               | Classification and admission                                                                                               |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `start`                                                             | State-sensitive; require `expectedRevision`; main mints the typed `ConnectionFlowInvocationRef`.                           |
| `cancel`                                                            | Cancellation; require the exact active `ConnectionFlowInvocationRef`.                                                      |
| `acknowledge`                                                       | State-sensitive; require `expectedRevision` and matching invocation ref.                                                   |
| `resources-loaded`                                                  | Renderer-triggered compatibility intent to remove; provider-status invalidation replaces this per-window barrier.          |
| `prepared`, `return-received`, `token-exchanged`, `timeout`, `fail` | Host-only preparation, deep-link, command, timer, or failure events; require the matching typed invocation ref internally. |

### `mcp_oauth`

| Event                                                                                                             | Classification and admission                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONNECT`                                                                                                         | Idempotent/current-agnostic last-request-wins intent; require a renderer message ID for retry dedupe. Main mints `McpOAuthInvocationRef`, and superseding an active flow settles the displaced caller before replacement. |
| `SOCKETS_CLOSED`, `BINDS_SETTLED`, `AUTHORIZED_SILENTLY`, `CALLBACK`, `TIMEOUT`, `EXCHANGE_OK`, `EXCHANGE_FAILED` | Host-only listener, callback, timer, or command-settlement events; require the matching typed invocation ref internally. OAuth callback state is validated independently.                                                 |

### `github_ops`

| Event                                                                                                                                                                  | Classification and admission                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `OP_REQUESTED` with `fetch`                                                                                                                                            | Idempotent/current-agnostic; no revision, though the transition may ignore it while another operation is active.     |
| `OP_REQUESTED` with `rebase-abort` or `merge-abort`                                                                                                                    | Cancellation; require the active Git operation invocation ref, not merely `appId`.                                   |
| `OP_REQUESTED` with `push`, `pull`, `rebase`, `rebase-continue`, `merge`, `switch`, `create-branch`, `delete-branch`, `rename-branch`, `disconnect`, or `connect-repo` | State-sensitive; require `expectedRevision`.                                                                         |
| `ABORT_AND_SWITCH_CONFIRMED`, `BLOCKED_DISMISSED`, `RESOLVE_WITH_AI_STARTED`                                                                                           | State-sensitive; require `expectedRevision`.                                                                         |
| `BANNER_DISMISSED`, `RECONCILE_REQUESTED`                                                                                                                              | Idempotent/current-agnostic; no revision. Reconciliation probes repository truth before applying a lifecycle change. |
| `OP_SUCCEEDED`, `OP_FAILED`, `CONFLICTS`, `GIT_STATE`                                                                                                                  | Host-only command/probe settlement correlated to the active operation internally.                                    |

The C2 implementation verified the lifecycle row against the current Git
operations: mutations already run to process settlement in main, repository
truth is recoverable from Git metadata, and app deletion is serialized with
the per-app mutation lock. The hosted actor therefore retains active work with
no subscribers, survives reload and last-window close, reconciles Git state
when recreated, and is disposed only after deletion has acquired the same
per-app lock. Shutdown stops new admission and lets already-started Git
commands settle; an interrupted process is recovered from repository truth on
the next start rather than replayed.

Serializability audit:

- `GithubOpsState`, operations, banners, failures, conflict names, and all
  renderer intents are plain encoded values. Active command settlement uses a
  typed `GithubOpsInvocationRef`; callbacks, promises, process handles,
  `Error` instances, and service objects are excluded from state and events.
- `OP_SUCCEEDED`, `OP_FAILED`, `CONFLICTS`, and `GIT_STATE` are host-only.
  Renderer codecs admit only the intent rows above.
- The former per-app conflict-resolution callback registry is replaced by the
  remote dispatch receipt. After main applies `RESOLVE_WITH_AI_STARTED`, only
  the initiating renderer starts its local chat/navigation flow, using the
  conflict names from the accepted snapshot.

The remote read model contains the existing `GithubOpsState` projection,
snapshot revision, and the active typed invocation reference needed for
cancellation. Conflict entries are repository-relative names required by the
existing resolution UI. It excludes access tokens, authenticated remote URLs,
absolute app/repository paths, Git command handles, and settings/database
records.

The migration deletion budget is the renderer `GithubOpsController`,
`GithubOpsManager`, `GithubOpsCommandRunner`, its hand-written FIFO and probe
generation maps, the conflict-runner registry, and the mutation/probe IPC
channels used only by that adapter. Branch and app cache refreshes move to the
global query-invalidation epoch channel; the existing branch inventory query
and `useGithubOps`/`projectGithubOps` consumer surface remain.

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
