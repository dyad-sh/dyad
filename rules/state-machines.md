# State Machines

Use an explicit state machine when a workflow has async races, queued work, or
events that may arrive after an operation has been superseded.

Background and before/after examples of why this pattern exists:
[docs/why-state-machines.md](../docs/why-state-machines.md).

## Required structure

- Keep domain types in `state.ts`, the pure total function in `transition.ts`,
  side-effect execution in `controller.ts` or a main-process registry, command
  adapters in `commands.ts`, and renderer bindings in a hook/provider.
- `state.ts` and `transition.ts` stay pure. They must not depend on React,
  Electron, Jotai, TanStack Query, zod, timers, `Date`, or randomness.
- Cover the full state × event matrix with exhaustive switches and `never`
  checks. Deliberate no-ops must use shared `ignore(state, reason)` so they are
  distinguishable from omissions and observable in telemetry.

## Invariants

- Controllers migrated to `TransactionalDispatcher` use one event transaction:
  enqueue FIFO; run the pure transition exactly once; validate; reserve the
  command batch without running domain code; cancel exiting state-owned leases;
  commit the snapshot (the linearization point); update the authoritative
  projection; notify snapshot subscribers; notify transition observers; then
  hand the reserved batch to the injected domain scheduler. Re-entrant sends
  from any callback append to the FIFO and run after the current transaction.
  Ignored events skip commit, projection, subscribers, and commands, but notify
  observers at the equivalent point in FIFO order.
- The dispatcher isolates and reports projection, subscriber, observer,
  scheduler, and command failures. Adapters convert expected command failures
  to typed domain events; unexpected throws/rejections may be mapped by the
  domain and never create a universal failure event. Scheduler injection owns
  concurrency policy.
- A pre-commit lease-cancellation failure is also isolated and reported, but
  does not veto commit. Unlike pure transition and validation failures, an
  effectful cleanup hook may have partially completed; rejecting at that point
  would drop the event against a partially modified old state. Cancellation is
  required resource hygiene, while operation/state-instance token checks are
  the correctness backstop that rejects any stale callback which still fires.
- Use `TimerLeaseScope` for migrated watchdogs. Carry the lease's operation or
  state-instance token in its event, cancel it in the dispatcher's pre-commit
  lease hook before exiting state, explicitly replace it on self-re-entry, and
  dispose it with its controller.
- Never return a value-equal state with a new reference. One-shot effects are
  commands, not identity signals.
- Snapshots are immutable and reference-stable. Notify subscribers only when
  the snapshot reference changes; use `SnapshotStore` from
  `src/state_machines/` instead of hand-rolling listener plumbing.
- Commands are data and execute in a controller/adapter. A machine that derives
  effects directly from registry transitions must document that deviation and
  its reason in the module header.
- For cross-machine dispatch followed by acknowledgement, carry a stable
  idempotency key through every queue, IPC, and persistence boundary. Make the
  receiving boundary durably deduplicate acceptance, and acknowledge only
  after that acceptance; a renderer-local enqueue is not durable acceptance.
- Machine-generated queued work must not be editable or removable (including
  through bulk-clear paths) unless removal explicitly settles or rejects the
  owning machine request; otherwise reload can resurrect abandoned work.
- Do not persist machine-generated queue entries when their authority or
  acceptance callbacks are memory-only. Let the live authoritative registry
  rehydrate and re-enqueue them; a full restart must not restore orphan shells.
- `observeTransition` runs before a controller commits its next snapshot. If
  an observer callback can re-enter the machine (for example, by submitting a
  follow-up turn), defer that callback until the committed state is visible.
- When a manager needs machine-specific observer behavior, compose it with the
  production trace observer (including ignored events) instead of replacing
  trace coverage.
- Command runners convert expected failures into events. A runner throw is a
  programming error: log it and keep the service usable; never wedge a queue or
  silently rewrite state.
- When a resume event can come from a global watcher as well as explicit UI
  senders, validate the captured payload in the transition. Caller-only guards
  can be bypassed after navigation or another asynchronous detour.
- Every waiter settlement path (success, decline, timeout, abort, and sweep)
  emits a correlated resolved event to every observer.
- On saga resume or retry, preserve explicit user choices from the snapshot and
  re-resolve implicit derived values through one shared resolver. Model SUBMIT
  (a new payload) and RETRY (the retained payload) as distinct events.
- A machine-owned watchdog timer needs an explicit cancel command on every
  transition that leaves the watched state, plus disposal cleanup.
- In a cancelling state, finalize on every non-stale terminal event. Reject
  staleness by identity; never infer event provenance from arrival order.
- Compensation on abort rolls back only what the aborted operation touched.
- When a multi-step side effect can fail partway through, retain the exact
  completed/next step in the failure state. Retrying from the start can repeat
  non-idempotent external work or deterministically fail on an existing-resource
  guard even when the owning entity is correctly reused.
- Controllers are disposable and their owner must call `dispose()` on provider
  unmount or entity deletion. Renderer controller collections belong to a
  provider-owned `KeyedControllerHost`; never keep them in module globals.
- When registering a manager method as a disposal callback, wrap it in a stable
  closure or bind it if it reads `this`; passing a bare prototype method loses
  its receiver when the registry invokes it.
- Renderer providers must bind manager startup and disposal with the shared
  `useManagerLifecycle` hook; it preserves managers across React StrictMode
  effect replay while still disposing managers that are genuinely replaced.
- Managers that claim exclusive, reversible resources (such as an atom writer)
  must release them in `stop()` during synchronous effect cleanup. Keep only
  irreversible final teardown in deferred `dispose()` so a replacement can
  acquire the resource before the StrictMode-safe disposal microtask runs.
- When disposal can race an async command that registers external state after
  an `await`, clean up both immediately and again after the command settles.
  Disposal must also clear any machine-owned legacy projection synchronously.
- When that external state is created in the main process, renderer disposal
  cannot rely on reply-based IPC cleanup. Mint an operation ID before creation,
  send teardown cancellation one-way, and retain a main-owned cancellation
  tombstone so late creation completion performs the cleanup.
- Before keying a cross-entity registry by a generation counter, verify the
  counter's scope. If generations restart per entity, use a composite key or a
  separate invocation ID and test two entities with the same generation.
- Cross-lifetime operations use `InvocationRef` from `src/state_machines/`,
  minted by the injected `IdSource` at the authoritative start boundary and
  echoed through every available correlation boundary. Registry claims use
  `InvocationRegistry.claim(ref)`. When a source cannot echo the ref, use
  `InvocationRegistry.claimStructurally(...)` with a documented
  structural-safety note at the claim site.
- Correlation identity and durable idempotency identity are separate contracts.
  Name which property each boundary relies on even when a protocol deliberately
  uses the same value for both.
- When a machine becomes the sole scheduler for a queue, every legacy enqueue
  path must poke the machine or enqueue through it.

## Deliberate degrees of freedom

Concurrency and staleness policy are domain behavior, not kernel behavior.
Document in each machine's `state.ts` or `controller.ts` what runs serially or
in parallel, which events may be dropped as stale, and which must never be
dropped. Main-process machines should use an explicitly constructed registry
with injected timers, IDs, and broadcasts; renderer machines use the shared
keyed host.

When independent async operations should overlap but both gate progress, start
both through commands and model their completion as separate events joined by
explicit state flags or substates. A serial command queue must not accidentally
turn prior `Promise.all`-style behavior into additive latency.

New machines must inject `Clock` and `IdSource` from `src/state_machines/clock.ts`
when they schedule timers, read wall time, or mint operation identities. Use
`createFakeClock` and `createSequentialIdSource` in tests instead of fake global
timers or nondeterministic UUIDs; retrofitting existing machines is optional.

## Composition

- Machines communicate through typed facades injected in their dependency
  objects, or through explicit events. A machine must never import another
  machine's registry or controller module.
- Record the machine dependency graph in each participating module's header
  and keep it acyclic. Construct concrete facade adapters at an application
  composition root, outside both machines.

## Projections

- A machine projection has one writer: its controller or manager. Jotai atoms
  exposed to legacy UI are read-only views and are updated from snapshots in
  one subscription through `projectToAtom` or a claim from
  `registerAtomWriter`, not opportunistically by individual commands. A
  projection is safe only once the machine is its single writer; interim
  dual-writer periods are where races live.
- A machine with interactive controls defines a pure
  `selectCapabilities(state)` whose named booleans express domain UI policy,
  and exposes those capabilities through its projection. Do not derive
  capability by probing the transition with a synthetic event: acceptance may
  depend on payload, and accepted idempotent work may still warrant hidden UI.
- Prefer derived selectors for values computable from the snapshot. Do not add
  generation counters or mirrored booleans beside a machine-owned identity or
  lifecycle state.
- When replacing a retained generation with an active-only identity, audit
  React effect dependencies for the new active-to-empty settlement edge.
  Start-only effects must explicitly require a new non-empty identity.
- When local form or dialog state dispatches a machine-owned mutation, preserve
  the user's input while the operation runs and after failure. Close dialogs
  and clear forms only on authoritative settlement; dispatch itself is not
  proof that the mutation succeeded.
- When an epoch keys a mounted resource, capture props such as an iframe `src`
  from the epoch-changing snapshot. Do not let later same-epoch state updates
  rewrite identity-defining DOM attributes and trigger an implicit reload.
- When a later event carries only an identity, consumers that need additional
  context after reload must recover it from the hydrated projection. Buffer
  identity-only events that can arrive before hydration completes instead of
  assuming the consumer observed an earlier, self-contained event.
- If retries may replace an input payload, carry operation facts established
  by earlier transitions (such as create-vs-update) explicitly in state. Do not
  re-derive UI or analytics semantics from the replacement payload.

## Persistence and hydration

- Model hydration explicitly when persisted state gates machine behavior.
  Persist through an adapter-owned, debounced command using a versioned zod
  schema; do not let components write snapshots independently.
- Define merge/replacement semantics for events received during hydration.
  On teardown, flush the latest accepted snapshot through a transport that is
  safe for the lifecycle boundary (for example, one-way IPC during pagehide).

## Query keys and recorded decisions

- Machine-adjacent TanStack Query keys nest as `[domain, appId, ...]` so data
  invalidated together remains scoped per app; do not use sibling keys for
  those values.
- Recorded plan decisions are reviewable artifacts. When a review finding is
  rebutted as working as designed, the cited decision must actually cover the
  disputed behavior.

## Tests

- Exercise every reachable state against every event type and assert totality.
- Assert ignored transitions retain the exact state reference and changed
  transitions do not create value-equal snapshots.
- Use fake command runners. Tests must get isolation from constructed owners,
  never from a module-global reset helper.
- Run `runControllerConformanceSuite` for controllers built on the shared
  dispatcher/lifecycle contract; domain tests remain responsible for domain
  behavior.
- Normalize discovered file paths to `/` before asserting literal repository
  paths; `path.relative()` returns `\` on Windows CI.
- `driveTransitionMatrix` remains available for hand-enumerated totality
  tests; new machines may instead use `exploreReachableStates` when a finite
  event generator can discover the reachable graph. Existing bespoke suites
  need not be migrated mechanically.
- Use `assertCapabilityTransitionConsistency` with domain-supplied
  representative valid events for every capability. Every enabled
  capability/state pair must supply at least one valid representative so the
  assertion cannot pass vacuously. When payload affects acceptance, include
  representative invalid payloads; disabled capabilities may also pin their
  expected ignore reason.
- `boundaries.test.ts` enforces kernel purity and machine-to-machine isolation;
  add new machine directories to its inventory when they are introduced.
- In `runCosim` suites, `maxSchedules` bounds visited configurations, not only
  quiescent leaves. If one orthogonal action (for example quit at every phase)
  causes a bound hit, split it into a focused exhaustive alphabet instead of
  raising the bound and slowing the primary scenario.
- Treat snapshots passed to `runCosim` callbacks as frozen immutable views.
  Do not mutate them, and do not replace the generic callback contract with a
  serialization-based clone that rejects valid domain values or loses
  prototypes.
- Key-aware debug retention must bound both entry payloads and per-key
  metadata. When aggregate eviction empties a key's ring, prune the ring so
  one-shot entity IDs cannot accumulate forever, and maintain a global
  insertion-order index instead of scanning every key on each production
  trace event.
