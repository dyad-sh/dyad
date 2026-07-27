# Cleanup of the State-Machine Layer — Main-Owned Authority, Multi-Window Ready

## Status

Committed direction (supersedes the previous revision of this file, which
treated the distributed runtime as an open option). The decision input that
changed: **multi-window support is on the product roadmap** (multiple
windows showing different chats/tabs, browser-style). Multi-window breaks
the architecture's hidden axiom — that there is exactly one renderer, so
"renderer-hosted machine" and "the authority" can be the same thing. Any
shared lifecycle that must be observed and controlled from more than one
window cannot be renderer-owned without becoming multi-primary.
Authority for those shared-entity lifecycles therefore moves to the main
process; windows become views over read models. Window-specific lifecycles
such as iframe navigation remain renderer-owned even when another window
shows the same underlying app.

Source plans and their roles:

- `plans/claude-cleanup-machines.md` — verified atom inventory (116 atoms;
  152 trace claims checked, 20 corrected) and per-atom migration recipes.
  Remains the **evidence appendix** for Phase A; its file:line traces are
  authoritative, while this plan owns PR scope and sequencing.
- `plans/codex-cleanup-state-machines.md` — ownership model, boundary
  enforcement, target renderer APIs. Its architecture rules are adopted;
  its renderer-runtime consolidation rollout is superseded (those
  controllers are now moving to main, not being polished in place).
- `plans/distrbuted-machines.md` — **adopted as the destination
  architecture**, resequenced by this plan. Its transport was designed
  per-`webContents` (subscription ownership, `webContents.destroyed`
  cleanup, reference counting, revisioned snapshot broadcasts) — it is a
  multi-window fan-out protocol and is now built as one, with multi-window
  scenarios as first-class acceptance criteria rather than a future.

Follows `plans/state-machines-hardening.md` (landed). The hardening work
made the layer safe; this plan makes ownership truthful and multi-window
capable: one authoritative owner per lifecycle fact, hosted beside the
resource it controls, projected to every window that looks.

## Recorded product decisions

These decisions are architecture inputs, not defaults. They are approved
for this plan and must be copied into the Phase B ADR before implementation.

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

## Target architecture

```text
                    main process (authority)
   remote actors:
     app_run · chat_stream* · github_ops · version_preview ·
     image_generation · user_input
        |                                   ^
        | revisioned snapshot read models    | validated, authorized,
        | + typed post-commit events         | deduplicated dispatch
        v                                   |
  +-------------- window 1 --------------+  +-------- window 2 --------+
  | remote refs -> selectors -> hooks    |  | (same read models,       |
  | per-window machines:                 |  |  same dispatch API)      |
  |   preview_iframe · screenshot ·      |  |                          |
  |   voice_to_text · first_prompt       |  |                          |
  | per-window Jotai (UI-only atoms)     |  |                          |
  +--------------------------------------+  +--------------------------+

   documented main-owned resource registries:
     connection_flow -- narrow lifecycle projection; revisioned intent
                        hardening remains before multi-window dispatch
     mcp_oauth       -- terminal invoke + persisted server status; epoch
                        query invalidation remains required
```

\* `chat_stream` completed its feasibility study and is moving to main in C3.

Placement table (final intent; per-machine moves still gate on their
pilot/study):

| Machine            | Host                               | Reason                                                                                                                                                               |
| ------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_run`          | main                               | Owns child process, producer identity; app is global across windows                                                                                                  |
| `user_input`       | main                               | Already main; owns waiters; survives window lifecycle                                                                                                                |
| `connection_flow`  | main, documented resource registry | Already main; retain its narrow lifecycle projection and specialized resource ownership, but add revisioned/correlated intent admission before multi-window dispatch |
| `mcp_oauth`        | main, documented resource registry | Already main; retain listener/waiter internals and publish persisted-status invalidation through the global epoch channel, not internal lifecycle states             |
| `github_ops`       | main                               | Git mutation/recovery is per-app, not per-window; mid-rebase must survive window close                                                                               |
| `version_preview`  | main                               | Checkout/branch recovery is per-app; mid-checkout must survive window close                                                                                          |
| `image_generation` | main                               | Jobs are per-chat, visible from any window                                                                                                                           |
| `chat_stream`      | main, C3 cutover complete          | Stream lifecycle is per-chat; main owns durable intent admission, queue mutation, lifecycle, and completion receipts                                                 |
| `plan_handoff`     | main, C3 cutover complete          | Durable cross-chat workflow with persisted checkpoints and idempotent implementation-turn admission                                                                  |
| `preview_iframe`   | renderer, per-window               | Owns a window's DOM/iframe identity                                                                                                                                  |
| `screenshot`       | renderer, per-window               | Captures a window's iframe                                                                                                                                           |
| `voice_to_text`    | renderer, per-window               | Owns a window's media resources                                                                                                                                      |
| `first_prompt`     | renderer, per-window               | Presentation saga tied to a window's home view                                                                                                                       |

Per-window machines key by (window-local host, entity). Main-hosted
machines key by entity; windows subscribe.

Core rules (unchanged from the hardening/cleanup lineage, now with a
process boundary in the middle):

> A lifecycle fact represented in a machine snapshot is not also stored in
> Jotai. A lifecycle fact owned by main is not also authoritative in any
> window.

- Jotai is per-window UI state only (drafts, tabs, selections,
  dismissals). Each window has its own store; nothing machine-owned lives
  there. The tab/session family becomes per-window state exactly like a
  browser's.
- React Query remains authoritative for IPC-backed entities; invalidation
  becomes broadcast-aware (a mutation in window A invalidates window B's
  cache — main emits typed invalidation events).
- Facade rules from the distributed plan bind every edge now: events carry
  operation identity (invocation refs), never timestamp/map-edge
  inference; delivery is post-commit, deferred across machine boundaries;
  location is explicit (local `send` vs remote `dispatch` returning a
  receipt); commit is not completion.

### Remote intent policy

Every remotely dispatchable event is classified in its machine definition:

| Intent class                | Admission contract                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Idempotent/current-agnostic | No expected revision; transition still validates payload and current state               |
| State-sensitive mutation    | Carries `expectedRevision`; stale intent is a typed rejected/ignored receipt             |
| Cancellation                | Carries the active invocation ref; entity key or initiating window alone is insufficient |
| Durable handoff             | Carries a domain idempotency key; commit receipt is not durable receiver acceptance      |
| Presentation-only           | Routes through the window router after authoritative commit; never changes domain state  |

Capabilities account for remote connection status. A control rendered from
revision N may still lose a race before dispatch; the receipt is the
authoritative answer, and dialogs/forms settle only from authoritative state.

### Window identity and routing

Phase B introduces a main-owned `WindowRegistry` before remote machine
transport is used by production:

```ts
interface WindowRegistry {
  register(webContentsId: number, windowSessionId: WindowSessionId): void;
  unregister(webContentsId: number): void;
  setFocused(windowSessionId: WindowSessionId): void;
  setVisibleEntities(
    windowSessionId: WindowSessionId,
    entities: readonly VisibleEntity[],
  ): void;
  findWindowsShowing(entity: VisibleEntity): readonly WindowSessionId[];
  routePresentation(request: PresentationRouteRequest): WindowSessionId | null;
  claimCapability(request: WindowCapabilityRequest): WindowCapabilityLease;
}
```

- `webContents.id` identifies one ephemeral renderer lifetime.
- `WindowSessionId` identifies a restorable window session.
- `TabInstanceId` identifies one movable/transferable tab presentation.
- Main actor keys never include a window ID unless the domain resource itself
  is window-owned.
- Subscription ownership uses `webContents`; session/tab restoration uses
  stable IDs.
- Visibility/focus metadata is advisory for presentation routing, never
  authority for domain mutations.

Window-owned resources use explicit capability leases. For example, a
main-hosted workflow requesting a screenshot asks the registry for a window
currently advertising `{kind: "screenshot", appId, iframeEpoch}`. The request
targets that lease and settles/retries if the window or iframe disappears.
Never broadcast a resource request and accept whichever window responds first.

### Cross-window React Query coherence

Machine snapshots do not make IPC-backed entity caches coherent. Phase B adds
a separate typed invalidation channel:

```ts
interface QueryInvalidationEvent {
  epoch: number;
  scope: QueryInvalidationScope;
  originWindowSessionId?: WindowSessionId;
}
```

Requirements:

- scopes map to the central `queryKeys` factory; arbitrary renderer-supplied
  query keys are not transported;
- main broadcasts invalidations after the authoritative mutation commits;
- events may batch multiple scopes;
- origin windows invalidate too unless they have already installed equivalent
  mutation data;
- the epoch is **one global counter**, not per-scope: a gap conservatively
  invalidates the affected query families; per-scope epochs are an
  unproven optimization, deferred until measured;
- each window tracks the last seen epoch;
- reconnect or an epoch gap triggers conservative invalidation of the affected
  query families;
- machine snapshot revision and query invalidation epoch are distinct;
- non-machine IPC mutations use the same channel.

### High-volume window subscriptions

Console output and LLM chunks stay off machine snapshots, but they are not
blindly broadcast to every renderer. Main maintains keyed `appId`/`chatId`
interest per `webContents`, batches per destination, and removes interest on
window destruction. Subscription bootstrap and terminal flush close the
attach/detach race. Performance gates measure messages delivered and renderer
work, not only snapshot fan-out.

### Actor lifecycle matrix

Each C-wave PR completes this matrix before implementation:

| Machine            | No subscribers                                              | Window reload                                                                                          | Last window closes                                 | App quit                                           | App restart                                                      | Entity deletion                                                                 |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `app_run`          | Active process retained; idle policy bounded                | Reattach to main snapshot/output                                                                       | Platform convention; active work retained on macOS | Bounded child-process teardown                     | Ephemeral unless separately recovered                            | Stop/dispose actor and process                                                  |
| `user_input`       | Live waiter retained to deadline                            | Rehydrate read model                                                                                   | Continue while application remains alive           | Settle/sweep by shutdown policy                    | Recover only durable pending records                             | Settle requests for deleted entity                                              |
| `connection_flow`  | Continue to timeout                                         | Hydrate via `getStates`; resume broadcasts                                                             | Continue while application remains alive           | Explicitly dispose timers and provider work        | No flow recovery; a completed deep link is an unsolicited return | N/A; provider hooks release flow resources                                      |
| `mcp_oauth`        | Continue to timeout                                         | No internal lifecycle reattach; settlement publishes MCP scopes through epoch-keyed query invalidation | Continue while application remains alive           | Close listeners and settle waiters                 | No implicit recovery                                             | Cancel/settle and fence stale writes before deletion or OAuth-relevant mutation |
| `github_ops`       | Active mutation retained                                    | Reattach                                                                                               | Continue while application remains alive           | Finish or enter explicit recovery                  | Reconcile repository state                                       | Dispose actor after safe settlement                                             |
| `version_preview`  | Active checkout/recovery retained                           | Reattach                                                                                               | Continue while application remains alive           | Preserve/enter recovery contract                   | Reconcile branch/checkout state                                  | Dispose after safe return/settlement                                            |
| `image_generation` | Active jobs retained; terminal jobs retained for 30 minutes | Reattach to the main-owned job-list read model                                                         | Continue while application remains alive           | Stop admission; best-effort cancel; bounded settle | No active-job persistence or auto-run; committed media remains   | Best-effort cancel, bounded settle, and prune jobs for deleted app              |
| `chat_stream`      | Active stream and queue continue                            | Bootstrap all read models                                                                              | Follow real platform shutdown boundary             | Interrupt; abort; bounded unwind                   | Hydrate queue paused; reconcile interrupted                      | Settle owners and unwind before deletion                                        |

Renderer-local machines always die with their renderer resources, but must
settle or compensate their callers. The matrix records product semantics; it
does not imply every main actor is persisted.

## Verified inventory

Summary (full tables and recipes in `plans/claude-cleanup-machines.md`):
116 atoms — 69 UI-only (keep, per-window), 32 machine-mirror (retire),
12 cross-machine + 3 mixed (retire, worst class). Load-bearing verified
corrections that Phase A recipes already encode: release-age outranks
pnpm-migration in the warning priority; six preview-error writer sites
(four in `PreviewIframe.tsx`, including `dyad-app`-sourced cloud-sandbox
errors); `subscribeStreamFinished` is deferred but does not fire on
`disposeKey` (watchIdle facades must observe disposal); provider mount
order constrains facade injection sites.

Multi-window raises Phase A's value but changes its sequencing: per-window
Jotai stores cannot represent shared machine state even in principle, so
unambiguous projection retirement remains valuable. Work that chooses a new
renderer-owned store for a future main-owned domain is not automatically
no-regrets; the chat feasibility gate and per-wave host decisions run before
those storage conversions.

## Ownership model

As in the codex plan, with one amendment. Categories: machine-owned
lifecycle state (snapshot only, hooks/selectors/facades, never mirrored);
external entity data (React Query / main persistence); UI/runtime state
(per-window Jotai or local React state); **cross-process read models —
now the normal case for every main-hosted machine, not an allowlisted
exception**: named read models, one adapter owning hydration/ordering,
read-only public APIs, revisioned, per-window subscription; derived
indexes (read-only external-store selectors, real consumers only).

`user_input`'s renderer adapter stops being the special case and becomes
the reference implementation of the pattern. Documented main-owned resource
registries may expose a narrower consumer-driven boundary instead: their
resource internals remain private, while any renderer-visible lifecycle fact
or intent still follows the revision, correlation, hydration, and
multi-window-convergence rules above.

## Single-window assumptions audit

A tracked checklist; each item gets an owner and lands with the phase
noted. Known items (from the inventory and review record):

- **`event.sender` vs broadcast**: #4033 already widened consent
  broadcasts to all windows — correct for multi-window reads; audit every
  remaining `event.sender`-targeted emission. _Responses_ are claimed by
  requestId (first-applied-wins already exists in user_input). [Phase B]
  **In flight (#4104).**
- **Deep-link / OAuth-return routing** to "the" window: claims are
  main-owned (`connection_flow`/`mcp_oauth` already are); the focus target
  follows the recorded presentation-routing matrix. [Phase B]
- **Notification click focus**: must target the window showing the chat,
  or open one. [Phase C, chat wave]
- **`useManagerPagehideDisposal`**: one window's pagehide must dispose
  only window-local machines, never main-hosted state. Split into
  per-window disposal (renderer machines) and subscription release
  (remote refs). [Phase B] **In flight (#4104).**
- **`EntityDisposalRegistry` scope**: app/chat deletion initiated in
  window A must dispose window-local controllers in _all_ windows
  (broadcast) and the main actor once. [Phase B] **In flight (#4104).**
- **Module-level `getDefaultStore()`** escape hatches: each window has its
  own Jotai store; all such call sites are bugs under multi-window. Phase
  A already removes the known one (ImageGenerationToast); boundary test
  forbids new ones. [Phase A]
- **Chat-tab session persistence** (`chatTabSessionStorageAtom`): schema
  becomes per-window using `WindowSessionId` + `TabInstanceId`, like browser
  session restore. Moving a tab uses acknowledged adopt-then-remove.
  [Phase C]
- **Trusted-main-frame IPC enforcement**: verify it is per-window, not
  per-"the window". [Phase B] **In flight (#4104).**
- **React Query invalidation**: inventory every mutation path that currently
  invalidates only the initiating window and route it through the typed
  invalidation channel. Include an inventory of origin-window
  `setQueryData` call sites — the "unless they have already installed
  equivalent mutation data" carve-out requires knowing every one. [Phase B]
  **In flight (#4104).**
- **High-volume event destinations**: audit app output, chat chunks, terminal
  output, and progress streams for singleton-window or global-broadcast
  assumptions; convert to keyed interest fan-out. [Phase B/C wave]
  **In flight (#4104).**
- **Window-owned capability routing**: screenshot, iframe, focus, dialog, and
  navigation requests identify a target/lease through `WindowRegistry`;
  no first-responder broadcast. [Phase B]

## Rollout

### Phase A — no-regrets ownership cleanup

This section is the self-contained execution index. Detailed per-atom writer,
reader, and test traces remain in `plans/claude-cleanup-machines.md`; this
plan, not deleted Git history, defines PR scope and status.

**A1 — Boundary enforcement and selector bindings: completed in #4090.**

- ownership boundary tests and temporary violation allowlist;
- selector-aware keyed React bindings;
- no intended production behavior change.

**A2 — S-tier mirrors, no new stores: done (#4091).**

- completion-event pair via `useStreamFinished`;
- first-prompt saga projection pair;
- version-preview checkout counter pair;
- `pendingToolConsentsAtom`;
- app-run run-state derived trio.

These deletions do not choose a future host or transport.

**A3 — Single-machine projections with stable direct owners: in flight (#4092).**

- image-generation projection exposed directly by its manager; keep dismissal
  UI state;
- user-input renderer read model moved to one `SnapshotStore` containing
  requests + responding set while preserving hydrate revision handling;
- high-frequency streaming preview moved to a per-chat sidecar;
- app-exit details captured by app-run state rather than a hand-written atom
  projection.

A3 proceeds now: image_generation sits third in C2's order, well behind
A3, and its manager's snapshot/subscribe surface **is** the read-model
shape C2 will later publish remotely — this is preparation for the host
move, not a temporary API.

**A4 — Cross-machine signal edges that do not preselect chat storage:
in flight (#4093).**

- app-run lifecycle/URL edges consumed through typed post-commit facades so
  their source can later swap to a remote actor;
- reload intent uses a typed app-run event rather than an atom counter edge;
- screenshot ingress: both producers (window-local commit requests AND
  chat*stream's end-of-stream capture) migrate to the same local
  `requestCapture` facade injected via deps, and the mailbox atom is
  deleted in this PR — the no-dual-consumption rule holds. The chat_stream
  call site carries an allowlist-style marker tied to B1: when the window
  capability router lands, it replaces the facade's \_implementation*
  (lease-targeted routing instead of the singleton manager), not its call
  sites. Facade indirection is what prevents permanent singleton binding;
  keeping the atom alive until B1 would be the worse binding.

All facade callback registries support multiple consumers. Events carry
invocation/actor identity, not timestamps. Every facade method added in
A4–A5 is tagged (in types or doc comments) with its remote intent class
from the Remote intent policy — idempotent, state-sensitive, cancellation,
or presentation — so the C-wave conversion to receipts/revisions is
mechanical and misclassifications surface now.

**A5 — Multi-producer channels with explicit non-machine owners: complete
(#4098).**

- preview errors split/owned with source-priority and dismissal semantics
  characterized first;
- console buffer receives a keyed owner while preserving batching/tail bounds;
- package-manager warnings receive a standalone owner preserving
  release-age-wins priority and dismissed guards;
- `clearPreviewRuntimeForAppAtom` shrinks only as each replacement registers
  equivalent entity cleanup.

Stores created here expose source interfaces that a later remote/main producer
can feed; they are not described as authoritative shared lifecycle.

**Design gate G1a — Streaming-status authority: DECIDED 2026-07-24.**

Split out of G1 because it is invariant across every G1 outcome: under any
host placement, an authoritative per-chat `StreamState` snapshot exists
(renderer controller today; main actor read model if chat moves), and
streaming status is read from it. Recorded decisions:

1. **Authority and read surface.** The `StreamState` snapshot is the sole
   status authority. Reads use pure selectors (`isStreamActive`,
   `selectCanCancel`, `selectStreamError`) over `useChatStreamState(chatId)`
   with a `?? {type:"idle"}` fallback everywhere — **no controller means
   idle** (matches the retired atom's absent-key semantics). ChatTabs
   aggregates via per-tab keyed subscriptions first; a manager-owned
   read-only index is added only if measurement shows overhead.
2. **Facade contract** (injected via `PlanHandoffDeps`; intent classes:
   idempotent read / subscription):
   - `isIdle(chatId): boolean` over the snapshot;
   - `watchIdle(chatId, cb): () => void` — fires at most once;
     check-subscribe-recheck; **delivery always asynchronous (microtask),
     even when already idle** — uniform async timing makes the #4077
     re-entry class impossible by contract, and matches future remote
     read-model behavior; **observes controller disposal** (the verified
     `subscribeStreamFinished` gap): fires on any transition to
     not-active, disposal included.
   - Source swap to a remote read model (snapshot + actor-disposed
     envelopes) changes the facade implementation only, never callers.
   - `resyncChat` receives `getIsStreaming(chatId)` through chat_stream
     command deps — same authority.
3. **chatError: single owner via machine event.** ChatInput's
   consent-failure writes route through a new additive `external-error`
   event — A6a's one sanctioned transition delta (isolated commit, called
   out in the PR description). Last-error durability: a bounded
   `lastErrorByChatId` map on the manager (cleared on next submit and on
   chat deletion) — no controller pinning, no atom. Revisitable by full
   G1 if errors move into the read model.
4. **Not decided here:** message storage, queue authority, planState
   split, completion-history location, chat host placement — all G1.

**A6a — Streaming status and error retirement: in flight (#4095).**

The `isStreamingByIdAtom` + `chatErrorByIdAtom` stack from the appendix
recipe: useStreamChat first (~15 components follow), ChatTabs aggregate
selector, plan_handoff facade with disposal observation, resyncChat
injection, then delete both atoms, syncProjection, and **both #4077
protective comments** — this removes the only known synchronous
re-entrancy vector and must not wait on the storage study. No new stores
are built; readers convert from atom to snapshot source.

**Design gate G1 — Chat-stream/main feasibility study: accepted
2026-07-27 (GO for C3).** Its inputs (recorded decision 5, the remote
intent policy, the appendix reader inventory) all exist. The study decided:

- authoritative owner of optimistic versus durably accepted messages;
- lifecycle snapshot versus high-frequency chunk transport;
- editable queue authority and persistence;
- callbacks-to-receipts conversion;
- user-input durable handoff;
- plan-handoff placement;
- renderer reload/window-close behavior;
- notification and screenshot routing;
- whether completion history belongs in lifecycle or a read model;
- revision/bootstrap semantics for every renderer read model.

It must produce a serializability inventory, target state/read-model schemas,
acceptance transaction, migration sequence, and deletion budget. Do not build
temporary “revision-free read-model-shaped” renderer stores in anticipation.

**A6b — Chat storage implementation: folded into the C3 cutover and
implemented.**

Messages, queue pair, and planState split. Only the study-approved design
proceeds. The appendix's proposed renderer `MessagesStore`, `QueueStore`,
and accepted-plan projection are recipes to evaluate—not preapproved
destination architecture.

**A7 — Compatibility infrastructure removal: after A2–A6 and relevant C
waves.**

- delete or narrow `registerAtomWriter`/`projectToAtom`;
- remove boundary allowlist entries only when their owner is gone;
- update rules/docs;
- assert retired lifecycle atom names do not return.

Dependencies: A1 is complete; A2 and A3 proceed in parallel; A4 follows
the relevant A2 deletion; A5 follows characterized ownership; G1a is a
same-week decision unblocking A6a; G1 starts immediately in parallel and
gates only A6b; A7 is last and may span Phase D.

Status legend for this section: **pending** / **in flight (#PR)** /
**done (#PR)**. Update statuses as PRs land — this file is the
plan-of-record that reviews cite.

No Phase A PR polishes a shared-entity renderer controller scheduled for
deletion by a host move.

### Phase B — multi-window and distributed infrastructure

**B0 — ADR, recorded decisions, and deletion budgets: in flight (#4096).**

- copy the five approved product decisions from this plan;
- record one-authority, commit-versus-completion, and no-multi-primary rules;
- complete the initial actor lifecycle matrix, **including the named open
  cells: `image_generation` app-quit policy and app-restart persistence
  decision** (they do not survive B0 as TBD);
- define app-run pilot deletion list;
- classify every remote event's intent/admission policy.

Decision record:
[`docs/adr/main-owned-state-machines.md`](../docs/adr/main-owned-state-machines.md).
Image generation uses best-effort cancellation with a bounded settlement
window on app quit; active jobs are not persisted or automatically resumed
after app restart. The accepted G1 study now supplies the completed
`chat_stream` lifecycle row and intent classification.

**B1 — WindowRegistry, routing, cache coherence, and test harness: in flight
(#4102).**

- stable `WindowSessionId` and `TabInstanceId`;
- ephemeral `webContents` registration/cleanup;
- focus and visible-entity tracking;
- presentation routing matrix;
- window capability leases — minimal semantics, screenshot-scoped only:
  single holder per `(kind, appId)`, revoked on `webContents.destroyed` or
  iframe-epoch change, requester retries or settles per its declared
  policy. Dialogs/navigation/focus stay on plain presentation routing; a
  second real lease consumer must exist before the mechanism generalizes
  (rule of three applies to leases too);
- typed React Query invalidation epochs and reconnect-gap behavior;
- keyed high-volume output/chunk interest;
- a test-only two-window Electron harness independent of final product UX.

The harness can create two trusted renderer windows, assign session IDs,
reload/destroy either independently, inspect subscriptions, dispatch from
either, and test adopt-then-remove tab transfer.

**B2 — Definition + local ActorHost kernel: in flight (#4100).**

- machine definition;
- actor instance identity, snapshot revision, and transaction sequence;
- `ActorHost` and local refs;
- lifecycle policies;
- dispatcher tickets that settle their exact FIFO event;
- host conformance suite;
- selector-aware hooks from A1;
- synthetic machines only.

**B3 — Contract-driven remote transport: implemented.**

- static manifest;
- trusted typed handlers;
- outer and per-definition Zod validation;
- per-definition authorization;
- applied/ignored/rejected/disposed receipts;
- atomic subscribe/bootstrap;
- snapshot/disposed broadcasts;
- bounded message deduplication;
- per-window and cross-window reference counting.

Conformance includes:

- two windows subscribe to one actor and independently disconnect;
- `webContents.destroyed` removes only that window;
- lost unsubscribe cannot retain a destroyed window;
- window B dispatches after window A initiated work;
- stale-revision mutation is rejected/ignored by declared policy;
- cancellation requires the invocation ref;
- no-subscriber lifecycle follows the definition, not an implicit global rule.

**B4 — Remote client, hydration, and React: implemented.**

- one `RemoteMachineClient` per renderer window;
- revisioned stores;
- pre-bootstrap buffering;
- revision-gap resync;
- reconnect and window recreation;
- explicit `connecting/ready/disconnected/incompatible` capability state;
- StrictMode and provider replacement tests.

Phase B has no intended user-visible behavior change until a production
machine enters Phase C. Kernel and transport remain separate revert points.
With B4 complete, Phase B is complete and C1 is unblocked.

### Phase C — host migrations

**C1 — `app_run` pilot.**

Status: **C1.1–C1.2 done; C1.3 authority cutover and trailing deletion
implemented** — main
app-runtime orchestration is behind a transport-neutral service, the
production `app_run` definition is registered on the main `ActorHost`, and
renderer consumers use its revisioned remote read model. Producer lifecycle
events are bound to the invocation at output-sink creation and enter the actor
before keyed console fan-out. The separate rolling-deletion change removes the
legacy renderer controller/manager, invocation registry, lifecycle command
adapter, fallback projections, and renderer producer routing. C1 is accepted
when the authority-cutover and stacked deletion PRs land.

Main owns process lifecycle and binds producer output to the invocation at
creation. Renderer windows keep local console views and `preview_iframe`
machines while consuming one remote lifecycle read model.

Status:

- C1.2 app-run wire codecs, event refinement, and safe remote projection:
  **done**. The contracts ship dark; no cutover slot is consumed.

Required deletions:

- renderer `AppRunController` and `AppRunManager`;
- renderer invocation registry for producer routing;
- app-run lifecycle projections;
- renderer-to-main lifecycle command adapter;
- timestamp/map-edge restart inference.

Acceptance adds to the distributed pilot:

- same app in two windows, one process, both update;
- restart from B after start from A;
- stale action from an old revision follows declared policy;
- cancellation targets the invocation;
- closing A during pending start continues work;
- reload B while A stays attached;
- keyed console fan-out reaches interested windows only;
- screenshot/iframe effects target a valid window capability lease.

**C2 — Resource-owner waves, one machine per PR.**

Candidate order: `github_ops`, `version_preview`, `image_generation`.
Each requires serializability audit, safe remote projection, lifecycle-matrix
completion, deletion budget, crash/reload tests, same-entity-two-window tests,
and window-close-mid-operation tests.

Status: **`github_ops` cutover and trailing deletion implemented** — the verified lifecycle policy,
serializability audit, safe projection, conflict-resolution receipt decision,
and renderer adapter/channel deletion budget are recorded in the
[B0 ADR](../docs/adr/main-owned-state-machines.md#github_ops). Main now owns
the actor and Git command execution, renderers consume its revisioned read
model, and B1 publishes branch/app/version invalidations. The required
separate trailing PR deletes the superseded renderer controller, manager,
command runner, and mutation/probe IPC channels. Acceptance is pending review
and merge of the cutover and its stacked deletion.

Status: **`image_generation` main-host cutover and legacy deletion
implemented** — one main-owned collection actor now runs concurrent provider
jobs and publishes the renderer-safe job list to every window. Immutable job
IDs make creation idempotent, cancellation requires the exact active
invocation ref, provider settlements remain host-only, and targeted
presentation events follow initiator-first routing. The renderer controller,
manager, command runner, invoke channels, and Jotai-style projection adapter
are deleted in the same change. The singleton collection remains available to
mounted windows while every terminal job receives its own 30-minute prune
deadline. Shutdown requests best-effort cancellation with bounded settlement;
app deletion first fences admission and prunes its read-model entries before
bounded cancellation. Restart begins with no active-job state while preserving
media already committed to disk.

`connection_flow` and `mcp_oauth` are already correctly main-authoritative.
First expose them through the common remote reference/read-model contract if
needed. Their listener, timer, waiter, claim, and close-barrier registries stay
intact unless ActorHost adoption demonstrably deletes code or fixes a known
deficiency. They are not mechanical migrations, and documented resource
registries are an acceptable end state.

Main-registries audit — **audit complete; specialized registries retained,
boundary hardening pending**. The evidence inventory and binding disposition
are recorded in the
[B0 ADR](../docs/adr/main-owned-state-machines.md#main-registries-audit):

- `connection_flow`: the renderer reads the per-provider lifecycle through
  `connection-flow:get-states` on hydration and
  `connection-flow:state-changed` thereafter. It separately consumes the
  narrow `connection-flow:unsolicited-return` notification to refresh
  provider data after a cold-start or stale deep-link return. This projection
  is the concrete surface consumed by `useConnectionFlow` and the GitHub,
  Neon, and Supabase connector components; do not publish additional registry
  internals. Its intent boundary is not yet
  multi-window-safe: `start` and `acknowledge` need authoritative revision
  admission, and C2 must replace the historical string `flowId` with a typed
  `ConnectionFlowInvocationRef` minted through the shared `IdSource`.
  Cancellation requires the exact active ref rather than resolving an omitted
  ID to whichever flow is current; acknowledgment, timers, provider callbacks,
  and every echo-capable boundary carry the same ref. Deep-link returns that
  cannot echo it use a documented structural `InvocationRegistry` claim. The
  custom registry also needs explicit shutdown disposal for its watchdogs and
  provider work. These are boundary/lifecycle hardening requirements, not
  justification for replacing its specialized internals with `ActorHost`. The
  current renderer-owned `resources-loaded` barrier is also not meaningful
  across windows: after durable credential persistence, main should settle the
  flow and publish correlated provider-status invalidation; every window
  refreshes its own query families without acknowledging main lifecycle
  completion.
- `mcp_oauth`: the renderer does not read the registry snapshot. Its Connect
  mutation awaits the existing `mcp:start-oauth` invoke through terminal
  settlement, then invalidates the persisted MCP server/tool queries; the
  durable renderer-visible fact is `McpServer.oauthConnected`, read through
  `mcp:list-servers` by `useMcp`/`usePluginConnect`. Intermediate
  binding/callback/exchange states exist only to coordinate main-owned
  listeners, waiters, claims, and close barriers. Publishing them would create
  an unused read model. The `mcp:start-oauth` one-shot reply alone is
  insufficient across renderer reload or window close: after persisted
  settlement, main must publish the MCP server/tool scopes through the global
  epoch-keyed `QueryInvalidationEvent` channel. Its reconnect/bootstrap and
  gap recovery provide convergence; this is not a live-only terminal event.
  Server deletion, disconnect, OAuth disable, and OAuth-relevant configuration
  changes must cancel and settle matching in-memory flows and fence stale
  provider writes before mutating the row.
  C2 also replaces the registry's historical string `flowId` with a typed
  `McpOAuthInvocationRef`, echoed through listener, waiter, timer, callback,
  exchange, supersession, and settlement boundaries. That correlation
  identity is distinct from the renderer message ID used for retry dedupe.
- Neither registry adopts `ActorHost`: replacing the specialized resource
  maps and effect sequencing would not delete those internals or fix the
  identified boundary deficiencies. The placement rows record the retained
  registries; the lifecycle matrix records the required end state rather than
  blessing current cleanup gaps.

Renderer-triggerable intent disposition:

| Registry          | Intent                    | Target admission                                                                                                                                                  |
| ----------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection_flow` | `start`                   | State-sensitive; require `expectedRevision`; main mints the typed `ConnectionFlowInvocationRef`                                                                   |
| `connection_flow` | `cancel`                  | Cancellation; require the exact active `ConnectionFlowInvocationRef`                                                                                              |
| `connection_flow` | `acknowledge`             | State-sensitive; require `expectedRevision` and matching invocation ref                                                                                           |
| `connection_flow` | `resources-loaded`        | Renderer-triggered today; remove as an intent when correlated provider-status invalidation replaces the per-window barrier                                        |
| `mcp_oauth`       | Connect via `start-oauth` | Current-agnostic last-request-wins; carry a renderer message ID for retry dedupe; main mints a typed `McpOAuthInvocationRef` and settles the displaced invocation |

All other preparation, callback, timer, exchange, failure, claim, and
close-barrier events remain host-only and correlated internally. The audit
does not authorize production code in this docs PR. The
`pr_c2_main_registries` implementation wave owns focused hardening and tests
for stale cancellation, post-persistence invalidation across reload, OAuth
configuration mutation/deletion, stale-write fencing, and explicit shutdown
disposal.

**C3 — Chat-stream and plan-handoff execution: cutover complete
(`c3-chat-main-authority`); trailing deletion PR pending.**

Implement the G1 design only after the app-run transport proves remote
hydration and multi-window dispatch. Preserve existing batched chunk channels;
snapshots carry lifecycle, not stream bytes. This wave owns durable acceptance,
editable queue semantics, notification routing, window reload, and
window-close behavior as one reviewed protocol.

The cutover PR moves both actors to the main process, stores immutable chat
intents and plan-handoff checkpoints in SQLite, makes queue mutations
revision-conditional, routes plan presentation through `WindowRegistry`, and
keeps the existing keyed chunk fan-out. Renderer controllers, the legacy queue
file writer, and superseded projection atoms remain only as compile-time
adapters for the immediately following deletion PR required by Phase D.

**C4 — Multi-window product surface.**

Window creation, explicit duplication, tab drag/transfer, per-window session
restore, and focus routing. Moving a tab preserves serializable presentation
state—including scroll anchor/position, selected file and cursor, preview
history, open panels/modes, draft input, and relevant selections—using
destination-adopt acknowledgement before source removal. DOM-only resources
such as iframe, Monaco, and terminal views are recreated to equivalent visible
state.

Architecture tests do not wait for this UX: B1's test harness exists first.

### Phase D — delete transitional infrastructure (rolling, per wave)

Correction recorded 2026-07-25: there is **no live-IPC version-skew window
in production**. Dyad updates via `update-electron-app`/Squirrel
(src/main.ts) — updates apply on restart, main and renderer always ship
from one bundle, and a mid-session renderer reload loads the running
bundle, not the staged one. Version discipline therefore applies to
**persisted state only** (durable records, persisted snapshots, tab
sessions — written by vN, read by vN+1 after restart); live transport
carries a cheap protocol-version assert (mismatch → log + reload; a
dev-only HMR phenomenon), not a compatibility matrix. The earlier
"supported update window" constraint on deletions is void.

Deletion is therefore **rolling and immediate**: each C wave's temporary
adapters and legacy channels are deleted in a **separate PR landing right
behind the cutover** (same day is fine). Corrections recorded 2026-07-25:
(1) no update window — one bundle, updates apply on restart; (2) no
runtime toggle exists, so retained adapters are dead code enabling no
runtime rollback, and straggler callers are compile-time-detectable via
typed IPC contracts; (3) no bake period either — dead-code deletion
cannot regress runtime once typecheck/CI pass, and a later cutover
revert simply reverts both PRs (two clean commands). The separation
exists ONLY for review clarity: the high-scrutiny cutover diff stays
pure, undiluted by mechanical deletions. The final Phase D shrinks to:

- remove any remaining superseded controllers/managers and only those
  registries actually replaced;
- remove remaining projection writers and atom mailboxes;
- remove temporary boundary allowlist entries;
- update `rules/state-machines.md`, `rules/electron-ipc.md`,
  `rules/jotai-state.md`, and `docs/why-state-machines.md`;
- add boundaries preventing lifecycle mirrors, untyped window routing, and
  module-global renderer stores.

## Verification strategy

### Single-window protection

Multi-window infrastructure must not regress the current product. Two
standing rules:

- **Golden single-window characterization suite**, captured **before any
  Phase B wiring touches production paths** and run by every PR that
  reroutes an existing flow through new infrastructure (presentation
  routing, invalidation channel, interest-keyed fan-out, pagehide/disposal
  split, tab-session schema). Contents: toast/notification delivery per
  flow; invalidation-triggered refetch counts per mutation; console
  first-line-after-subscribe timing; quit/reload teardown order; tab
  session restore from a captured real session blob. Mostly a named
  collection of assertions that already exist scattered across suites —
  regressions become diffs, not bug reports.
  **Landed in PR #4097.**
- **N=1 identity rule.** With exactly one window, the presentation router
  short-circuits to that window unconditionally; a dev-mode assert
  computes the full fallback chain and flags any divergence from the
  short-circuit (a permanent shadow comparison, at zero production risk).
  Likewise, origin windows keep their synchronous local React Query
  invalidation permanently — the broadcast channel is additive for other
  windows and deduped by epoch; wiring the channel never deletes a local
  `invalidateQueries` call.

Everything from the codex plan (pure transition tests, controller/host
conformance, renderer tests that never mock Jotai for machine state,
integration scenarios, performance checks) plus the multi-window layer:

- B1 harness tests window identity, focus/visibility routing, capability lease
  loss, adopt-then-remove tab transfer, invalidation epoch gaps, and keyed
  high-volume interest;
- transport conformance always runs the two-window scenarios from B3;
- every C-wave migration adds: same-entity-two-windows, cross-window
  dispatch, stale-revision intent, invocation-targeted cancellation,
  window-close-mid-operation, and one-window reload;
- E2E: packaged Electron tests open a second window for the app_run and
  chat waves (start in A, observe/control in B; close A; reload B);
- performance: snapshot fan-out to N windows is measured for app_run and
  chat before their waves; high-volume content (chunks, console) stays on
  keyed batched channels and never rides snapshots;
- cache-coherence integration tests mutate in A, observe query invalidation
  and fresh data in B, disconnect B across an invalidation, and verify
  conservative recovery from the epoch gap;
- window-owned effect tests close the leased screenshot/iframe window during
  execution and assert the declared retry/rejection path rather than
  first-responder behavior.

Review constraints from the distributed plan hold: kernel, transport, and
each pilot are separate revert points; no PR mixes generic transport with
domain behavior change; every remote definition gets security review
(static manifest, event codecs as allowlist, per-definition authorization,
commands never cross from renderer, projections exclude main-only data);
high-blast-radius waves get deep multi-agent review.

## Non-goals

- Multi-primary state, CRDTs, shared memory, or transparent sync IPC —
  one authoritative host per actor, windows are subscribers.
- Moving per-window machines to main for symmetry; moving UI-only atoms
  into machines; snapshots carrying console logs or LLM chunks.
- Replacing React Query; XState; actor hierarchies/supervision trees;
  exactly-once command execution claims.
- Networked/multi-instance Dyad; hot-moving live actors between processes.
- Visual polish and full window-management UX beyond C4's required creation,
  explicit duplication, transfer, restoration, and routing behavior.

## Risks (deltas from the source plans)

- **Transport is the largest new mechanics surface.** Mitigation is to build
  it once behind adversarial conformance suites and a fake-transport crash
  harness; the kernel/dispatcher record shows this pattern holds.
- **Fan-out cost.** N windows × snapshot frequency; mitigated by
  lifecycle-only snapshots, per-window reference counting, keyed
  high-volume interest, and measured gates before app_run/chat waves.
- **chat_stream complexity.** The single biggest unknown; contained by
  G1's study-before-storage gate and C3 implementing only the approved
  design.
- **Window routing becomes hidden authority.** Focus/visibility metadata
  must never authorize domain work; it selects only presentation or a
  window-resource capability lease. Main actor state remains authoritative.
- **Cross-window cache drift.** Machine snapshots can be correct while React
  Query data is stale; invalidation epochs and reconnect-gap recovery are
  required before production host migrations.
- **Two authorities during migration.** Each C wave keeps one command
  authority at every step; shadow transitions are pure and effect-free;
  cutover and deletion land in the wave's PR sequence with tests asserting
  a single lifecycle-command issuer.
- **Roadmap risk: multi-window slips or is cut.** Phase A and B1 remain
  fully justified (cleanup + window correctness); B2–B4's actor/transport
  runtime is the at-risk investment—which is why C1 (`app_run`) follows
  immediately and is independently justified by the single-window bug
  record (#3969 class, reload teardown). If multi-window dies entirely,
  stop after C1/C2 and retain the useful result: app-run authority beside
  its main-owned process, without committing to every later migration.

## Success criteria

Phase A: as before — zero same-process machine-written atoms outside
documented keeps or G1-approved transitional read models; typed
identity-carrying facades; #4077 comments deleted only when the hazard is
actually gone; boundary tests prevent reintroduction.

Phase B: window-routing/cache-coherence and actor/transport conformance suites
green including all two-window scenarios; no intended user-visible behavior
change before C1; dispatch tickets/receipts distinguish sent / committed /
ignored / rejected / disposed.

Phase C, per wave: the machine has exactly one authoritative host; its
renderer controller and compensating plumbing are deleted (deletion budget
met); same-entity-two-windows and window-close-mid-operation tests pass;
no regression in the wave's product flows.

End state: authority lives beside the resource it controls; ordinary actors
share the transition/transaction kernel across both processes while narrow
documented resource registries may retain specialized internals; windows are
views, and ordinary shared actors require no machine-specific transport
plumbing; window-owned resources use explicit routing adapters; Jotai holds
only per-window UI state; renderer reload and window close are supported
lifecycle events, not teardown hazards; contributors can explain sent,
committed, completed, and durably accepted as distinct states; and the
rules/docs describe this architecture, not the transitional one.
