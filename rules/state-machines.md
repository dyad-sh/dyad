# State Machines

Use an explicit state machine when a workflow has async races, queued work, or
events that may arrive after an operation has been superseded.

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
- Command runners convert expected failures into events. A runner throw is a
  programming error: log it and keep the service usable; never wedge a queue or
  silently rewrite state.
- Controllers are disposable and their owner must call `dispose()` on provider
  unmount or entity deletion. Renderer controller collections belong to a
  provider-owned `KeyedControllerHost`; never keep them in module globals.

## Deliberate degrees of freedom

Concurrency and staleness policy are domain behavior, not kernel behavior.
Document in each machine's `state.ts` or `controller.ts` what runs serially or
in parallel, which events may be dropped as stale, and which must never be
dropped. Main-process machines should use an explicitly constructed registry
with injected timers, IDs, and broadcasts; renderer machines use the shared
keyed host.

## Tests

- Exercise every reachable state against every event type and assert totality.
- Assert ignored transitions retain the exact state reference and changed
  transitions do not create value-equal snapshots.
- Use fake command runners. Tests must get isolation from constructed owners,
  never from a module-global reset helper.
