# Distributed Machine Runtime

## Status

Alternative architecture proposal.

This plan is an alternative to completing the full rollout in
`plans/codex-cleanup-state-machines.md`. It keeps the no-regrets ownership,
selector, and simple projection-removal work from that plan, but replaces the
later controller-by-controller cleanup with a shared actor runtime capable of
hosting authoritative state machines in either Electron's main process or the
renderer.

The filename intentionally matches the requested
`plans/distrbuted-machines.md`. The architecture and code should use the
correct term “distributed.”

## Summary

Dyad currently has several related but distinct state-machine architectures:

- renderer-owned controllers and managers;
- main-process registries;
- Jotai projections of renderer machine state;
- IPC projections of main machine state;
- typed facades for some cross-machine calls;
- atoms used as status buses or mailboxes for other cross-machine calls;
- domain-specific hydration, subscriptions, operation registries, and
  disposal.

The proposed runtime unifies these under one actor model:

```text
                          one authoritative actor
                                     |
              +----------------------+----------------------+
              |                                             |
       local typed ActorRef                         remote typed ActorRef
              |                                             |
              v                                             v
    TransactionalDispatcher                      validated IPC transport
              |                                             |
              +----------------------+----------------------+
                                     |
                         committed immutable snapshot
                                     |
                          pure selectors / events
                                     |
                     React hooks or another actor facade
```

Every actor has exactly one authoritative host. “Distributed” means that the
typed reference, snapshot subscription, tracing, and protocol contracts work
across process boundaries. It does not mean shared memory, multi-primary
replication, or transparent synchronous calls across IPC.

The first remote pilot is `app_run`, hosted in the main process because the
main process owns the child process, stdout producer, and teardown. The first
local pilot is `voice_to_text`, hosted in the renderer because it owns browser
media resources. Together they must prove that host location is an adapter
rather than a second controller architecture.

## Why pursue this instead of only cleaning up the existing layer?

The incremental cleanup plan would improve the current design, but it would
retain a structural distinction between:

- main registries and renderer controllers;
- local hooks and remote IPC projections;
- process-owned resources and renderer-owned lifecycle;
- ordinary machine messages and cross-machine handoffs.

That distinction causes much of the current boilerplate. `app_run` is the
clearest example: the renderer owns lifecycle state while the main process
owns the process whose lifecycle is being modeled. Producer correlation,
renderer disposal, projection atoms, and IPC settlement all compensate for
that separation.

A distributed runtime can move authority next to the resource while exposing
the same read/send API to React. If successful, it removes entire classes of
code instead of only standardizing them.

This is worthwhile only if the framework replaces existing infrastructure.
Adding it underneath the current controllers, managers, projections, and IPC
adapters without deleting them would make the architecture worse.

## Design principles

### 1. One authoritative host

Every actor instance is authoritative in exactly one process:

- `main`: privileged work, durable workflows, child processes, filesystem,
  git, OAuth listeners, or workflows that should survive renderer reload;
- `renderer`: DOM, iframe, browser media, and presentation workflows tied to
  one renderer lifetime.

There is no bidirectional writable replication.

### 2. Pure domain logic remains portable

The existing shape remains:

- `state.ts`: TypeScript domain types;
- `transition.ts`: pure total transition;
- `commands.ts`: command data and adapters;
- `machine.ts` or `definition.ts`: runtime definition and placement metadata;
- `transport.ts`: Zod wire codecs for remotely visible keys, events,
  snapshots, and receipts;
- `hooks.ts`: renderer bindings.

`state.ts` and `transition.ts` do not import Electron, React, Jotai, IPC,
Zod, timers, `Date`, or another machine.

### 3. Location is explicit

Remote calls must not masquerade as synchronous local calls.

```ts
const actor = useDistributedMachine(appRunMachine, appId);

const receipt = await actor.dispatch({
  type: "RESTART_REQUESTED",
  options,
});
```

The API and types distinguish local synchronous enqueue from remote committed
dispatch. A caller can always determine whether failure means:

- transport rejected;
- event rejected before transition;
- event deliberately ignored;
- state committed;
- command failed later;
- durable receiver acceptance failed.

### 4. Commit is not completion

The generic transport acknowledges only event admission and state commit.
Long-running command completion remains domain state/events.

The runtime does not offer a misleading generic `dispatchAndWaitForEffects`.
A domain may provide a typed waiter facade correlated to an invocation when
the workflow genuinely requires it.

### 5. Security is part of the machine definition

A generic machine channel is not permission to dispatch arbitrary events.

The main host:

- registers only a static allowlist of remote machine definitions;
- validates the machine ID, entity key, event, and expected actor identity;
- uses the existing trusted-main-frame IPC handler boundary;
- checks entity ownership/authorization before dispatch;
- never accepts serialized commands from the renderer;
- never dynamically imports a machine named by renderer input.

### 6. Distributed failures are modeled, not hidden

Renderer reload, window destruction, main shutdown, hydration races, duplicate
messages, stale snapshots, and version mismatch are first-class contracts.

### 7. Presentation stays responsive

High-volume content such as console logs and LLM chunks does not travel as
whole machine snapshots. Existing batched or streaming IPC channels remain
appropriate. Machines own lifecycle and correlation, not every byte of
runtime output.

### 8. The framework stays small

The runtime standardizes:

- actor identity and keyed hosting;
- event transaction mechanics;
- local/remote references;
- validated transport;
- snapshot revisioning and subscriptions;
- lifecycle, hydration, and tracing;
- optional persistence and durable protocols.

It does not standardize:

- domain state shapes;
- concurrency policy;
- stale-event policy;
- command semantics;
- UI composition;
- database schemas;
- provider/backend behavior.

## Terminology

### Machine definition

Pure transition plus runtime metadata, codecs, command scheduler factory, and
host placement.

### Actor

One live keyed instance of a machine definition.

### Actor key

Stable domain key such as `appId`, `chatId`, provider, or OAuth port.

### Actor instance ID

Globally unique identity for one actor lifetime. Recreating the same machine
and key produces a new actor instance ID.

### Actor reference

Typed capability for reading and sending to one actor. It may be local or
remote.

### Snapshot revision

Monotonically increasing revision within one actor instance when the committed
snapshot reference changes. It orders remote snapshot delivery but is not a
globally unique operation identity.

### Transaction sequence

Monotonically increasing sequence for every processed event, including
command-only applied events and ignored events. It orders receipts and traces
without forcing a value-equal snapshot publication.

### Invocation reference

Identity for one domain operation within or across actor lifetimes. It remains
separate from actor identity and message identity.

### Message ID

Transport identity used to deduplicate one remote dispatch.

### Idempotency key

Durable domain identity used when a receiver must deduplicate acceptance
across retries or process restarts. A message ID is not automatically an
idempotency key.

## Proposed module structure

```text
src/distributed_machines/
  definition.ts
  actor_host.ts
  actor_ref.ts
  local_actor_ref.ts
  remote_actor_ref.ts
  registry.ts
  transport_types.ts
  remote_snapshot_store.ts
  persistence.ts
  protocol.ts
  tracing.ts
  react.ts
  testing/
    fake_transport.ts
    host_conformance.ts
    remote_conformance.ts
    crash_harness.ts

src/ipc/types/distributed_machines.ts
src/ipc/handlers/distributed_machine_handlers.ts
src/ipc/services/distributed_machine_host.ts
```

The existing primitives under `src/state_machines/` remain the pure/runtime
kernel. The distributed layer composes them; it does not duplicate
`TransactionalDispatcher`, `SnapshotStore`, `TaskScope`, timer leases,
invocation references, trace buffers, or transition test utilities.

If the pilots show that “distributed machines” are the normal form, the
folders may later be consolidated. Do not move existing files during the
pilot merely for naming symmetry.

## Machine definition API

The exact API should be proven by pilots, but it should express the following
contracts:

```ts
interface DistributedMachineDefinition<
  Id extends string,
  Key,
  State,
  Event,
  Command,
  Reason extends string,
> {
  readonly id: Id;
  readonly host: "main" | "renderer";
  readonly initialState: (key: Key) => State;
  readonly transition: (
    state: State,
    event: Event,
  ) => TransitionResult<State, Command, Reason>;
  readonly createScheduler: (key: Key) => CommandScheduler<Command>;
  readonly createCommandRunner: (
    context: MachineHostContext<Key, State, Event>,
  ) => CommandRunner<Command, Event>;
  readonly lifecycle: ActorLifecyclePolicy<Key, State>;
  readonly persistence?: MachinePersistencePolicy<Key, State>;
  readonly remote?: RemoteMachineContract<Key, State, Event>;
}
```

Important constraints:

- host placement is static for a shipped application version;
- command runners are constructed only in the host process;
- remote contracts are required only when another process needs access;
- state/event wire codecs live outside pure domain files;
- a renderer-hosted actor can use the same local reference API without
  defining remote codecs;
- definitions are registered explicitly at a composition root.

Avoid elaborate type-level inference in the first implementation. Clear
generic annotations and useful compiler errors are more valuable than a
clever DSL.

## Actor host

`ActorHost` owns keyed actors for one process:

```ts
interface ActorHost {
  register(definition: DistributedMachineDefinition<...>): void;
  ensure(machineId: string, key: unknown): HostedActor;
  peek(machineId: string, key: unknown): HostedActor | undefined;
  disposeKey(machineId: string, key: unknown): void;
  disposeMachine(machineId: string): void;
  dispose(): Promise<void>;
}
```

Each hosted actor owns:

- actor instance ID;
- snapshot revision;
- transaction sequence;
- `TransactionalDispatcher`;
- command scheduler/runner;
- task and timer scopes;
- invocation registry where required;
- subscriber set;
- optional persistence adapter;
- bounded traces;
- final disposal barrier.

### Event transaction

For one admitted event:

1. validate the event at the transport boundary if remote;
2. deduplicate the message envelope;
3. append to the actor FIFO;
4. run the pure transition exactly once;
5. validate the result;
6. reserve the command batch;
7. cancel exiting state-owned leases;
8. commit the snapshot;
9. increment the snapshot revision only if the snapshot reference changed;
10. notify local snapshot subscribers only if the snapshot changed;
11. publish a remote snapshot envelope only if the snapshot changed;
12. notify trace/transition observers;
13. start the reserved command batch;
14. resolve the remote dispatch receipt;
15. process re-entrant events afterward.

The receipt resolves after commit and publication has been scheduled, not
after commands finish.

Ignored events:

- retain the exact snapshot reference and revision;
- receive a transaction sequence for receipts/traces;
- run no commands;
- emit ignored-event traces;
- return an ignored receipt with the stable domain reason.

Applied command-only transitions also retain the snapshot revision and publish
no snapshot. Their receipt records the new transaction sequence and current
snapshot revision.

### Dispatch tickets

The existing `TransactionalDispatcher.send()` returns `void`. Remote dispatch
requires an outcome for the exact queued event, including an event enqueued
re-entrantly while another transaction is processing.

Extend the dispatcher with a ticketed API:

```ts
interface DispatchTicket<State, Reason> {
  readonly settled: Promise<
    | {
        kind: "applied";
        state: State;
      }
    | {
        kind: "ignored";
        state: State;
        reason: Reason;
      }
    | {
        kind: "failed";
        stage: "transition" | "validation" | "before-admission";
        error: unknown;
      }
    | {
        kind: "disposed";
      }
  >;
}

dispatcher.enqueue(event): DispatchTicket<State, Reason>;
```

Requirements:

- the pending FIFO stores event/ticket entries, not domain wrapper events;
- a re-entrant enqueue returns immediately and settles after its own FIFO turn;
- ordinary `send(event)` remains a compatibility wrapper that intentionally
  discards the ticket;
- transition/validation failure settles the corresponding ticket and does not
  wedge later entries;
- disposal settles every unprocessed ticket as disposed;
- scheduler or command failure after commit does not rewrite the settled
  applied ticket;
- ticket settlement happens after observer notification and scheduler handoff,
  matching the dispatcher transaction contract.

The actor host converts the dispatcher ticket into a transport receipt. Do not
infer outcomes by comparing snapshots or listening to global observers.

### Scheduler policy

The host delegates scheduling to the definition. Supported reusable
schedulers may include:

- serial batch scheduler;
- concurrent batch scheduler;
- detached command scheduler;
- keyed/operation-scoped scheduler.

The runtime does not select one based on command shape.

### Lifecycle policy

Definitions state:

- whether subscription creates an actor;
- whether dispatch creates an actor;
- idle eviction policy;
- terminal retention;
- entity-deletion behavior;
- renderer/window ownership;
- shutdown flush requirements;
- whether the actor survives renderer reload;
- whether state survives application restart.

Actor disposal:

1. stops event admission;
2. settles or rejects domain waiters;
3. publishes any declared terminal projection;
4. cancels tasks/timers/resources;
5. flushes persistence where required;
6. removes subscriptions;
7. disposes the dispatcher.

## Local actor references

A local reference is a thin typed facade over the host:

```ts
interface LocalActorRef<State, Event> {
  readonly kind: "local";
  getSnapshot(): State;
  subscribe(listener: () => void): () => void;
  send(event: Event): void;
}
```

Local sends preserve the synchronous enqueue behavior of
`TransactionalDispatcher`. Domain APIs may wrap `send` with waiters where
needed.

Renderer hooks use `useSyncExternalStore` and pure selectors. They do not copy
snapshots into Jotai.

## Remote actor transport

### Contract integration

Add contracts through the existing IPC architecture:

- `defineContract` for subscribe/bootstrap, dispatch, and unsubscribe;
- `defineEvent` for snapshot and actor-disposed broadcasts;
- `createTypedHandler` for all main handlers;
- preload allowlisting derived from the contracts.

Do not call `ipcMain.handle` directly.

The generic envelope is validated twice:

1. the outer IPC Zod contract validates the protocol envelope;
2. the registered machine's codecs validate its key, event, and snapshot.

This preserves a static channel surface without treating inner payloads as
trusted `unknown`.

### Static manifest

Remote definitions are assembled into a main-owned manifest:

```ts
const remoteMachineManifest = createRemoteMachineManifest([
  appRunMachine,
  githubOpsMachine,
]);
```

The manifest:

- rejects duplicate machine IDs;
- contains key/event/snapshot codecs;
- contains authorization policy;
- maps IDs to already-constructed host definitions;
- is the only router target.

The renderer receives generated/inferred typed clients by importing the shared
definition contract. It cannot register new main-hosted machines.

### Dispatch envelope

```ts
interface MachineDispatchEnvelope {
  protocolVersion: number;
  machineId: string;
  encodedKey: unknown;
  expectedActorInstanceId?: string;
  messageId: string;
  causationId?: string;
  correlationId?: string;
  expectedRevision?: number;
  encodedEvent: unknown;
}
```

Semantics:

- `expectedActorInstanceId` prevents a stale renderer from addressing a
  replacement actor;
- `expectedRevision` is optional optimistic concurrency, not required for
  ordinary events;
- `messageId` deduplicates retry of one transport send within the configured
  retention window;
- `correlationId` connects traces and domain waiters;
- `causationId` reconstructs event chains;
- domain invocation refs remain inside typed events where correctness needs
  them.

### Dispatch receipt

```ts
type MachineDispatchReceipt<Reason> =
  | {
      kind: "applied";
      actorInstanceId: string;
      revision: number;
      transactionSequence: number;
      messageId: string;
    }
  | {
      kind: "ignored";
      actorInstanceId: string;
      revision: number;
      transactionSequence: number;
      messageId: string;
      reason: Reason;
    }
  | {
      kind: "rejected";
      messageId: string;
      reason:
        | "unknown-machine"
        | "invalid-key"
        | "invalid-event"
        | "unauthorized"
        | "stale-actor"
        | "revision-conflict"
        | "host-disposing"
        | "protocol-version";
    };
```

Expected user/environment failures crossing the main boundary use
`DyadError`/`DyadErrorKind` where the existing IPC error path is more
appropriate. Domain-level ignored events remain successful receipts, not
exceptions.

Unexpected transition, validation, scheduler, or command failures are reported
as programming errors. A command failure does not retroactively change an
already-applied receipt.

## Remote snapshot protocol

### Snapshot envelope

```ts
interface MachineSnapshotEnvelope {
  protocolVersion: number;
  machineId: string;
  encodedKey: unknown;
  actorInstanceId: string;
  revision: number;
  encodedState: unknown;
}
```

Snapshots are immutable, schema-versioned, and validated on both sides.
`revision` changes only when the snapshot changes; transaction-only sequencing
is carried by receipts and traces rather than snapshot envelopes.

### Atomic subscribe/bootstrap

The main handler must:

1. validate and authorize the subscription;
2. synchronously register the `webContents` subscriber;
3. obtain the current actor snapshot and revision;
4. return the bootstrap envelope.

There must be no `await` between subscriber registration and snapshot capture.

Broadcasts can arrive before the invoke promise resolves. The renderer remote
store buffers them and applies envelopes monotonically after bootstrap:

- a newer actor instance replaces an explicitly superseded instance;
- within one actor instance, only increasing revisions apply;
- duplicate revisions are ignored;
- a revision gap triggers resynchronization rather than speculative merge;
- an envelope for an old actor instance is ignored;
- buffered entries are bounded.

### Unsubscribe and window cleanup

- Renderer unmount unsubscribes through the transport.
- Main automatically removes every subscription on `webContents.destroyed`.
- Unsubscribe is idempotent.
- Lost unsubscribe messages cannot retain a destroyed window.
- Subscription ownership is per `webContents`, machine, and encoded key.
- Multiple components in one renderer are reference-counted by the renderer
  remote store so they do not create duplicate IPC subscriptions.

### Actor disposal notification

Main publishes a typed disposed envelope containing the actor instance ID and
final revision. The remote store transitions to the definition's unavailable
or initial view and must not accept a late snapshot from the disposed actor.

## Remote snapshot store and React API

One renderer-owned `RemoteMachineClient` manages remote stores:

```ts
interface RemoteActorRef<State, Event, Reason> {
  readonly kind: "remote";
  getStatus(): "connecting" | "ready" | "disconnected" | "incompatible";
  getSnapshot(): State;
  subscribe(listener: () => void): () => void;
  dispatch(event: Event): Promise<MachineDispatchReceipt<Reason>>;
  resync(): Promise<void>;
}
```

The React hook exposes transport status explicitly:

```ts
const { state, projection, connection, dispatch } = useDistributedMachine(
  appRunMachine,
  appId,
);
```

Rules:

- `state` is never silently fabricated as current authoritative state while
  disconnected;
- definitions choose an initial/unavailable view;
- UI capabilities account for connection status;
- selectors are pure and reference-stable;
- remote snapshots are not copied into Jotai;
- transport errors are distinct from domain operation errors;
- reconnect automatically resubscribes and bootstraps;
- pending dispatch promises reject or resolve with a transport-specific result
  when the renderer is destroyed.

## Serialization and wire compatibility

Moving an existing renderer machine to main requires a serializability audit.

Snapshots/events may not contain:

- callbacks;
- React objects;
- DOM nodes;
- Jotai stores;
- query clients;
- `AbortController` or resource handles;
- unencoded `Map`, `Set`, `Error`, class instances, or platform objects.

Wire codecs may deliberately encode supported domain values, but JSON
stringification is not the implicit contract.

### Versioning

Each remote machine contract has:

- protocol version;
- state schema version;
- event schema version;
- optional migration for persisted state;
- persisted-state compatibility policy across an app update.

CORRECTION (2026-07-25, see plans/cleanup-state-machines.md Phase D): main
and renderer ALWAYS ship together in production — dyad updates via
update-electron-app/Squirrel, applied on restart; renderer reloads load
the running bundle. Live-IPC version skew is dev-only (HMR). Schema
versioning below applies to persisted state; for live transport a
version assert (reject + reload) suffices. On incompatibility:

- reject dispatch before transition;
- stop applying snapshots;
- report a clear recoverable renderer status;
- request a full renderer reload when appropriate;
- never coerce unknown events or states.

### Persisted-operation update compatibility

Persisted work crossing an application update retains or migrates its complete
invocation and idempotency identity. Missing identity is never accepted for
cancellation or state-sensitive intent. Each domain either reconstructs
identity through a documented structural claim during migration, explicitly
reconciles or terminates legacy work, or rejects it with a recoverable
incompatibility result.

The framework must not invent a universal “accept missing identity” rule.

## Commands and execution location

Commands execute beside the authoritative actor by default.

For main-hosted actors:

- filesystem, git, process, database, and privileged IPC work runs in main;
- command adapters call services directly instead of invoking main through
  renderer IPC;
- renderer presentation observes snapshots or typed presentation events.

For renderer-hosted actors:

- DOM, media, and iframe effects run in renderer;
- privileged operations use ordinary contract-driven IPC through the command
  adapter.

The first version does not support arbitrary commands marked
`execution: "main" | "renderer"`. Split-location command routing would create
a second distributed workflow with its own failure and acknowledgement
semantics. Add it only after a real pilot proves snapshots/events cannot model
the need.

### Presentation events

Toasts, navigation, focus, and other one-shot UI effects cannot always be
derived safely from retained state. Main-hosted actors may publish typed,
correlated presentation events after commit.

Requirements:

- events are live-only unless explicitly persisted;
- duplicate suppression uses event identity;
- events identify the actor instance and causative revision;
- missing a presentation event never corrupts domain state;
- critical user decisions are protocols, not presentation events.

## Actor-to-actor communication

### Ordinary messages

An actor receives a typed facade/reference through its command adapter or
composition root. It never imports another actor's host, manager, or registry.

If both actors are in the same process, the facade dispatches locally. If they
are in different processes, it uses the same validated transport.

The dependency graph remains explicit and acyclic for ordinary command
dependencies.

### Durable protocol actors

Cross-machine work requiring acknowledgement is not an ordinary message.

Examples:

- `user_input -> chat_stream` follow-up;
- plan handoff into a new implementation turn;
- any workflow that must survive renderer or application restart.

Use a protocol actor with states such as:

```text
created
  -> awaiting-receiver-acceptance
  -> durably-accepted
  -> executing
  -> acknowledged
  -> settled

created/awaiting/executing
  -> cancelling
  -> rejected or settled
```

The protocol definition names:

- durable owner;
- record schema and version;
- idempotency key;
- acceptance transaction;
- retry schedule;
- cancellation semantics before/after acceptance;
- receiver deduplication;
- acknowledgement point;
- crash/reload recovery;
- retention and pruning.

The actor transport provides message delivery; it does not claim exactly-once
execution.

## Persistence and recovery

Persistence is optional per definition.

```ts
interface MachinePersistencePolicy<Key, State> {
  load(key: Key): Promise<PersistedSnapshot<State> | undefined>;
  save(key: Key, snapshot: PersistedSnapshot<State>): Promise<void>;
  delete(key: Key): Promise<void>;
  flushOnShutdown: boolean;
}
```

### Hydration state

The host does not accept domain events against an unhydrated persisted actor
unless the definition explicitly defines buffering/merge semantics.

The runtime tracks:

- absent;
- hydrating;
- ready;
- hydration-failed;
- disposing.

This runtime status is not silently inserted into the domain state union.
Definitions may model a domain-visible recovery state when the UI needs it.

Events arriving during hydration are:

- buffered FIFO with a strict bound;
- rejected; or
- handled by a domain-defined merge policy.

The definition must choose.

### Save semantics

- Commit remains the in-memory linearization point for ephemeral actors.
- Durable protocols define a database acceptance transaction as their
  authoritative linearization point.
- Debounced snapshot persistence is never described as durable acceptance.
- Shutdown flush has a hard timeout and reports failures.
- Main shutdown follows Electron's `before-quit` re-entry rules.

### Crash behavior

The plan must document separately:

- renderer reload;
- renderer crash/window destruction;
- main process/application crash;
- operating-system termination;
- application update between versions.

Main-hosted ephemeral actors survive renderer reload but not main crash.
Persisted actors recover only to the last committed durable snapshot/protocol
record.

## Security model

### Trusted sender

All invoke handlers use the existing trusted-main-frame enforcement. Machine
transport does not accept messages from arbitrary frames or webviews.

### Definition allowlist

Only definitions registered in the main manifest are remotely addressable.
Machine IDs are constants, not paths or module names.

### Event allowlist

Each definition's Zod event codec is the event allowlist. Avoid a schema such
as `{ type: string, payload: unknown }`.

### Entity authorization

Definitions provide an authorization function where the key or event scopes
access:

```ts
authorizeDispatch({
  sender,
  key,
  event,
  currentState,
}): void | Promise<void>;
```

Authorization occurs before transition and before actor creation where
possible. A renderer-supplied app ID never grants access by itself.

### Commands are never transported from renderer

The main derives commands only from its registered pure transition. The
renderer cannot submit serialized commands, scheduler choices, state, or
transition functions.

### Snapshot projection

Remote codecs explicitly project renderer-visible state. Main-only secrets,
tokens, resource handles, paths, or large internal payloads are not exposed
merely because they exist in the host snapshot.

When remote state is a safe subset, distinguish:

- authoritative host state;
- remote snapshot/read-model state.

The read model remains revisioned and single-writer, but it need not serialize
the complete host state.

### Resource limits

Bound:

- dispatch envelope size;
- pending messages per actor;
- deduplication retention;
- remote snapshot size;
- buffered pre-bootstrap snapshots;
- subscriptions per window;
- actors created only by subscriptions;
- trace payloads and per-key metadata.

## Observability

Every transition trace includes:

- process/host;
- machine ID;
- encoded safe entity key;
- actor instance ID;
- actor revision;
- message ID;
- correlation and causation IDs;
- event description;
- applied/ignored classification;
- command descriptions;
- transport latency for remote dispatch;
- command errors;
- persistence status when relevant.

### Cross-process ordering

A single wall-clock timestamp is not a causal order. Use:

- per-host monotonic trace sequence;
- actor revision;
- causation/correlation IDs;
- message send/receive trace pairs.

Debug tooling reconstructs causal chains without pretending to create a total
order across independent actors.

### Redaction

Machine definitions provide safe event/state descriptions. Raw untagged
objects are never retained in production traces. Replay traces remain
dev/test-only and use explicit serializers/redactors.

### Debug surface

Extend the dev-only machine inspector to show:

- actor host process;
- actor instance and revision;
- connection/hydration status;
- subscribers;
- pending command batches;
- task/timer resources;
- last transport receipt;
- trace chain.

Do not expose this surface in production.

## Testing architecture

### Definition tests

Existing transition requirements remain:

- total state/event handling;
- reference-stable ignored transitions;
- reachable-state and producible-command inventories;
- capability consistency;
- deterministic fake clocks and IDs;
- co-simulation for interacting workflows.

### Local host conformance

For every actor host:

- re-entrant subscriber, observer, and command emissions;
- scheduler throws/rejections;
- actor disposal during command execution;
- late event after disposal;
- key disposal/recreation;
- stale actor instance rejection;
- timer/resource cleanup;
- bounded idle eviction.

### Transport conformance

Use an in-memory fake duplex transport to test:

- duplicate dispatch delivery;
- dropped receipt after committed dispatch and retry;
- snapshots arriving before bootstrap;
- duplicate/out-of-order snapshots;
- revision gaps and resync;
- stale actor instance snapshots;
- disconnect during dispatch;
- reconnect and resubscribe;
- renderer destruction without unsubscribe;
- protocol version mismatch;
- malformed keys/events/snapshots;
- unauthorized dispatch;
- command failure after applied receipt.

### Process crash harness

Provide deterministic harnesses that can:

- destroy/recreate a remote client while preserving the main host;
- dispose/recreate a host while preserving queued fake transport messages;
- hydrate persisted actors;
- deliver stale messages from the previous actor lifetime;
- assert pending promise settlement.

### IPC integration tests

Use real contract registration and the handler test harness to verify:

- trusted sender enforcement;
- outer and per-machine Zod validation;
- manifest routing;
- webContents subscription cleanup;
- `DyadError` preservation;
- snapshot projection excludes main-only fields.

### Renderer integration tests

Use test hosts/references rather than writable lifecycle atoms. Verify:

- loading and reconnect UI;
- committed snapshots update selectors;
- unrelated keys do not rerender;
- dispatch receipt versus command completion;
- StrictMode subscription replay;
- provider replacement;
- actor disposal.

### E2E

The app-run pilot requires packaged Electron tests for:

- app continues running through renderer reload;
- renderer rehydrates the current URL/state;
- restart and stop;
- stale stdout/exit from a previous invocation;
- application restart tears down the child process and starts with no
  recovered app-run actor state;
- window close/application quit cleanup.

Build before every E2E run that changes runtime code.

## Pilot 1: main-hosted `app_run`

`app_run` is the proving ground because it currently spans both processes and
contains the most compensating architecture.

### Current ownership problems

- Renderer owns `RunState`.
- Main owns the spawned app process.
- Main emits output carrying partial/legacy invocation identity.
- Renderer commands invoke main and await settlement.
- URL, loading, exit, errors, and reload epochs overlap with Jotai state.
- Renderer disposal tries to reason about main-owned process lifetime.
- `preview_iframe` infers restart through an atom projection.

### Target ownership

Main owns the keyed `app_run` actor and:

- starts/restarts/rebuilds/stops processes;
- binds process output to the actor invocation at producer creation;
- owns active invocation/resource handles;
- applies correlated proxy-ready and exit events directly;
- survives renderer reload;
- disposes on app deletion or application shutdown;
- publishes a safe remote snapshot.

Renderer owns:

- remote actor reference/store;
- pure `AppRunProjection`;
- console output buffer;
- independent UI warnings/diagnostics;
- local `preview_iframe` actor.

### Domain changes

Refine events into intent and producer events:

```ts
type AppRunEvent =
  | { type: "START_REQUESTED"; operationId: string; startedAt: number }
  | {
      type: "RESTART_REQUESTED";
      operationId: string;
      startedAt: number;
      options: RestartOptions;
    }
  | { type: "STOP_REQUESTED"; operationId: string; startedAt: number }
  | { type: "PROCESS_SPAWNED"; invocationRef: AppRunInvocationRef }
  | { type: "PROCESS_FAILED"; invocationRef: AppRunInvocationRef; error: ... }
  | { type: "PROXY_READY"; invocationRef: AppRunInvocationRef; url: RunUrl }
  | { type: "PROCESS_EXITED"; invocationRef: AppRunInvocationRef; ... };
```

The exact transition preserves existing behavior, including proxy-ready before
spawn settlement when that ordering is real.

Callbacks and renderer stores do not enter remote state/events.

### Main command adapter

Move app lifecycle orchestration behind a main service consumed directly by
the actor:

- process start/restart/stop;
- sandbox recreation;
- log clearing;
- producer callback registration;
- external agent lifecycle claims;
- cleanup and cancellation tombstones.

Existing IPC app-run handlers become temporary adapters that dispatch the
actor for legacy callers. The new renderer uses the machine transport.

### Remote read model

Publish only renderer-safe lifecycle fields:

- phase;
- operation;
- started time;
- current URL/mode;
- operation error;
- exit details needed by UI;
- capabilities;
- actor/invocation diagnostic identity where necessary.

Do not include process handles, internal paths, or command runtime data.

### Output channels

Console stdout/stderr continues through the existing batched app-output
channel. Lifecycle-significant producer events enter the main actor before
output broadcasting. Renderer display buffers cannot drive lifecycle.

### `preview_iframe` composition

The renderer composition layer observes committed app-run remote snapshots or
typed post-commit lifecycle events and sends:

- `APP_URL_CHANGED`;
- `RUNTIME_RESTARTED`;
- `RUNTIME_STOPPED` if required.

Carry actor/invocation identity. Do not deduplicate by timestamps or atom map
edges.

### Deletions required for pilot success

The pilot is not complete until it deletes or makes obsolete:

- renderer `AppRunController`;
- renderer `AppRunManager`;
- app-run projection writer;
- machine-owned loading/URL/error Jotai projections;
- renderer-to-main lifecycle command adapter;
- restart inference through `previewRunStateByAppIdAtom`;
- hand-written renderer invocation registry for app-run producer routing.

Retain only independently justified console, warning, and UI state.

### Acceptance scenarios

1. Start an app and receive URL.
2. Proxy URL arrives before process-start settlement.
3. Restart with each options combination.
4. Rebuild through external agent lifecycle.
5. Stop before start settles.
6. Old proxy/exit output arrives after restart.
7. Delete app while start is pending.
8. Reload renderer while app remains ready.
9. Reload renderer while start/restart is pending.
10. Close window while app remains main-owned according to product policy.
11. Quit app and clean up child process with bounded shutdown.
12. Incompatible renderer/main protocol requests reload rather than applying
    malformed state.

## Pilot 2: local renderer-hosted `voice_to_text`

This pilot proves the same definition/actor-reference/React API works without
IPC.

Renderer remains authoritative because it owns:

- `getUserMedia`;
- recorder callbacks;
- media tracks;
- transcription presentation lifecycle.

Requirements:

- use the shared `ActorHost` and local actor reference;
- keep resource handles out of snapshots;
- keep `TransactionalDispatcher`;
- expose the same selector-aware React hook shape as remote actors;
- prove local dispatch stays synchronous where required;
- preserve media cleanup on unmount/disposal;
- add no wire codecs unless another process genuinely needs access.

The pilot should delete domain-specific wrapper boilerplate where the shared
host replaces it. It should not force local events through IPC for symmetry.

## Candidate placement after pilots

This is a hypothesis to validate, not an automatic migration list.

| Domain             | Likely host                        | Reason                                                    |
| ------------------ | ---------------------------------- | --------------------------------------------------------- |
| `app_run`          | Main                               | Owns child processes and producer identity                |
| `connection_flow`  | Main                               | Owns OAuth flow, timeouts, deep-link claims               |
| `mcp_oauth`        | Main                               | Owns loopback listeners and provider exchange             |
| `user_input`       | Main                               | Must survive renderer lifecycle and owns waiters          |
| `github_ops`       | Main                               | Owns privileged git mutation/recovery                     |
| `version_preview`  | Main                               | Owns checkout, branch recovery, filesystem effects        |
| `chat_stream`      | Main, pending study                | Main already owns stream admission and durable acceptance |
| `plan_handoff`     | Main/durable, pending study        | Cross-chat workflow should survive renderer reload        |
| `first_prompt`     | Renderer initially                 | Presentation-heavy; persistence value unclear             |
| `image_generation` | Main if reload survival is desired | Long-running job with IPC-backed execution                |
| `screenshot`       | Renderer                           | Owns iframe capture/DOM readiness                         |
| `preview_iframe`   | Renderer                           | Owns DOM and iframe identity                              |
| `voice_to_text`    | Renderer                           | Owns browser media resources                              |

Before moving any machine:

1. inventory resource ownership;
2. inventory callbacks/nonserializable state;
3. decide renderer-reload and app-restart behavior;
4. specify remote read model;
5. specify high-volume data path;
6. measure deletion value;
7. identify cross-machine dependency changes.

## Chat-stream feasibility study

Do not move `chat_stream` to main merely for consistency. First resolve:

- optimistic renderer messages versus durable accepted messages;
- high-frequency chunk transport;
- editable queued messages;
- renderer callbacks currently embedded in `StreamRequest`;
- main admission barrier and stream controller ownership;
- React Query/Jotai refresh effects;
- user-input durable handoff;
- cancellation and finalization UI;
- renderer reload during an active stream.

A main-hosted chat lifecycle is attractive because main already owns stream
admission and can survive renderer reload, but callbacks and presentation state
must be replaced with IDs, receipts, and read models. Produce a dedicated
design before implementation.

## Relationship to `codex-cleanup-state-machines.md`

### Complete first

These are no-regrets prerequisites:

- ownership inventory and boundary enforcement;
- selector-aware external-store React bindings;
- simple removal of `first_prompt` Jotai projection;
- direct image-generation manager projection, if it does not conflict with a
  decision to move jobs to main;
- classification of UI/runtime versus lifecycle atoms.

### Superseded by this plan

Do not complete these cleanup items before the pilots:

- migrating `app_run` to another renderer controller shape;
- building a final renderer-only app-run hook/projection architecture;
- migrating every custom controller mechanically before host placement is
  decided;
- finalizing bespoke cross-machine facades that actor refs/protocols would
  replace;
- consolidating all main registries around the current registry API.

### Still applicable

The cleanup plan's desired outcomes remain:

- no same-process lifecycle duplication in Jotai;
- typed dependencies;
- pure selectors;
- direct hooks;
- fewer manual subscriptions;
- deletion of atom mailboxes;
- boundary enforcement.

This plan changes how those outcomes are reached.

## Rollout plan

### Phase 0 — Architecture decision and deletion budget

Write an ADR recording:

- one-authority actor model;
- explicit local versus remote semantics;
- no multi-primary replication;
- commit-versus-completion contract;
- generic transport security model;
- persistence boundaries;
- why an actor runtime is preferred over incremental controller cleanup.

For each pilot, list the files/types expected to be deleted. The pilot fails
architecturally if it adds more permanent layers than it removes.

No production code.

### Phase 1 — Definition and local host kernel

Implement:

- minimal machine definition;
- actor instance identity/revision;
- `ActorHost`;
- local actor reference;
- lifecycle policies;
- integration with `TransactionalDispatcher`;
- host conformance suite;
- selector-aware React hooks.

Exercise with synthetic machines only. Do not migrate a production domain in
the kernel PR.

### Phase 2 — Contract-driven remote transport

Implement:

- distributed machine IPC contracts;
- static remote manifest;
- trusted typed handlers;
- outer and per-definition validation;
- dispatch receipts;
- subscribe/bootstrap;
- snapshot/disposed events;
- webContents cleanup;
- fake transport and transport conformance suite;
- bounded deduplication.

Use a test-only machine registered in handler integration tests. Do not expose
arbitrary production machine dispatch yet.

### Phase 3 — Remote client, hydration, and React

Implement:

- `RemoteMachineClient`;
- revisioned remote snapshot stores;
- pre-bootstrap buffering;
- resync on gaps;
- reconnect/disconnect status;
- reference-counted subscriptions;
- remote actor refs;
- selector-aware hooks;
- renderer StrictMode tests.

Prove against fake transport and the test-only IPC machine.

### Phase 4 — App-run main-hosted pilot

Land in reviewable steps while keeping one authority:

1. extract/reuse main app-runtime service boundaries;
2. define app-run wire codecs and safe remote projection;
3. construct the main actor and route producer events;
4. add renderer remote hook behind the application composition boundary;
5. migrate consumers;
6. wire preview iframe from committed remote state/events;
7. remove renderer authority and lifecycle projections;
8. delete temporary legacy adapters.

Avoid running old and new command side effects in parallel. A pure shadow
transition may consume copied events for trace comparison, but it must run no
commands and publish no application state.

### Phase 5 — Voice-to-text local pilot

- adopt the shared definition/host/ref/hook API;
- preserve renderer resource ownership;
- delete redundant local wrapper mechanics;
- compare ergonomics and bundle impact with the remote pilot.

Gate further adoption on a written pilot review.

### Phase 6 — Pilot review and go/no-go

Evaluate:

- net lines/modules deleted;
- reduction in atom projections and IPC glue;
- runtime and type complexity;
- trace/debug quality;
- renderer reload correctness;
- security review findings;
- test runtime;
- contributor comprehensibility;
- bundle size and preload compatibility;
- performance under output load.

Possible decisions:

- proceed unchanged;
- narrow the framework to main-hosted resource actors;
- retain local machines on the existing lightweight controller API;
- stop and revert the framework, keeping only no-regrets cleanup.

### Phase 7 — Resource-owner migrations and registry dispositions

If approved, migrate one ordinary actor domain per PR. The current order and
recorded exceptions are owned by `plans/cleanup-state-machines.md`.

`connection_flow` and `mcp_oauth` are already main-authoritative specialized
resource registries. Audit their renderer consumers before exposing a common
read model; retain their listener, timer, waiter, claim, and close-barrier
internals unless `ActorHost` demonstrably deletes code or fixes a named
deficiency. A documented narrow boundary is an acceptable end state.

Each PR:

- selects the authoritative host;
- defines remote projection if required;
- deletes its previous registry/controller boundary only when that boundary
  was actually replaced;
- retains domain transition tests;
- adds crash/reload tests appropriate to placement.

### Phase 8 — Protocol and long-running workflow migrations

Design separately before implementation:

1. durable protocol actor primitive;
2. `user_input -> chat_stream` proof;
3. plan handoff;
4. chat-stream feasibility decision;
5. image-generation reload-survival decision.

Do not generalize durable protocols beyond needs demonstrated by the pilot.

### Phase 9 — Renderer-local consolidation

Consider `first_prompt`, `preview_iframe`, `screenshot`, and other local
machines. Migrate only where the shared local host reduces code. A stable,
small local controller need not move merely for numerical consistency.

### Phase 10 — Delete transitional infrastructure

After migrations:

- remove unused domain controllers/managers/registries;
- remove lifecycle projection atoms and writer helpers;
- remove atom mailboxes;
- narrow or remove legacy IPC channels;
- remove temporary transport adapters and legacy channels in each cutover's
  immediate follow-up deletion PR; retain only the protocol-version
  assert/reload path;
- update state-machine, Jotai, IPC, and error rules;
- update architecture and “why state machines” documentation;
- add boundaries preventing reintroduction.

## Review and PR constraints

- Kernel, transport, and each production pilot are separate revert points.
- No PR combines generic transport with app-run behavior changes.
- No production actor migration is a repository-wide mechanical rewrite.
- Every remote definition receives security review.
- Every host move receives crash/reload behavior review.
- High-blast-radius pilots receive deep multi-agent review when executed.
- Documentation must describe guarantees actually implemented in that PR.
- Temporary compatibility layers include an explicit deletion phase and test.

## Risks

### Framework overreach

The runtime could become a second application framework with excessive
generics and indirection.

Mitigation:

- two pilots before broad migration;
- deletion budget;
- small explicit interfaces;
- no actor hierarchy, supervision trees, dynamic placement, or remote command
  execution initially;
- preserve ordinary services and React Query.

### False location transparency

Callers may assume a remote actor behaves like a local object.

Mitigation:

- distinct `send` and async `dispatch`;
- explicit connection status;
- typed receipts;
- no generic effect-completion promise;
- documentation and tests for disconnect/retry.

### Generic IPC security hole

A router accepting arbitrary machine/event payloads could widen renderer
privilege.

Mitigation:

- trusted typed handler;
- static manifest;
- nested machine-specific validation;
- per-definition authorization;
- commands never cross from renderer;
- bounds and audit logs.

### Snapshot volume

Large or frequent snapshots could saturate IPC and rerender the UI.

Mitigation:

- lifecycle-only snapshots;
- safe remote projections;
- existing batched/stream channels for high-volume data;
- selector-aware subscriptions;
- measure app-run and chat before migration.

### Development-time renderer/main protocol mismatch

Hot-module replacement can briefly pair incompatible contracts during
development. Production updates apply on restart and load main and renderer
from the same bundle.

Mitigation:

- explicit protocol/schema versions;
- reject rather than coerce;
- resync/reload path;
- development mismatch tests.

Persisted state written by one application version and read after an update is
a separate compatibility boundary. Version and migrate durable schemas where
required; reject or recover explicitly when migration is unavailable.

### Duplicate dispatch after lost receipt

Main may commit an event while the renderer loses the receipt and retries.

Mitigation:

- message ID deduplication;
- bounded receipt cache;
- domain idempotency key for durable acceptance;
- tests for commit-plus-dropped-receipt.

### Actor retention leaks

Remote subscriptions or one-shot keys could retain actors indefinitely.

Mitigation:

- explicit lifecycle policy;
- webContents destruction cleanup;
- bounded idle eviction;
- per-definition retention tests and inspector visibility.

### Main-process load

Moving more orchestration to main could increase CPU/memory pressure or block
Electron.

Mitigation:

- state transitions stay small and synchronous;
- heavy work remains async services/workers;
- respect electron-worker guidance for computation;
- profile actor counts, snapshot sizes, and command scheduling;
- never await long work inside the event drain.

### Migration creates two authorities

Compatibility could leave old renderer and new main actors both active.

Mitigation:

- one command authority at every rollout step;
- shadow mode is pure and effect-free;
- consumer cutover and old-authority deletion occur in the pilot PR sequence;
- tests assert only one process issues lifecycle commands.

### Durable protocol complexity

An actor transport can tempt contributors to treat remote delivery as exactly
once.

Mitigation:

- separate protocol API;
- durable idempotency records;
- explicit acceptance/acknowledgement semantics;
- do not advertise exactly-once execution.

## Non-goals

- General distributed computing outside the Electron main/renderer boundary.
- Multiple main processes or networked Dyad instances.
- Hot-moving a live actor between processes.
- Multi-primary state, CRDTs, or conflict resolution between writable replicas.
- Serializing closures or resource handles.
- Replacing all IPC with machine messages.
- Sending console logs or LLM chunks as snapshots.
- Making React Query data machine-owned.
- Replacing domain services with commands embedded in one mega runtime.
- Persisting every actor.
- Guaranteeing exactly-once command execution.
- Building Erlang/OTP, Akka, or XState inside Dyad.

## Success criteria

The architecture is accepted only if both pilots demonstrate:

- one authoritative actor per key;
- the same definition/host/reference concepts work locally and remotely;
- remote dispatch is validated, authorized, deduplicated, and explicitly
  acknowledged at commit;
- snapshots bootstrap without lost-update races;
- stale actor instances and revisions cannot overwrite current state;
- renderer reload recovers main-hosted state;
- local actors incur no IPC or artificial async behavior;
- React reads snapshots without Jotai lifecycle projections;
- traces connect transport messages and transitions across processes;
- disposal cleans subscriptions, tasks, timers, waiters, and resources;
- existing domain race regressions remain covered;
- app-run removes more permanent architecture than the framework adds to that
  domain;
- contributors can explain sent, committed, completed, and durably accepted
  as distinct states.

Broader rollout succeeds when:

- privileged/resource-owning workflows are hosted beside their resources;
- main registries and renderer controllers use the same transaction/lifecycle
  kernel;
- same-process lifecycle projection atoms and atom mailboxes are gone;
- cross-process read models are generated/hosted by the remote actor client
  rather than hand-written per domain;
- durable cross-machine handoffs use explicit protocol actors;
- remaining custom runtimes have narrow documented reasons;
- `rules/state-machines.md`, `rules/electron-ipc.md`,
  `rules/jotai-state.md`, and architecture documentation match production.

## Expected outcome

The desired end state is not “everything is remote.” It is:

- authority lives beside the resource it controls;
- every workflow uses the same pure transition and transaction mechanics;
- local and remote access share a recognizable typed API;
- process boundaries remain explicit where their semantics matter;
- renderer reload is a supported lifecycle event rather than accidental
  teardown;
- Jotai stores UI/runtime state, not machine lifecycle copies;
- IPC transports validated intent and snapshots, not ad hoc controller glue;
- cross-machine durability is a named protocol rather than an optimistic
  callback chain.

If the app-run and voice-to-text pilots cannot achieve this while deleting
their old infrastructure, stop after the no-regrets cleanup. The goal is a
smaller and more truthful architecture, not adoption of an ambitious
framework for its own sake.
