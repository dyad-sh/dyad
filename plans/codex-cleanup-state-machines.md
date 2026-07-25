# Cleanup and Consolidation of the State-Machine Layer

## Status

Proposal.

This plan follows `plans/state-machines-hardening.md`. The hardening work made
the state-machine layer substantially safer: transition results are
discriminated, operation identity is explicit, lifecycle cleanup is shared,
selected controllers use transactional dispatch, and transition traces are
more useful. It did not attempt to make the resulting architecture small or
uniform.

The next problem is comprehensibility. Several workflows now have an
authoritative state-machine snapshot and a second Jotai representation of the
same lifecycle. Some machines use `TransactionalDispatcher`; others still
implement their own dispatch loop. Some cross-machine signals travel through
typed facades, while others travel through atoms that act as mailboxes or
observable flags. Providers and managers repeat similar ownership plumbing.

This plan removes those transitional structures without weakening the race,
identity, disposal, persistence, or observability guarantees established by
the hardening work.

## Executive summary

The target architecture is:

```text
producer event
    |
    v
typed machine facade
    |
    v
TransactionalDispatcher -> committed immutable snapshot -> pure selectors
    |                                                       |
    v                                                       v
command adapter                                      React domain hook
    |                                                       |
    v                                                       v
IPC / Query / UI-only runtime stores                      component
```

The central rule is:

> A lifecycle fact represented in a machine snapshot is not also stored in
> Jotai.

Jotai remains appropriate for client-only state that is not owned by a
machine: edit buffers, navigation preferences, high-frequency console and
stream content, transient selections, and independently sourced diagnostics.
React Query remains authoritative for IPC-backed entities. Main-process
machines may expose renderer read models across IPC, because that is a process
boundary rather than a second same-process authority.

The cleanup is incremental. Each domain migrates its consumers first, deletes
its compatibility projection in the same PR, and retains focused regression
tests. There is no repository-wide flag day and no period in which two
independent writers are accepted as a steady state.

## Problem statement

### 1. Same lifecycle, multiple representations

The largest example is `app_run`.

`RunState` already contains:

- the lifecycle (`idle`, `starting`, `ready`, `reloading`, `stopping`,
  `stopped`, or `errored`);
- the operation and `startedAt`;
- the current invocation identity;
- the current URL;
- the exit code;
- the operation error.

The renderer also stores related values in:

- `previewRunStateByAppIdAtom`;
- `appUrlByAppIdAtom`;
- `previewAppExitByAppIdAtom`;
- `previewErrorByAppIdAtom`;
- `previewReloadTokenByAppIdAtom`.

Some of these are exact projections, some combine independent sources, and
some are imperative UI epochs. Keeping them together in
`previewRuntimeAtoms.ts` obscures ownership and makes one output event update
the machine and atoms in separate commits.

`chat_stream`, `first_prompt`, and `image_generation` also publish
same-process machine projections into Jotai:

- `isStreamingByIdAtom`;
- `firstPromptSagaAtom`;
- `imageGenerationJobsAtom` and its derived atoms.

Single-writer enforcement prevents the worst races, but it does not remove the
second representation, projection lifecycle, cleanup ordering, or reviewer
burden.

### 2. Atoms used as cross-machine protocols

Three current dependencies use Jotai as an event or status bus:

- `preview_iframe` watches `previewRunStateByAppIdAtom` to infer that
  `app_run` restarted;
- `plan_handoff` watches `isStreamingByIdAtom` to infer that `chat_stream`
  became idle;
- screenshot producers write `pendingScreenshotAppIdsAtom`, which the
  screenshot provider consumes as a mailbox.

These dependencies are difficult to discover from the machine types. They
also lose domain information: a boolean edge or map mutation is weaker than a
typed event carrying the relevant operation identity.

### 3. Controller mechanics remain inconsistent

There are thirteen machine domains:

- renderer workflows: `app_run`, `chat_stream`, `first_prompt`,
  `github_ops`, `image_generation`, `plan_handoff`, `preview_iframe`,
  `screenshot`, `version_preview`, and `voice_to_text`;
- main-process workflows: `connection_flow`, `mcp_oauth`, and `user_input`.

Only `image_generation`, `screenshot`, and `voice_to_text` currently use
`TransactionalDispatcher`. The remaining runtimes use combinations of
`SnapshotStore`, hand-written re-entrancy queues, direct observer calls,
registry maps, timers, and domain-specific command drains.

Some deviations are legitimate, especially main-process registries owning
external resources. The current code does not make the distinction obvious:
custom mechanics and necessary domain policy are interleaved.

### 4. Aggregate UI state is sometimes stored instead of selected

Examples:

- `activeCheckoutCounterAtom` mirrors whether any `version_preview` controller
  is mutating;
- `isStreamingByIdAtom` is an aggregate index over per-chat snapshots;
- image-generation job arrays are copied from a manager projection store into
  Jotai and then selected again.

Aggregate views are useful, but they should be read-only external-store
selectors over authoritative snapshots. They should not require another
general-purpose state container.

### 5. Domain adapters know too much about Jotai

Machine command adapters legitimately perform UI effects, but several also
read lifecycle flags or write lifecycle projections. This makes a pure machine
look authoritative while its effective behavior still depends on atom state.

For example, `plan_handoff` reads streaming status from Jotai, and
`app_run` commands separately write URL and error atoms. These should be
explicit dependencies or machine events, not implicit access to a shared
store.

## Goals

1. Give each lifecycle fact exactly one authoritative owner.
2. Make renderer components read machine snapshots through domain hooks and
   pure selectors.
3. Remove same-process machine-to-Jotai lifecycle projections.
4. Replace atom mailboxes and cross-machine flag watching with typed facades
   or typed events wired at composition roots.
5. Migrate custom controller transaction mechanics to
   `TransactionalDispatcher` unless a documented resource-owning registry
   genuinely requires a different runtime.
6. Reduce provider, manager, and selector boilerplate without introducing a
   framework that owns domain policy.
7. Keep high-frequency and orthogonal UI state out of machine snapshots.
8. Preserve all operation-correlation, stale-event, disposal, hydration,
   queue-ownership, and cross-process guarantees from the hardening work.
9. Make ownership mechanically auditable in tests and repository boundaries.

## Non-goals

- Replacing the pure TypeScript machines with XState or another statechart
  framework.
- Moving all renderer state into machines.
- Moving console logs, partial streamed text, form buffers, modal visibility,
  selected files, or other high-frequency/ephemeral UI state into machine
  snapshots.
- Replacing React Query with machine or Jotai caches.
- Rewriting stable domain transitions merely to normalize state names.
- Combining independent machines into one application-wide machine.
- Removing cross-process renderer read models when the authority lives in the
  main process.
- Changing visible product behavior as part of a mechanical cleanup.

## Ownership model

Every stateful value touched by a machine migration must be classified before
code changes begin.

### Machine-owned lifecycle state

Examples:

- current phase;
- active operation identity;
- retry/cancellation status;
- machine-owned URL or selected version;
- machine-owned error and recovery state;
- capability flags derived from the snapshot.

Rules:

- stored only in the machine snapshot;
- read through a domain hook/facade;
- derived with pure selectors;
- never mirrored into a writable atom;
- never reconstructed by watching command side effects.

### External entity data

Examples:

- apps, chats, versions, settings, files, reports, persisted plans.

Rules:

- owned by React Query or the main-process persistence layer;
- invalidated or refreshed by command adapters;
- not copied into machine state unless a stable operation snapshot is required
  for correctness.

### UI/runtime state

Examples:

- chat edit buffers;
- partial streamed message text;
- console output buffers;
- terminal panel visibility;
- dismissed banners;
- visual-editor selections;
- local dialog/form state.

Rules:

- Jotai when it must survive unmounts or be shared across distant components;
- local React state when confined to one subtree;
- keyed by entity where applicable;
- not promoted into a machine solely to reduce atom count.

### Cross-process projections

Examples:

- renderer-visible pending user-input requests whose authority is the
  main-process `user_input` registry.

Rules:

- explicitly named as read models or projections;
- one adapter owns hydration, ordering, and writes;
- public APIs are read-only;
- not described as duplicate renderer machine state;
- may remain Jotai-backed when Jotai composition is materially useful.

### Derived indexes

Examples:

- “any version checkout in progress”;
- “which chats are currently streaming”;
- image-generation job lists.

Rules:

- computed from authoritative keyed snapshots;
- exposed by a manager as a reference-stable external-store snapshot only
  when a real cross-key consumer exists;
- never independently mutated;
- prefer per-key subscriptions so unrelated entities do not rerender;
- document retention and cleanup if the index includes terminal snapshots.

## Current-state audit and intended disposition

| Domain             | Runtime today                                          | Duplicate/implicit state                                                       | Disposition                                                                                     |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `app_run`          | Custom `SnapshotStore`, FIFO, command queue            | Loading, URL, operation error, exit overlap in preview atoms                   | Migrate runtime; remove lifecycle projections; split independent diagnostics                    |
| `chat_stream`      | Custom `SnapshotStore` and command orchestration       | `isStreamingByIdAtom`; queue/status dependencies through Jotai                 | Migrate runtime; direct per-chat selectors; typed status facade                                 |
| `first_prompt`     | Custom controller                                      | `firstPromptSagaAtom` mirrors snapshot projection                              | Expose snapshot/projection in provider context; delete atoms                                    |
| `github_ops`       | Custom controller                                      | No lifecycle atom projection                                                   | Preserve hook shape; migrate transaction mechanics                                              |
| `image_generation` | `TransactionalDispatcher` per job                      | Manager projection copied into Jotai                                           | Expose manager projection directly through hooks; keep dismissal UI atom                        |
| `plan_handoff`     | Custom controller                                      | Reads stream-idle through `isStreamingByIdAtom`                                | Inject chat-stream status facade; migrate runtime                                               |
| `preview_iframe`   | Custom controller                                      | Restart inferred through app-run atom; error command writes mixed preview atom | Wire typed app-run event; split iframe diagnostics; migrate runtime                             |
| `screenshot`       | `TransactionalDispatcher`                              | `pendingScreenshotAppIdsAtom` is a producer mailbox                            | Replace mailbox with injected screenshot request facade                                         |
| `version_preview`  | Custom controller                                      | Global `activeCheckoutCounterAtom` mirrors mutations                           | Expose aggregate mutation selector from manager; migrate runtime                                |
| `voice_to_text`    | `TransactionalDispatcher`                              | None identified                                                                | Use as the minimal direct-binding reference implementation                                      |
| `connection_flow`  | Custom main registry with derived effects              | No Jotai duplication                                                           | Adopt shared dispatch/lease mechanics where compatible; document remaining deviation            |
| `mcp_oauth`        | Custom main registry owning listeners, waiters, timers | No Jotai duplication                                                           | Separate pure transaction mechanics from resource registry; retain explicit resource policy     |
| `user_input`       | Main registry plus renderer IPC projection             | Legitimate cross-process projection                                            | Keep boundary; audit naming and optionally replace atom backend only if it simplifies consumers |

## Target renderer APIs

### Keyed machine hook

Each keyed renderer machine exposes one domain hook:

```ts
interface AppRunView {
  state: RunState;
  projection: AppRunProjection;
  send(event: AppRunInput): void;
}

function useAppRun(appId: number | null): AppRunView;
```

The projection is a reference-stable, pure function of the snapshot:

```ts
function projectAppRun(state: RunState): AppRunProjection;
```

It can expose convenient values such as `isLoading`, `url`, `operationError`,
and capabilities, but it does not store them elsewhere.

### Imperative facade

Non-React consumers and other machines receive a narrow facade:

```ts
interface ChatStreamStatusFacade {
  getState(chatId: number): StreamState;
  subscribe(chatId: number, listener: () => void): () => void;
}
```

The facade is injected at a composition root. A machine does not import
another machine's manager, controller, provider, or atom.

### Aggregate external-store selector

Cross-key UI uses an aggregate manager snapshot only when per-key component
subscriptions are impractical:

```ts
interface ImageGenerationProjectionSource {
  getSnapshot(): readonly ImageGenerationJobView[];
  subscribe(listener: () => void): () => void;
}
```

The manager owns reference stability and retention. React consumes it with
`useSyncExternalStore`; it is not copied into Jotai.

### One-shot domain events

Events such as stream completion or app-run restart remain subscriptions, not
state:

```ts
interface AppRunLifecycleEvent {
  appId: number;
  invocationRef: AppRunInvocationRef;
  type: "restart-started" | "stopped";
}
```

Callbacks run after the committed snapshot is visible. Event APIs document
whether they are lossless, replayable, or live-only.

## Shared infrastructure changes

### 1. Selector-aware external-store bindings

Add small React helpers under `src/state_machines/react.ts`:

- `useMachineSelector(controller, selector, isEqual?)`;
- `useKeyedMachineSelector(manager, key, selector, isEqual?)`;
- `useProjectionSource(source)`.

Requirements:

- no resubscription when only the selector closure changes;
- reference-stable server snapshot behavior;
- optional equality for small scalar/object projections;
- tests for unrelated-key updates and StrictMode replay;
- no dependency on Jotai.

Prefer React's supported selector shim if already available transitively;
otherwise keep the helper small and tested rather than implementing a broad
state library.

### 2. Standard manager facade

Keep `KeyedControllerHost`, but standardize the common renderer manager
surface:

```ts
interface KeyedMachineManager<Key, State, Input> {
  getSnapshot(key: Key): State;
  subscribeKey(key: Key, listener: () => void): () => void;
  send(key: Key, input: Input): void;
  disposeKey(key: Key): void;
  dispose(): void;
}
```

Do not force promise-returning dispatch, recovery indexes, or specialized
registrations into this base interface. Those remain domain extensions.

### 3. Projection-free provider convention

Providers own managers and lifecycle only. They do not copy snapshots to
atoms.

The standard provider shape is:

1. construct the manager without external subscriptions;
2. start subscriptions after commit;
3. register entity disposal;
4. expose the manager through context;
5. stop synchronously and dispose with the existing StrictMode-safe lifecycle.

Domain hooks live beside the provider and return state/projection/actions.

### 4. Composition-root wiring

Create typed adapters at the nearest common owner for:

- `app_run -> preview_iframe`;
- `chat_stream -> plan_handoff`;
- producers `-> screenshot`;
- `user_input -> chat_stream` (preserve the existing facade direction).

Record the final dependency graph in module headers and in a focused
architecture test. It must remain acyclic.

### 5. Ownership boundary test

Extend `src/state_machines/boundaries.test.ts` with enforceable rules:

- `state.ts` and `transition.ts` cannot import `@/atoms`, Jotai, React, IPC, or
  another machine;
- a machine directory cannot import another machine's controller, registry,
  manager, or provider;
- machine lifecycle projection modules cannot export writable Jotai atoms;
- approved cross-process projection modules are allowlisted with a reason;
- approved UI/runtime atom imports in command adapters are inventoried;
- new uses of `registerAtomWriter` or `projectToAtom` outside the cross-process
  allowlist fail the test.

This is intentionally stricter for new code than for the initial migration.
Temporary exceptions carry an owner and deletion PR.

## Domain cleanup details

### A. `app_run`

This is the first and most important cleanup because it has the most confused
ownership and feeds `preview_iframe`.

#### State and projection

Add `app_run/projection.ts` with a pure, cached `projectAppRun` selector.
Expose:

- lifecycle state;
- `isLoading`;
- active operation and `startedAt`;
- current `RunUrl | null`;
- operation error;
- stopped/ready status;
- capabilities such as `canStart`, `canRestart`, `canStop`, and
  `canReload`.

Do not expose invocation identity to ordinary UI consumers unless required for
diagnostics.

#### Split `previewRuntimeAtoms`

Delete machine-owned storage:

- `previewRunStateByAppIdAtom`;
- `currentPreviewRunStateAtom`;
- `currentPreviewLoadingAtom`;
- `currentPreviewRunStartedAtAtom`;
- `appUrlByAppIdAtom`;
- `currentAppUrlAtom`;
- the `dyad-app` portion of `previewErrorByAppIdAtom`.

Audit before deciding the fate of:

- `previewAppExitByAppIdAtom`: if the UI needs the last output event timestamp
  independently of current machine state, rename it to
  `lastPreviewExitEventByAppIdAtom` and document it as diagnostics history;
  otherwise derive exit information from `RunState`;
- `previewReloadTokenByAppIdAtom`: move iframe identity changes into
  `PreviewIframeState.iframeEpoch` and delete the token;
- `previewErrorByAppIdAtom`: split independent iframe/client/sync diagnostics
  into explicitly named keyed stores, then compose display priority in a pure
  preview selector;
- console entries and package-manager warnings: retain as runtime/UI state.

#### Commands and producer output

- `applyUrl` changes machine state; it must not separately write a URL atom.
- Operation failure changes machine state; it must not separately write a
  lifecycle error atom.
- `APP_EXIT` must have one authoritative admission/commit path. Independent
  diagnostic history, if retained, is written only after the machine admits
  the correlated event.
- HMR/manual reload emits a typed iframe reload/restart event through the
  composition adapter rather than incrementing an atom token.
- Console logging and warnings remain adapter effects.

#### Runtime

Migrate `AppRunController` to `TransactionalDispatcher`.

Preserve:

- non-blocking run/stop IPC settlement;
- per-app command scheduling policy;
- invocation registration and claims;
- dispatch waiter settlement;
- legacy ref-less producer compatibility;
- external agent lifecycle operations;
- disposal of pending waiters and late settlements.

Delete:

- the hand-written `processing` flag;
- the `pendingEvents` FIFO;
- duplicate snapshot/observer ordering code;
- projection-writer lifecycle from `AppRunManager`.

### B. `chat_stream`

#### Remove the streaming atom

Delete `isStreamingByIdAtom` after migrating all consumers.

Provide pure selectors:

- `selectIsStreamActive(state)`;
- `selectCanSubmitImmediately(state)`;
- `selectCanCancel(state)`;
- `selectStreamError(state)`.

React components that render one chat use a keyed machine selector. Tab-list
rows subscribe per chat rather than reading a global map. If measurement shows
that this creates unacceptable subscription overhead, add a manager-owned
read-only active-chat index; do not restore a writable atom.

#### Migrate imperative consumers

- `resyncChat` receives a `ChatStreamStatusFacade`;
- `plan_handoff` receives the same facade and subscribes to the target chat;
- queue dispatch consults the controller snapshot, not the streaming atom;
- tests and hybrid harnesses drive the manager/controller rather than writing
  `isStreamingByIdAtom` directly.

#### Clarify retained Jotai state

Retain, with documented ownership:

- `chatMessagesByIdAtom` for optimistic/streaming renderer messages;
- `streamingPreviewByChatIdAtom` for high-frequency partial content;
- editable/persisted queued message data if the queue remains a user-editable
  renderer model;
- `queuePausedByIdAtom` only if pause is intentionally queue policy outside
  the stream lifecycle;
- `chatErrorByIdAtom` only for errors not represented by `StreamState`.

For each retained value, add a short ownership comment explaining why it is
not derivable from `StreamState`. Split mixed error state if necessary.

#### Runtime

Migrate the controller transaction loop to `TransactionalDispatcher`, while
retaining the command scheduler that allows long-lived stream work without
blocking event admission.

Preserve:

- globally unique invocation refs;
- registration/cancel races;
- finalize side effects;
- queue ownership and durable follow-up acknowledgement;
- quiescent controller release;
- post-commit `streamFinished` delivery;
- late transport cleanup.

### C. `first_prompt`

- Expand the provider context to expose a reference-stable snapshot source.
- Add `useFirstPrompt()` returning `{ state, projection, send/resume }`.
- Move `projectFirstPromptState` to a pure cached selector without Jotai.
- Migrate `home.tsx`, `TitleBar`, `SetupBanner`, and
  `ProviderSettingsPage` to the hook.
- Delete `firstPromptSagaProjectionWriteAtom`,
  `firstPromptSagaAtom`, its manual subscription, and disposal reset.
- Keep home input, attachments, selected app, and setup-dialog visibility in
  their existing UI owners.
- Migrate controller transaction mechanics after projection removal so any
  behavior regression is bisectable.

### D. `image_generation`

- Keep the manager-owned aggregate `SnapshotStore` because it provides a real
  retained cross-job read model.
- Rename `getProjection`/`subscribeProjection` to
  `getJobsSnapshot`/`subscribeJobs` for clarity.
- Add hooks for all jobs, pending count, and chat-visible jobs using external
  store selectors.
- Migrate the progress dialog, progress button, chat strip/input, and toast
  orchestration to those hooks or direct manager subscriptions.
- Delete `_imageGenerationJobsAtom`, `imageGenerationJobsAtom`,
  `setImageGenerationJobsProjectionAtom`,
  `pendingImageGenerationsCountAtom`, and
  `chatImageGenerationJobsAtom`.
- Retain `dismissedImageGenerationJobIdsAtom` as independent UI state.
- Keep terminal retention policy in the manager and test its reference
  stability.

### E. `version_preview`

- Add an aggregate manager selector for active mutations, derived from keyed
  snapshots.
- Migrate `ChatHeader` from
  `isAnyCheckoutVersionInProgressAtom` to the selector.
- Delete `activeCheckoutCounterAtom` and
  `isAnyCheckoutVersionInProgressAtom`.
- Remove counter increment/decrement from the command adapter.
- Ensure the aggregate includes every mutation phase that previously held the
  counter, including recovery/return flows where appropriate.
- Migrate the custom controller to `TransactionalDispatcher` in a separate PR
  with trace comparison and recovery tests.

### F. `preview_iframe`

- Stop watching `previewRunStateByAppIdAtom`.
- Wire an app-run lifecycle facade at the provider composition root.
- Send `RUNTIME_RESTARTED` with sufficient identity to reject duplicate or
  stale notifications; do not deduplicate only by `startedAt`.
- Route URL changes from committed app-run snapshots/events.
- Make `PreviewIframeState.iframeEpoch` the only iframe replacement/reload
  identity.
- Split preview iframe errors from app-run and sync errors; compose them only
  at the display selector.
- Migrate the controller to `TransactionalDispatcher`.

### G. `plan_handoff`

- Replace `watch-stream-idle`'s Jotai subscription with the injected
  `ChatStreamStatusFacade`.
- The watcher reads the current committed chat snapshot before subscribing,
  subscribes by chat key, and rechecks after subscription to close the
  check/subscribe race.
- Preserve task-scope cleanup when leaving the waiting state.
- Keep plan content in its existing renderer owner; the handoff snapshot
  retains only operation facts required for correctness.
- Migrate the controller to `TransactionalDispatcher` and timer leases.

### H. `screenshot`

- Define a narrow `ScreenshotRequestFacade` with
  `requestCapture(appId, source)`.
- Inject it into `useCommitChanges`, chat-stream command dependencies, and
  other producers.
- Delete `pendingScreenshotAppIdsAtom` and the provider consumer effect.
- Decide request coalescing explicitly in `ScreenshotManager`: replacement,
  queueing, or ignore-by-state must be a transition policy, not an incidental
  `Map` overwrite.
- Preserve app-key disposal and selector-settle watchdog behavior.

### I. `github_ops`

- Preserve `useGithubOps` and `projectGithubOps` as the reference
  projection-free public API.
- Migrate the controller to `TransactionalDispatcher`.
- Remove its hand-written event queue.
- Retain domain-specific command concurrency and conflict-resolution runner
  registration.
- Run capability consistency and branch-inventory integration tests unchanged.

### J. Main-process registries

#### `connection_flow`

- Use `TransactionalDispatcher` for state commit, observers, and timer lease
  cancellation if the commandless derived-effect model can be expressed
  without changing public synchronous claim semantics.
- Represent timeout installation/cancellation with `TimerLeaseScope`.
- Keep provider-specific timeout policy in the registry.
- If synchronous `start`/`claimReturn` results prevent direct dispatcher use,
  extract a small dispatcher-backed core and document the facade boundary.

#### `mcp_oauth`

- Separate state transaction mechanics from resource ownership:
  listener handles, authorization callbacks, waiters, port-close barriers,
  and provider aborts remain in the registry.
- Route state changes through `TransactionalDispatcher`.
- Use task/timer scopes for listeners and timeouts.
- Preserve the port/flow identity registry and late listener-close barriers.
- Add disposal and stale-callback conformance tests before changing structure.

#### `user_input`

The main registry remains authoritative and the renderer remains a
cross-process read model.

In the first cleanup pass:

- rename projection types and comments consistently as a renderer read model;
- retain the single-writer hydration/revision logic;
- retain Jotai if its derived composition materially simplifies consumers;
- exclude it explicitly from the no-projection boundary rule.

In an optional later pass, compare a service-owned `SnapshotStore` plus domain
hooks against the current atoms. Migrate only if it reduces total adapters and
consumer complexity. Atom count alone is not sufficient justification.

## Rollout

Each PR must be independently reviewable and must delete the compatibility
path it replaces. Do not land new hooks while leaving indefinite dual
consumption.

### PR 1 — Ownership inventory and boundary enforcement

- Add the ownership table to repository documentation.
- Add boundary-test rules for new machine lifecycle atoms, atom mailboxes, and
  machine-to-machine imports.
- Allowlist current violations with explicit deletion PR numbers/order.
- Add selector-aware React binding tests.
- No production behavior changes.

### PR 2 — First-prompt projection removal

This is the smallest proof that direct machine hooks can replace a global atom.

- Add `useFirstPrompt`.
- Migrate four consumers.
- Delete both projection atoms and manual synchronization.
- Add provider/hook tests, including StrictMode and disposal.

### PR 3 — Image-generation projection removal

- Add manager projection hooks/selectors.
- Migrate consumers and toast orchestration.
- Delete machine projection atoms.
- Retain and test independent dismissal state.

### PR 4 — Screenshot typed ingress

- Add `ScreenshotRequestFacade`.
- Migrate all producers.
- Delete the mailbox atom and consumer effect.
- Test simultaneous per-app requests and same-app coalescing.

### PR 5 — App-run ownership split

- Add `projectAppRun` and direct hook consumers.
- Split runtime diagnostics from lifecycle state.
- Remove loading, URL, lifecycle error, exit overlap, and reload-token
  projections as resolved by the audit.
- Wire typed app-run events to `preview_iframe`.
- Keep the existing controller runtime for this PR to isolate ownership
  changes.

### PR 6 — App-run transactional migration

- Move `AppRunController` to `TransactionalDispatcher`.
- Remove custom FIFO/commit plumbing and projection writer.
- Run controller conformance plus stale-output, external lifecycle, and
  disposal tests.

### PR 7 — Chat-stream direct status API

- Add per-chat selectors/facade.
- Migrate React and imperative consumers.
- Delete `isStreamingByIdAtom`.
- Update hybrid fixtures to drive the real manager boundary.
- Preserve the existing controller runtime for bisection.

### PR 8 — Plan-handoff and chat-stream transactional migrations

- Replace stream-idle atom watching with the facade.
- Migrate both custom controller loops.
- Preserve durable follow-up acknowledgement and post-commit completion
  notification.
- Run co-simulation and integration suites for submit/cancel/queue/handoff
  races.

### PR 9 — Version-preview aggregate cleanup

- Replace the global checkout counter with a manager selector.
- Delete the atoms and adapter counter writes.
- Test concurrent per-app mutations and controller disposal.

### PR 10 — Remaining renderer controller migrations

Use separate commits, and split into multiple PRs if review size grows:

1. `github_ops`;
2. `preview_iframe`;
3. `version_preview`.

Each migration requires before/after trace comparison and controller
conformance.

### PR 11 — Main-process registry consolidation

Prefer separate PRs per registry:

1. `connection_flow`;
2. `mcp_oauth`;
3. `user_input` runtime mechanics only if the dispatcher fits its synchronous
   registry contract.

Resource ownership and cross-process protocols receive focused tests rather
than a mechanical bulk conversion.

### PR 12 — Remove compatibility infrastructure

After all same-process writers are gone:

- delete unused `registerAtomWriter`/`projectToAtom` code if only the
  allowlisted cross-process projection no longer needs it;
- otherwise move the helpers next to the cross-process projection and narrow
  their names;
- remove all temporary boundary-test allowlist entries;
- update `rules/state-machines.md`, `rules/jotai-state.md`, and
  `docs/why-state-machines.md`;
- add a repository test asserting that no lifecycle atom names from this plan
  return.

## Verification strategy

### Pure transition tests

Every domain continues to run:

- reachable state/event exploration;
- state and command inventory checks;
- ignored-event reference identity checks;
- capability/transition consistency where interactive actions exist;
- stale invocation tests.

Projection removal must not require transition changes unless the old
projection exposed a missing domain fact. Such a change is isolated and
reviewed as behavior, not folded into a mechanical consumer migration.

### Controller conformance

Every migrated controller runs `runControllerConformanceSuite`, covering:

- observer/subscriber/command re-entrancy;
- commit-before-notify ordering;
- synchronous throws and async rejections;
- disposal during commands;
- late emissions after disposal;
- recreate-after-dispose with stale callbacks;
- final cleanup and idempotent disposal.

### Renderer tests

For each deleted atom:

- test the replacement hook under a test-owned manager;
- assert unrelated entity transitions do not rerender keyed consumers;
- assert selectors update synchronously after committed transitions;
- test provider replacement and StrictMode replay;
- test deletion cleanup.

Do not mock Jotai to simulate machine lifecycle after the migration.

### Integration tests

Required scenarios:

- app run/restart/stop updates toolbar, iframe, URL, errors, and exit display
  from one committed snapshot path;
- proxy URL before/after IPC settlement;
- stale proxy/exit output after controller replacement;
- chat double-submit queues rather than drops;
- cancel before and after stream registration;
- stream completion wakes plan handoff without an atom edge;
- screenshot requests from chat completion and explicit commit;
- simultaneous image-generation jobs and terminal retention;
- simultaneous version mutations across apps;
- provider setup resumes first prompt without projection atoms.

Use the renderer+IPC integration harness where possible. Use Playwright only
for behavior requiring the real iframe, Electron output subscription, or
browser interaction. Rebuild before E2E runs.

### Performance checks

Projection removal must not replace one global atom rerender with broad
provider rerenders.

Measure or assert:

- keyed subscribers are notified only for their entity;
- high-frequency stream chunks do not rerender lifecycle-only consumers;
- console appends do not rerender app-run controls;
- aggregate indexes reuse their reference when their selected value is
  unchanged;
- controller retention remains bounded.

## Migration rules

1. Consumer migration precedes projection deletion within the same PR.
2. A compatibility projection has exactly one writer until deletion.
3. Do not add new writes to a projection scheduled for removal.
4. Do not make a formerly read-only projection writable to ease migration.
5. Cross-machine adapters are injected; machine modules never import each
   other's owners.
6. When replacing an atom edge with a subscription, close the
   read-before-subscribe race by checking before and immediately after
   subscription.
7. One-shot events run only after the authoritative snapshot commit.
8. Preserve operation identity through new facade events.
9. UI forms clear or close only on authoritative settlement.
10. Every removed keyed atom has an explicit entity-deletion and provider
    disposal replacement.
11. Do not mix controller-runtime migration with domain behavior changes
    unless the old mechanics make separation impossible.
12. Any retained lifecycle-like atom must be justified in the ownership table
    and boundary allowlist.

## Risks and mitigations

### Broader React subscriptions

Direct external-store subscriptions could rerender more components than
fine-grained atoms.

Mitigation: selector-aware keyed hooks, scalar selectors, equality tests, and
keeping high-frequency content outside lifecycle snapshots.

### Lost aggregate visibility

Deleting global maps can make “any entity active?” queries harder.

Mitigation: add manager-owned, read-only aggregate indexes only for actual
consumers. Test reference stability and cleanup.

### Cross-machine timing changes

Replacing atom observation with direct events can change callback ordering.

Mitigation: specify post-commit delivery, carry invocation identity, and test
re-entrant sends. Do not emit lifecycle events from command side effects when
the transition itself is authoritative.

### Mixed error sources

Splitting `previewErrorByAppIdAtom` may change precedence between app-run,
iframe, client, and sync errors.

Mitigation: inventory current precedence and encode it in one pure display
selector with table-driven tests before storage changes.

### Controller migration regressions

Custom runtimes may contain undocumented scheduling behavior.

Mitigation: capture before/after traces, characterize scheduler concurrency,
run conformance, and migrate one high-blast-radius controller per PR.

### Test harness dependence on writable atoms

Several tests currently set lifecycle atoms directly.

Mitigation: introduce small test manager drivers and event fixtures. Tests
should exercise the same authority boundary as production.

## Success criteria

The cleanup is complete when:

- no same-process machine lifecycle is mirrored into Jotai;
- `app_run` UI URL/loading/error state comes from its committed snapshot;
- `isStreamingByIdAtom`, the first-prompt projection atoms, image-generation
  projection atoms, screenshot mailbox atom, and version checkout counter are
  deleted;
- cross-machine coordination uses typed injected facades/events;
- every renderer controller uses `TransactionalDispatcher`;
- every remaining custom main-process registry has a documented resource or
  synchronous-contract reason and uses shared transaction/lease primitives
  where possible;
- providers own lifecycle but do not synchronize machine snapshots into
  atoms;
- aggregate views are read-only manager projections with bounded retention;
- boundary tests prevent reintroduction of lifecycle atoms and atom
  mailboxes;
- no UI regression occurs in run/restart, chat queue/cancel, plan handoff,
  image generation, screenshot capture, version preview, OAuth, or user-input
  flows;
- `rules/state-machines.md`, `rules/jotai-state.md`, and
  `docs/why-state-machines.md` describe the implemented architecture rather
  than the transitional one.

## Expected outcome

The number of pure transitions and domain states will not necessarily shrink;
they encode real workflow complexity. The surrounding code should shrink
materially:

- fewer writable atoms and setters;
- no projection-writer lifecycle in renderer managers;
- fewer manual subscriptions and edge-detection effects;
- fewer hand-written controller queues;
- clearer domain hooks;
- explicit cross-machine dependencies;
- one place to answer each lifecycle question.

The desired review experience is that a contributor can determine:

1. where a lifecycle fact is stored;
2. which transition changes it;
3. which selector exposes it;
4. which command performs its effects;
5. which typed facade connects another machine;

without searching for a second atom, counter, ref, or effect that must agree.
