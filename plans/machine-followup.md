# State-Machine Convention and Micro-Kernel Follow-Up

## Status

Proposed follow-up to `plans/better-state-machine.md`. That plan refactors the
version-preview machine; this one addresses what PRs #3968 (plan handoff),
#3969 (app run), and #3970 (connection flow) revealed: the codebase now has
four hand-rolled state machines in the same pattern, with verbatim-level
mechanical duplication and early signs of drift.

Decision recorded here (from review): **extract only the invariant
micro-kernel and codify the convention in a doc. Do not build a generic
controller, and do not adopt XState.** Four machines produced four distinct,
load-bearing concurrency models — FIFO queue (plan handoff), runId epochs
(app run), flowId correlation (connection flow), per-command-class rules
(version preview). A generic controller would be a policy framework larger
than the ~100–200-line controllers it replaces. The convention and the
lifecycle plumbing are generic; the controllers are not.

## Goals

1. Codify the state-machine convention in a rules doc so drift is caught at
   review time, and deliberate divergences are recorded as decisions.
2. Extract the micro-kernel: the pieces literally identical across all four
   machines (keyed lifecycle host, snapshot/subscription store, transition
   types, React binding, test kit).
3. Migrate the renderer machines' registries to the host: version preview
   (via the main plan), plan handoff, and app run.
4. Backport the best refinement any machine invented — #3970's ignore
   reasons and ignored-event telemetry — into the shared types.

## Non-goals

- A generic controller, command executor, or pluggable
  execution/staleness policy. Concurrency models stay per-machine.
- XState or any statechart framework. Revisit only if a machine needs
  hierarchy, parallel regions, or spawned actor trees.
- Touching `connection_flow`'s main-process registry. It is already the
  right shape (injected timers/ids/broadcast, no module globals, no React).
  Only its shared _types_ participate here.
- Changing any machine's transition semantics or user-visible behavior.
  Every migration in this plan is mechanical and behavior-preserving.
- Blocking or retrofitting PRs #3968/#3969/#3970. They land as they are.

## Current state: four machines

|                 | version_preview                                | plan_handoff (#3968)           | app_run (#3969)                                  | connection_flow (#3970)                   |
| --------------- | ---------------------------------------------- | ------------------------------ | ------------------------------------------------ | ----------------------------------------- |
| Process         | renderer                                       | renderer                       | renderer                                         | main                                      |
| Keyed by        | appId                                          | chatId                         | appId, per Jotai store                           | provider                                  |
| Execution model | parallel dispatch, per-command rules           | strict FIFO drain loop         | serial per app, settlement-as-events             | registry derives effects from transitions |
| Staleness       | epoch on read command; mutations never dropped | none (matrix handles re-entry) | runId epoch, stale events dropped pre-transition | flowId correlation in domain events       |
| Registry        | module globals (replaced by main plan)         | per-chat map in hook           | module-global `WeakMap<store, Map<appId>>`       | injected-dependency class in main         |

Identical in all four: pure `transition(state, event)` with `ignore()` and
exhaustive `never` checks; listener-`Set` + `getSnapshot` +
notify-on-reference-change (~15–20 lines each); a lazy keyed registry
(~30–50 lines each); a `useSyncExternalStore` binding; totality-style
transition tests.

Drift already visible:

- #3969 solves test isolation with a `WeakMap` keyed by Jotai store; the
  version-preview plan solves the identical problem with a provider-owned
  host. Two competing lifecycle patterns landing the same week.
- #3968's controllers have no `dispose()` and live forever per chat;
  version preview treats disposal as a first-class invariant.
- #3970 invented ignore reasons plus `onIgnoredEvent` telemetry; the other
  three machines have nothing equivalent.
- #3970 has no command channel (effects derive from state changes in the
  registry); the other three treat commands-as-data as the core discipline.
  Nobody decided that divergence.
- A throwing command runner is handled three ways: mapped to a failure
  event (version preview), logged and drained past (plan handoff), written
  to an error atom (app run).

## Deliverable 1: convention doc

Add `rules/state-machines.md` (follow the existing `rules/` organization; if
none fits, place under `docs/` and link from `AGENTS.md`). Keep it short
enough to be read in review. Contents:

### Required structure

- File layout per machine: `state.ts` (types only), `transition.ts` (pure),
  `controller.ts` (or a main-process registry), `commands.ts` (adapter),
  plus a hook binding for renderer machines.
- `state.ts`/`transition.ts` are pure and dependency-free: no React,
  Electron, Jotai, TanStack Query, zod, timers, `Date`, or randomness. This
  is what lets types travel between renderer and main.
- Transitions are total over the state × event matrix, with exhaustive
  `switch` + `never` checks and explicit `ignore(state, reason)` so
  deliberate no-ops are distinguishable from omissions.

### Invariants

- No transition returns a value-equal state with a new reference; no
  snapshot changes reference without changing value. (One-shot effects are
  commands, never identity signaling — the version-preview recovery lesson.)
- Snapshots are immutable and reference-stable; subscribers are notified
  only on reference change.
- Commands are data; execution lives in the controller/adapter. A machine
  that deviates (as #3970 does, deriving effects from transitions in its
  registry) must say so and why in its module header.
- Command runners convert expected failures into events. A runner that
  throws is a programming error: log it and keep the machine serviceable;
  never let it wedge the queue or silently rewrite state.
- Controllers are disposable, and something owns calling dispose (provider
  unmount, app/chat deletion). No module-global mutable controller
  collections; lifecycle is owned by a provider or an explicitly
  constructed host/registry.

### Documented degrees of freedom

- The concurrency/staleness model is per-machine and load-bearing. Each
  machine documents its model in its `state.ts` or `controller.ts` header:
  what executes serially vs in parallel, what can be dropped as stale, and
  what must never be dropped.
- Main-process machines use an injected-dependency registry (#3970 is the
  reference example); renderer machines use the shared keyed host.

### Test requirements

- Totality/invariant tests over the transition matrix.
- Reference-stability assertions.
- Fakes for command runners; no machine test may require a global reset
  helper.

## Deliverable 2: micro-kernel in `src/state_machines/`

Only what is identical across all four machines. Hard constraint, enforced
by review and a lint boundary if available: **no imports from any domain,
Jotai, TanStack Query, IPC, or toast code.** `react.ts` is the only file
that may import React.

- `types.ts` — `TransitionResult<State, Command>`,
  `ignore(state, reason?)`, an `IgnoreReason`-style tag type (adopting
  #3970's refinement), and a `TransitionObserver` telemetry interface
  (generalizing `version_preview/debug.ts` and #3970's `onIgnoredEvent`):
  hooks for applied transitions and ignored events.
- `snapshot_store.ts` — `SnapshotStore<S>`: listener set, `getSnapshot`,
  `setState` with notify-on-reference-change, `subscribe`, `dispose`.
  Controllers embed it (composition); it is not a base class and carries no
  transition or command semantics.
- `keyed_host.ts` — `KeyedControllerHost<K, C>` exactly as specified in
  `plans/better-state-machine.md`: lazy creation, per-key and any-key
  subscriptions, disposal of one key or the whole host.
- `react.ts` — `useKeyedController(host, key, selectSnapshot)` over
  `useSyncExternalStore` with stable snapshot identity, plus the smaller
  `useControllerSnapshot(controller)` binding for non-keyed use (usable by
  `useConnectionFlow`'s renderer projection if trivial).
- `testing.ts` — totality driver (run every event against every reachable
  state, assert a result), reference-stability assertion helper, and a
  recording fake command-runner harness.

### Interface-freeze checklist

Before exporting the host as the shared primitive, validate its contract
against all four machines — on paper, not by migrating them first:

- Keys are generic: `number` (appId, chatId) and `string` (provider).
- Construction is React-free; a provider owns it in the renderer, a plain
  module owns nothing (no global hosts).
- The controller contract is only `{ getSnapshot, subscribe, dispose }`.
  The host must not constrain domain surfaces beyond that: app_run's
  `dispatch()`-returns-promise and `onStateChange` projection, plan
  handoff's `send`, and version preview's event API all remain
  controller-owned.
- Controllers lacking `dispose` (#3968) get one added during migration;
  the host requires it.

## Deliverable 3: migrations

Each migration is its own PR, after the corresponding feature PR lands, and
is behavior-preserving under the tests those PRs already added.

### version_preview

Covered by `plans/better-state-machine.md` Phase 1. Coordination rule: the
kernel files above are the canonical versions; that plan's Phase 1 consumes
them rather than defining a parallel copy. If this plan lands second, move
its extracted pieces here without API change.

### plan_handoff (#3968)

- Replace the per-chat controller map inside `usePlanHandoff.ts` with a
  provider- or module-explicit `KeyedControllerHost<number, HandoffController>`.
- Add `dispose()` to the handoff controller; chat deletion disposes its
  controller, mirroring app deletion in version preview.
- Embed `SnapshotStore` in place of the hand-rolled listener set.
- Adopt shared `TransitionResult`/`ignore` types; behavior unchanged.

### app_run (#3969)

- Replace the module-global `WeakMap<store, Map<appId, controller>>` in
  `src/app_run/registry.ts` with a provider-owned host constructed with the
  Jotai store — the WeakMap exists only to isolate test stores, which
  provider ownership solves directly.
- Keep `useRunApp`'s public API and the `onStateChange` atom projection
  exactly as landed; only lifecycle ownership moves.
- Embed `SnapshotStore`; adopt shared transition types.

### connection_flow (#3970)

- Untouched except: adopt the shared `ignore`/`IgnoreReason` and
  `TransitionObserver` types from `types.ts` (it is the origin of the
  pattern), and optionally bind its renderer projection through
  `useControllerSnapshot`. Its main-process registry stays as is.

## Deliverable 4: backports

- Add ignore reasons and a `TransitionObserver` wire-up to the
  version_preview, plan_handoff, and app_run transitions. Mechanical:
  `ignore(state)` → `ignore(state, "reason")`, observer plumbed where
  `debug.ts` logging exists today. No transition semantics change.

## Sequencing

### Phase 0: unblock and annotate (now)

- Land #3968, #3969, #3970 without kernel changes.
- Leave two PR comments before APIs ossify: on #3969, that
  `getAppRunController(store, appId)`'s WeakMap-by-store is the
  module-global lifecycle pattern being eliminated and a provider-owned
  host migration is expected; on #3968, that chat deletion should dispose
  its controller.

### Phase 1: convention doc

- Write `rules/state-machines.md`. Does not wait on any code; this is the
  cheapest drift-stopper and informs review of everything below.

### Phase 2: kernel

- Add `src/state_machines/` files with their tests, validated against the
  interface-freeze checklist.
- Coordinate with `plans/better-state-machine.md` Phase 1 so exactly one
  canonical copy of the host exists.

### Phase 3: migrations

- plan_handoff, then app_run (separate PRs; order chosen by merge order of
  the feature PRs). Each is registry/lifecycle-only, verified by the
  feature's existing tests plus new disposal tests.

### Phase 4: backports

- Ignore reasons + telemetry across the three renderer machines; #3970
  types adoption.

## Risks and mitigations

### Freezing the host API too early

The checklist above is validated against all four machines before the host
is exported. If a fifth machine appears mid-plan, it validates the contract
too — it does not expand it.

### Churning freshly landed PRs

Migrations touch only lifecycle/registry code, not transitions, commands,
or public hook APIs. The feature PRs' own tests are the characterization
suite; a migration PR that has to modify a transition test is out of scope
by definition.

### Convention doc bit-rot

Keep it to invariants and decisions, not tutorials. Link it from the repo
rules/AGENTS index so review agents and humans load it. New-machine PRs are
expected to cite deviations against it explicitly.

### Two plans, one kernel

`plans/better-state-machine.md` specs `KeyedControllerHost` and the React
adapter; this plan adds `SnapshotStore`, shared types, and the test kit
around the same files. Whichever lands first creates `src/state_machines/`;
the other consumes it unchanged. Any API disagreement is resolved in favor
of the interface-freeze checklist here, since it is validated against all
four machines rather than one.

## Verification

Per phase, narrowest first, then the standard pre-commit checks:

```sh
npm test -- src/state_machines/
npm test -- src/plan_handoff/
npm test -- src/app_run/
npm test -- src/connection_flow/
npm test -- src/version_preview/
npm run fmt
npm run lint
npm run ts
npm run build
```

Migration PRs must show `git diff --stat` free of transition/command file
changes (types-import lines excepted) and pass the feature's existing test
suites unmodified except for added disposal coverage.

## Definition of done

- `rules/state-machines.md` exists, records the invariants and the
  per-machine degrees of freedom, and is linked from the rules index.
- `src/state_machines/` contains the host, snapshot store, shared types
  with ignore reasons and transition observer, React bindings, and test
  kit — with zero domain imports.
- No renderer machine owns a module-global controller collection: version
  preview (via its own plan), plan handoff, and app run all run on
  provider-owned hosts; every controller is disposable and disposed.
- connection_flow shares the transition types; its main-process registry is
  unchanged.
- All ignored transitions across the four machines carry reasons and are
  observable through the shared telemetry interface.
- No generic controller, execution policy, or statechart framework was
  introduced; each machine's concurrency model is documented in place.
- All four machines' existing test suites pass unmodified through the
  migrations, plus new disposal and host tests.
