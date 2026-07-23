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

- Never return a value-equal state with a new reference. One-shot effects are
  commands, not identity signals.
- Snapshots are immutable and reference-stable. Notify subscribers only when
  the snapshot reference changes; use `SnapshotStore` from
  `src/state_machines/` instead of hand-rolling listener plumbing.
- Commands are data and execute in a controller/adapter. A machine that derives
  effects directly from registry transitions must document that deviation and
  its reason in the module header.
- `observeTransition` runs before a controller commits its next snapshot. If
  an observer callback can re-enter the machine (for example, by submitting a
  follow-up turn), defer that callback until the committed state is visible.
- When a manager needs machine-specific observer behavior, compose it with the
  production trace observer (including ignored events) instead of replacing
  trace coverage.
- Command runners convert expected failures into events. A runner throw is a
  programming error: log it and keep the service usable; never wedge a queue or
  silently rewrite state.
- Controllers are disposable and their owner must call `dispose()` on provider
  unmount or entity deletion. Renderer controller collections belong to a
  provider-owned `KeyedControllerHost`; never keep them in module globals.
- Renderer providers must bind manager startup and disposal with the shared
  `useManagerLifecycle` hook; it preserves managers across React StrictMode
  effect replay while still disposing managers that are genuinely replaced.
- When disposal can race an async command that registers external state after
  an `await`, clean up both immediately and again after the command settles.
  Disposal must also clear any machine-owned legacy projection synchronously.
- Before keying a cross-entity registry by a generation counter, verify the
  counter's scope. If generations restart per entity, use a composite key or a
  separate invocation ID and test two entities with the same generation.

## Deliberate degrees of freedom

Concurrency and staleness policy are domain behavior, not kernel behavior.
Document in each machine's `state.ts` or `controller.ts` what runs serially or
in parallel, which events may be dropped as stale, and which must never be
dropped. Main-process machines should use an explicitly constructed registry
with injected timers, IDs, and broadcasts; renderer machines use the shared
keyed host.

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
  one subscription, not opportunistically by individual commands.
- Prefer derived selectors for values computable from the snapshot. Do not add
  generation counters or mirrored booleans beside a machine-owned identity or
  lifecycle state.
- When a later event carries only an identity, consumers that need additional
  context after reload must recover it from the hydrated projection. Buffer
  identity-only events that can arrive before hydration completes instead of
  assuming the consumer observed an earlier, self-contained event.

## Persistence and hydration

- Model hydration explicitly when persisted state gates machine behavior.
  Persist through an adapter-owned, debounced command using a versioned zod
  schema; do not let components write snapshots independently.
- Define merge/replacement semantics for events received during hydration.
  On teardown, flush the latest accepted snapshot through a transport that is
  safe for the lifecycle boundary (for example, one-way IPC during pagehide).

## Tests

- Exercise every reachable state against every event type and assert totality.
- Assert ignored transitions retain the exact state reference and changed
  transitions do not create value-equal snapshots.
- Use fake command runners. Tests must get isolation from constructed owners,
  never from a module-global reset helper.
- `driveTransitionMatrix` remains available for hand-enumerated totality
  tests; new machines may instead use `exploreReachableStates` when a finite
  event generator can discover the reachable graph. Existing bespoke suites
  need not be migrated mechanically.
- `boundaries.test.ts` enforces kernel purity and machine-to-machine isolation;
  add new machine directories to its inventory when they are introduced.
- In `runCosim` suites, `maxSchedules` bounds visited configurations, not only
  quiescent leaves. If one orthogonal action (for example quit at every phase)
  causes a bound hit, split it into a focused exhaustive alphabet instead of
  raising the bound and slowing the primary scenario.
