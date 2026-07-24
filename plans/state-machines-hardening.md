# Hardening the State-Machine Layer

## Status

Proposal only. Merges `plans/claude-state-machines.md` and
`plans/codex-state-machines.md` (kept as drafts). Synthesized from the
review threads and fix-commit iterations of the state-machine migration PRs
merged 2026-07-16 through 2026-07-23 — kernel/infra (#4014, #4015, #4024,
#4026, #4027, #4045, #4038), chat stream (#4008, #4019, #4023, #4025), app
run and plan handoff (#3968, #3969), sagas (#4040, #4060), and the domain
ports (#4021, #4028, #4029, #4031, #4032, #4033, #4036, #4047, #4048,
#4058, #4059, #4061, #3967, #3970, #4005) — plus the planning PRs
([#4017](https://github.com/dyad-sh/dyad/pull/4017),
[#4042](https://github.com/dyad-sh/dyad/pull/4042)) and an audit of the
current eleven controller/registry runtimes.

## Scope and conclusion

The migration's domain modeling held up in review. Pure transitions,
explicit commands, reference-stable snapshots, provider-owned managers, and
structured ignored-event telemetry are sound foundations; almost no bugs
were found in the kernel itself.

The main correctness gap is one layer above the transition function. The
shared kernel standardizes stores, hosts, React lifecycle, traces, and test
utilities, but leaves these correctness-sensitive controller semantics to
each domain:

- event linearization and re-entrancy;
- snapshot commit, observer, subscriber, and command ordering;
- synchronous and asynchronous command failure handling;
- disposal racing late async registration;
- operation identity and stale-event correlation;
- liveness and progress obligations;
- UI capability consistency (enabled actions must correspond to events the
  current state accepts);
- durable acknowledgement across machine boundaries.

Those mechanisms were deliberately excluded from the initial micro-kernel
in [#4014](https://github.com/dyad-sh/dyad/pull/4014) (decision recorded in
`plans/machine-followup.md`: no generic controller, no XState). The PR
iterations provide enough evidence to revisit that boundary — narrowly. The
recommended direction is not a framework that owns domain policy. It is a
small shared runtime that owns event _transaction mechanics_ while leaving
state shape, concurrency policy, and staleness policy domain-specific,
plus test tooling that makes the most-reviewed conventions checkable.

## Evidence

### Measured drift in the current implementation

- Only four of the eleven controllers or registries using
  `observeTransition` have an event re-entrancy buffer.
- All eleven call observers before committing the next snapshot.
- Command execution ordering varies by controller.
- Some runners execute serially and others directly, with different
  synchronous-throw and asynchronous-rejection behavior.
- Transition contract validation runs only when each test suite remembers
  to invoke it.

### Review-caught failure classes, ranked by severity × recurrence

Every item below was a real review comment that produced a fix commit.

**1. Wait states that lose their progress mechanism.** The single worst
finding class. [#4058](https://github.com/dyad-sh/dyad/pull/4058#discussion_r3636307586)
(HIGH): re-entering `waitingSelectorReady` during an in-flight capture did
not re-emit `schedule-settle` (one path emitted `cancel-settle`), leaving a
state whose only exit is a timer event with no timer — "the machine is
permanently stuck... reintroduces exactly the stale-thumbnail regression
the PR set out to fix." Same family: no timeout escape at all in
`cancelling` (#4032 — a never-settling IPC promise makes the job
unreclaimable), `awaitingResponse` and untagged-page `pending` (#4058),
and #4040's `checkingProviders` wedging the first-prompt overlay until a
watchdog was added.

**2. Operation identity confused across lifetimes.**
[#4023](https://github.com/dyad-sh/dyad/pull/4023): stream generations were
per-controller counters, so dispose-and-recreate restarted at 1 and a late
IPC payload from the old stream _passed_ the staleness check and could
terminate the new stream — fixed by hand-rolling `lastStreamIdByChatId`
retention in the manager.
[#4031](https://github.com/dyad-sh/dyad/pull/4031#discussion_r3631552691):
a local generation mistaken for a globally unique identity. #3969: proxy
stdout carries no producer generation, so a URL from the old process could
be applied after a destructive restart. #4024: the deferred-cleanup
double-dispose (A→B→A→B) was fixed with another hand-rolled generation
map. #4015 (P1): a stale cached chat mode overrode a persisted mode
switch — "is this still current?" answered by cache identity instead of
explicit identity.

**3. Disposal treated as teardown instead of as a transition.** #4019:
disposing mid-stream never synced a terminal snapshot, so the legacy
`isStreamingByIdAtom` projection stayed `true` and blocked queue dispatch
forever; disposing in `finalizing` cleared the command queue (dropping
`run-end-side-effects`) while skipping `releaseTransport` — a leak.
[#4045](https://github.com/dyad-sh/dyad/pull/4045#discussion_r3633712105):
`dispose()` released the projection writer before the final idle
`syncProjection`, dropping the write.
[#4021](https://github.com/dyad-sh/dyad/pull/4021#discussion_r3627971018):
late async setup escaped disposal. #4005: bulk delete cleared
`selectedAppId` before disposing controllers, firing `APP_CHANGED` into a
deleted app. #3969: the stop IPC path lacked try/catch, leaving the
dispatch waiter hanging in `stopping` forever.

**4. Enabled UI whose events the machine silently ignores.** The largest
cluster by count. Total matrices with `ignore(state, reason)` are correct,
but no projection derived acceptance, so legacy buttons became enabled
no-ops: Sync in conflicted/rebase-paused states (#4059), "Switch to main"
sending `CLOSE` to an already-`closed` machine and restore buttons live
during `recovery-required` (#4005), dialog flows keyed to success events
the machine never emits on the conflict path
([#4061](https://github.com/dyad-sh/dyad/pull/4061#discussion_r3639891573)
— dialogs also closed on dispatch, destroying retryable input). Same
family cross-process: #4015 (P2) — consent timeout settled the waiter in
main but never notified the renderer, leaving a live, clickable-but-dead
consent banner. Invariant adopted: every waiter settlement path emits a
correlated resolved event.

**5. Re-entrancy and ordering within one dispatch.**
[#3969](https://github.com/dyad-sh/dyad/pull/3969#discussion_r3607908235):
a listener synchronously re-entering `process()` executed the inner
event's commands before the outer's (fixed: processing flag +
pending-event FIFO + enqueue-before-notify).
[#4028](https://github.com/dyad-sh/dyad/pull/4028#discussion_r3628323130):
a callback observed stale state (observers notified before commit).
[#3968](https://github.com/dyad-sh/dyad/pull/3968#discussion_r3607899376):
`watch-stream-idle` awaited inside the serial drain — a never-idle stream
permanently wedged the FIFO; separately, the idle watcher firing
synchronously inside the old stream's `onEnd` had its new callbacks
deleted by the old stream's cleanup (fixed with generation-aware callback
removal).
[#4059](https://github.com/dyad-sh/dyad/pull/4059#discussion_r3636261590):
a command runner ignored `command.files` in favor of a React closure
cleared in the same synchronous dispatch — "works only because command
dispatch is synchronous."

**6. Command failure handling.**
[#4029](https://github.com/dyad-sh/dyad/pull/4029#discussion_r3628359815):
a synchronous `getUserMedia` throw escaped the runner before
`MEDIA_DENIED` was emitted, stranding the machine in `acquiring`.
[#4033](https://github.com/dyad-sh/dyad/pull/4033#discussion_r3628590963):
terminal settlement depended on a fallible ancillary command —
`persist-always` ran before terminal cleanup, so a failed SQLite write
left the parked consent promise unresolved and "the chat stream stays
stuck waiting for consent."

**7. Dead states and unreachable transitions survive exhaustiveness
checks.** `never`-checks prove totality of _handling_, not reachability or
producibility: the never-produced `superseded` state (#4036), the
unreachable `successBanner("rebase")` (#4059), the missing
`conflicted → switch-blocked` cell found only when the consumer PR needed
it (#4061), and `unreachableState` returning garbage instead of throwing
so unknown events were silently swallowed (#3970).

**8. First-construction-wins singletons capturing late-arriving
dependencies.**
[#4047](https://github.com/dyad-sh/dyad/pull/4047#discussion_r3633885316)
(HIGH, found independently by two reviewers): the projection adapter
captured `chatStream` at first construction, during render, before the
root effect injected the facade — reload-safe continuation silently never
ran, and tests missed it because each test constructed the adapter
correctly. #3970's cold-start unsolicited-return drop (listener installed
lazily) is the same defect.

**9. Correlation only as strong as its weakest claim site.** #3970 (P1):
`claimReturn` claimed whichever same-provider flow was `awaiting-return`,
so a stale poll or old browser callback could advance a newer flow —
"connect the wrong account." Where the ID physically cannot round-trip
(Supabase/Neon proxy accepts no state parameter), the invariant must be
structural and documented — and #4038's doc review showed such
documentation is itself correctness-critical ("teaches future contributors
the wrong invariant").

**10. Cancel racing registration; compensation scope.** #4008 (P1): Stop
between abort tracking and stream registration produced a terminal event
the ordering model misclassified, deadlocking `cancelling`. Adopted rule:
always finalize on any non-stale terminal event in a cancelling state;
reject staleness by generation, never by inferring event provenance from
ordering. #4040's creation registry (commit/cancel tombstones) solves the
same shape in main. #4060 (HIGH): the early-abort path called
`clearTodosOnCancel` before the persisted snapshot was loaded, deleting
the chat's on-disk todos — compensation must roll back only what the
aborted operation actually touched.

**11. Dual-writer projections and divergent resolvers.**
`isStreamingByIdAtom` caused a P1 in #4008 (machine idle-write clobbering
an external stream's `true`) and the #4019 dispose bug; the defensive
guards only became deletable when #4025 made the machine the single
writer. #4040: three `PROVIDER_CONFIGURED` emitters resolved chat mode
differently, so whichever event won the race decided the mode — resolvers
must be centralized.

**12. Cross-machine queued work without durable ownership.** #4047:
machine follow-ups deletable via queue UI without settling the registry
(double-dispatch after reload); persisted follow-ups restoring as
immutable orphans because the owning registry is memory-only; a stranded
`due` follow-up after dispatch failure.

The state-machine rules (`rules/state-machines.md`) have absorbed many of
these lessons and bots already cite it by line number in review. The next
step is to move the most universal rules into types, runtime mechanics,
and reusable tests — enforced by construction instead of by reviewer.

## Proposed improvements

### 1. Transactional event dispatcher

Add a small shared dispatcher that owns one event transaction:

1. Append the event to a FIFO.
2. Run the pure transition exactly once.
3. Validate the transition result.
4. Reserve the command batch's position without starting it.
5. Commit the snapshot; this is the event's externally visible linearization
   point.
6. Synchronously update the authoritative projection.
7. Notify snapshot subscribers.
8. Notify transition observers.
9. Start the reserved command batch.
10. Process synchronously emitted or re-entrant events afterward.

Required guarantees:

- An observer, listener, or synchronous command emission never processes
  an event against an uncommitted snapshot (evidence class 5, #4028).
- Commands derived from event B cannot overtake commands derived from
  event A (#3969).
- Re-entrant dispatch is always FIFO.
- A runner exception — synchronous or asynchronous — cannot wedge the
  dispatcher; expected failures use domain-declared events and unexpected
  failures follow the command failure contract below (#4029, #3969 stop
  path).
- No blocking awaits on unbounded external conditions inside the drain;
  long waits are disposable, supersedable watchers owned by a state
  (#3968).
- Disposal stops event admission and late emissions consistently.
- Re-entrant events emitted by projections, subscribers, observers, or
  commands append to the FIFO and cannot join or interrupt the current
  transaction.
- Ignored events do not commit a snapshot or start commands, but their
  observers run at the equivalent observer point in FIFO order.
- Projection, subscriber, and observer exceptions are isolated, reported as
  programming errors, and do not prevent later notification or event-queue
  progress.
- Reserving a command batch never invokes domain code. A scheduler may begin
  synchronous command execution only at step 9.

The dispatcher must not choose domain concurrency. A domain still injects
its command scheduler and decides whether commands run serially,
concurrently, or as independently tracked operations. This is the
mechanical loop all current machines already share, with the review-caught
bugs fixed once — not the policy framework `plans/machine-followup.md`
declined.

### 2. Discriminated transition results

Replace the optional `ignoredReason` result shape with a discriminated
union:

```ts
type TransitionResult<State, Command, Reason> =
  | { kind: "ignored"; state: State; reason: Reason }
  | { kind: "applied"; state: State; commands: readonly Command[] };
```

Constructors with unambiguous semantics: `ignore(state, reason)`,
`change(nextState, commands?)`, `stay(state, commands)` for an applied
command-only transition. This makes it impossible to attach commands to an
ignored event accidentally, and distinguishes deliberate command-only
transitions from implicit no-ops.

### 3. Explicit capability selectors with transition-consistency tests

UI capability is domain semantics, not identical to whether a synthetic
event probe happens to be accepted. Acceptance can depend on the real
payload; an applied event may perform stale-resource cleanup; and an
idempotent event may be accepted even when its UI should remain hidden.

Each domain that exposes interactive controls therefore defines an explicit,
pure capability selector:

```ts
function selectGithubCapabilities(state: GithubOpsState) {
  return {
    canSync: state.type === "idle",
    canResolveConflicts: state.type === "conflicted",
  };
}
```

Projections expose these capabilities and UI controls consume them. The
shared test kit accepts a domain-supplied representative event factory for
each enabled capability and asserts that the real transition applies it.
Disabled capabilities may optionally assert an ignored reason. Payload-
dependent capabilities use representative valid and invalid payload cases,
not invented "minimal" runtime probes.

This keeps capability policy explicit while making drift between projection
and transition mechanically detectable. Dialog/dispatch UX rules (#4061:
close on authoritative settlement, not on dispatch; preserve retryable
input) remain in the rules doc below.

### 4. Progress audits and timer leases

An optional way for a machine to describe how each non-terminal state can
make progress:

```ts
{
  state: "waitingSelectorReady",
  progressBy: ["timer:settle", "external:selector-ready"],
}
```

These declarations are audit metadata, not a universal liveness proof. The
explorer cannot know whether an IPC response is guaranteed, a subscription
is live, or a user intentionally leaves a state pending. For finite machines
with a complete event model, focused checks may reject non-terminal cycles
that have no declared progress source. Other machines use the metadata to
drive explicit conformance tests and review diagnostics.

Companion runtime primitives are **timer/watchdog leases** owned by a unique
operation token or state-instance token. A lease:

- is scheduled through the injected `Clock`;
- carries the token in its emitted event so stale callbacks are rejected;
- is cancelled before state exit becomes externally visible;
- is replaced explicitly on self-re-entry;
- supports payload-dependent delays and events;
- is disposed with its owning `TaskScope`.

Domains may build declarative state-entry timers on top of leases, but the
runtime must not infer entry solely from a state discriminator. Tests assert
that every declared timer is installed, replaced on relevant re-entry, and
cancelled on every exit. This would have caught the #4058 reload race without
claiming to prove progress for arbitrary external waits.

### 5. Shared task and resource scope

A reusable `TaskScope`/`ResourceScope` for keyed subscriptions, timers,
pending async registrations, cancellable operations, and cleanup
functions:

```ts
scope.replace(key, cleanup);
scope.remove(key);
scope.trackPromise(promise, lateCleanup);
scope.dispose();
```

Registering a cleanup after the scope has been disposed runs that cleanup
immediately (#4021's late-async-setup escape). `dispose()` is idempotent.
Timer helpers use the shared `Clock`.

On top of it, provide a domain-configured lifecycle sequence:

```ts
createLifecycleScope({
  stopAdmission,
  settleWaiters,
  publishFinalProjection,
  releaseResources,
  onLateSettlement,
});
```

The kernel guarantees hook ordering, idempotence, late-registration cleanup,
exception aggregation, and that writer release follows the final projection
hook. The domain supplies what unsuccessful settlement means, whether a
terminal snapshot should be published, which compensation is safe, and
which resources were actually acquired. This captures the converged disposal
contract without pretending the kernel can infer domain teardown semantics.

### 6. Command failure contract

Expected command failures are domain outcomes and must be converted to typed
events by the command adapter. Unexpected synchronous throws and rejected
promises are programming errors: the shared executor catches and reports
them, continues the queue, and never silently rewrites machine state.

A machine may optionally provide:

```ts
mapUnexpectedCommandError(command, error): Event | undefined;
```

There is no universal `command-threw` event injected into every domain event
union. Mandatory terminal settlement and cleanup run as critical finalizers
that cannot be skipped by an earlier ancillary command failure. This keeps
`persist-always`-style work from blocking waiter settlement (#4033) while
preserving the distinction between expected failure and a programming defect
(#4029).

### 7. Standard operation identity and correlation

Prefer stable operation identities minted by `IdSource` over
controller-local numeric generations:

```ts
type InvocationRef<Kind extends string, EntityKey> = {
  kind: Kind;
  entityKey: EntityKey;
  operationId: string;
};
```

The complete invocation reference is minted at the authoritative start
boundary and crosses every relevant IPC, queue, and persistence boundary.
Every producer callback is bound to it. Producers echo it where possible;
adapters for untagged sources stamp events with the invocation that owns the
producer, such as binding proxy stdout parsing to the spawned process rather
than accepting an unscoped URL (#3969). Globally unique IDs prevent reuse,
while the explicit entity key prevents scope confusion (#4023, #4031).

Shared helpers for: matching completion events to active operations;
recording superseded tokens; settling superseded waiters without applying
stale state; constructing composite registry keys; retaining bounded
cancellation tombstones for late completion (#4040, #4033). A canonical
`stale-operation` ignore reason in `types.ts` so traces and tests spell it
identically. Registry-level claim enforcement: claims must present the
expected token or route to an unsolicited/stale path — per-call discipline
is how #3970's P1 happened. Where a token physically cannot round-trip,
the structural safety argument must be documented at the claim site.

Correlation identity and idempotency identity are separate concepts. A
protocol may deliberately use the same value for both, but its types and
documentation must say which property each boundary relies on.

### 8. Late-binding dependency holder

Late binding is an escape hatch, not the default composition mechanism.
Prefer constructing dependencies synchronously at the composition root,
representing genuine readiness as state, or injecting a stable facade whose
methods explicitly handle "not configured."

Where lifecycle constraints genuinely prevent earlier construction,
`createLateBinding<T>()` provides `get()`, `configure(value)`, and
`onConfigured(cb)`. Its contract must specify one-shot versus replaceable
configuration, behavior before configuration, cancellation of queued
callbacks, disposal, and configuration failure. This replaces ad-hoc
`configureChatStream`-style retrofits without normalizing first-construction-
wins singletons (#4047, #3970).

### 9. Durable cross-machine handoff

A shared protocol for workflows where one machine submits work to another
and waits for acknowledgement:

```text
created -> durably accepted -> executing -> acknowledged
                       \-> rejected or settled
```

The protocol defines:

- the durable owner and versioned record schema;
- the transaction that constitutes receiver acceptance;
- at-least-once delivery with receiver-side idempotency deduplication;
- acknowledgement only after the acceptance transaction commits;
- typed ownership on machine-generated queue entries;
- cancellation before acceptance, after acceptance, and during execution;
- removal or bulk-clear behavior that explicitly rejects or settles the
  owner;
- restart, renderer-crash, retry, retention, and pruning behavior;
- recovery when sender persistence commits but receiver notification fails;
- no persistence when authority or callbacks are memory-only (#4047's
  orphaned follow-ups).

Exactly-once execution is not promised; durable deduplication makes repeated
delivery safe. An injected facade remains the composition boundary.

The first design and implementation pilot is the user-input follow-up into
`chat_stream`. Its design must name the persistence location, record shape,
acceptance transaction, acknowledgement point, and crash/reload sequence
before extracting a general API. The primitive is generalized only after the
pilot demonstrates the protocol against a real queue.

### 10. Automatic transition-contract validation and reachability

Strengthen `driveTransitionMatrix` and `exploreReachableStates` so callers
do not reproduce the validation loop. Both assert: ignored transitions
retain the exact state reference and emit no commands; an applied
value-equal state reuses the previous reference; every transition returns
a valid discriminated result; failures identify the source state, event,
result, and explored path. `exploreReachableStates` returns the explored
graph (edges and predecessors), not just a state array.

TypeScript unions are not enumerable at runtime, so reachability assertions
require explicit domain inventories and finite event generators:

```ts
const STATE_KINDS = [
  "idle",
  "running",
  "conflicted",
] as const satisfies readonly GithubOpsState["type"][];

const COMMAND_KINDS = [
  "push",
  "rebase",
] as const satisfies readonly GithubOpsCommand["type"][];
```

The standard suite accepts state and command inventories, event generators,
state keying/equivalence, exploration bounds, and deliberate exclusions with
stable reasons. It distinguishes an unreachable state kind from one
unreachable concrete payload and a reserved protocol variant from dead code.

Add and require:

- `assertAllStatesReachable(transition, initial, eventCorpus)` — catches
  #4036's dead `superseded` state against the explicit inventory.
- `assertAllCommandsProducible(...)` — catches #4059's unreachable banner
  against the explicit command inventory.
- `unreachableState` and siblings must throw, never return (#3970).

These assertions prove coverage only relative to the supplied finite
inventories and generators. They do not claim that an incomplete event corpus
models every production ordering. Missing transition cells such as #4061
still require scenario and consumer-contract tests.

### 11. Controller conformance suite

Every controller runtime passes the same adversarial suite:

- an observer dispatches re-entrantly;
- a subscriber dispatches re-entrantly;
- a command emits synchronously;
- a runner throws synchronously;
- a runner rejects asynchronously;
- the controller is disposed while a command awaits;
- a command emits after disposal;
- a key is disposed and recreated while stale events remain;
- a manager undergoes StrictMode replay;
- a manager undergoes rapid A → B → A → B replacement;
- final projection cleanup occurs before writer release;
- `dispose()` from every reachable non-terminal state clears projections,
  releases everything the state owned, and is a no-op the second time.

Domain tests remain responsible for domain behavior; the conformance suite
proves the shared execution and lifecycle contract.

### 12. Stronger trace replay and observability polish

Separate two products with different safety and fidelity requirements:

- **Debug trace:** compact, redacted, bounded, and suitable for production
  diagnostics. It may reduce objects to stable descriptions and is not
  replayable.
- **Replay trace:** dev/test-only by default, versioned, and contains the
  complete serialized event payload and other transition inputs required for
  deterministic replay. Each domain declares serialization and redaction.

`replayTrace` currently trusts the recorded ignored marker and skips the
transition. Replay-grade traces instead execute every event and verify the
ignored/applied classification, ignored reason, resulting state key, and
command descriptions, reporting the shortest divergent prefix. Schema
versions are validated before replay. Injected clocks make time reads
deterministic but cannot compensate for omitted event payloads.

Close the flagged-but-deferred review findings:

- Monotonic sequence tiebreaker on trace entries so same-millisecond
  cross-machine ordering is causal, not approximate (#4026).
- Per-entity-key ring buffers (or key-aware capacity) so concurrent
  chats/apps stop evicting each other's trace entries (#4026).
- Dev-gate `window.__dyadMachines`; `defaultDescription` must refuse to
  retain raw untagged objects (#4026 — retention/exposure hazard).
- Freeze or defensively clone co-sim snapshots handed to caller callbacks;
  validate `result.state` eagerly (#4027).
- Decide the `registerAtomWriter` production-throw question (#4045): the
  design doc scoped single-writer enforcement to a dev-mode assertion, but
  the guard throws unconditionally in prod. Downgrade to dev-assert +
  prod-warn, or record the throw as a deliberate decision.

## Rules-doc updates

Once the primitives exist, the corresponding `rules/state-machines.md`
entries change from "remember to do X" to "use kernel primitive Y." Rules
that remain convention-only:

- Every waiter settlement path (success, decline, timeout, abort, sweep)
  emits a correlated resolved event to every observer (#4015).
- On saga resume/retry, explicit user choices are preserved from the
  snapshot; implicit derived values are re-resolved through one shared
  resolver; SUBMIT (new payload) and RETRY (retained payload) are distinct
  events (#4040).
- Dialogs and forms close on authoritative settlement, not on dispatch;
  failure paths preserve retryable input (#4061).
- In a cancelling state, always finalize on any non-stale terminal event;
  never infer event provenance from ordering (#4008).
- Compensation on abort rolls back only what the aborted operation
  actually touched (#4060).
- When a machine becomes the sole scheduler for a queue, every legacy
  enqueue path must poke the machine or enqueue through it (#4008).
- A projection is safe only once the machine is its single writer; interim
  dual-writer periods are where the races live (#4008/#4019/#4025).
- Machine-adjacent TanStack Query keys nest as `[domain, appId, ...]` so
  invalidation scopes per app; no sibling keys for data invalidated
  together (#4059/#4061).
- Recorded plan decisions are reviewable artifacts: when a bot finding is
  rebutted as working-as-designed, the cited decision must actually cover
  the behavior (#4048 rebutted two findings successfully and one wrongly;
  #4038 shipped a doc fix because a documented invariant was false).

## Non-goals

The shared runtime should not:

- prescribe state shapes or phase names;
- decide which stale events are safe to drop;
- force all commands to run serially;
- infer durability from renderer-local state;
- hide domain-specific recovery policy;
- replace explicit protocol or co-simulation models for cross-process
  flows;
- require immediate migration of existing stable machines;
- become XState or any statechart framework (hierarchy, parallel regions,
  actor trees) — nothing in the review record asked for one.

The goal is to genericize linearization, lifecycle mechanics, correlation
mechanics, capability/transition consistency checks, and verification — not
domain policy.
This narrows, but does not reverse, the `plans/machine-followup.md`
decision: concurrency and staleness _policy_ stay per-machine; transaction
_mechanics_ stop being reimplemented eleven ways.

## Rollout: nine PRs

The bundling rule: a PR may be wide only if it cannot change production
behavior (type-checked mechanical rewrites, test infrastructure). Anything
that changes runtime semantics stays small and bisectable. Heavier PRs
(1, 3, 5) compensate with deeper review (`/code-review ultra` or co-sim
trace comparison) rather than standard review.

### PR 1 — Types and test tooling (no prereqs)

Discriminated `TransitionResult` + `ignore`/`change`/`stay` constructors,
with the mechanical migration of all thirteen `transition.ts` files;
intrinsic contract validation in `driveTransitionMatrix` and
`exploreReachableStates`; explored-graph output; inventory-driven
reachability/producibility assertions; replay-grade vs debug trace split
and strengthened `replayTrace`. Wide but shallow: every change is either
compile-checked mechanical rewriting or test infrastructure, so the type
checker and existing transition suites are the reviewers. Must not change
production scheduling or notification semantics.

### PR 2 — Capability selectors (prereq: PR 1)

Capability selector convention + shared transition-consistency test kit,
adopted in `github_ops` and `version_preview` (the motivating consumers).
Kept out of PR 1 because it changes production behavior — previously
enabled no-op controls become disabled — and must be bisectable.

### PR 3 — Transactional dispatcher + first pilot (prereq: PR 1)

The dispatcher, timer/watchdog leases (with a minimal internal
lease-ownership scope; generalized in PR 5), the controller conformance
suite, and the `voice_to_text` pilot migration, in one PR: the conformance
suite is the dispatcher's spec and the pilot is its proof, so the
dispatcher never exists unexercised on main. Documents the exact commit,
projection, subscriber, observer, and command-start order. This is the
semantic-change boundary — it fixes the observers-before-commit ordering
for migrated machines — so it gets its own revert point and must not be
folded into Phase-1 work (#4028-class code may depend on the old order).

### PR 4 — Second pilot: `image_generation` + `screenshot` (prereq: PR 3)

Migrations with before/after trace comparison. Not folded into PR 3:
`screenshot` carries the #4058 regression class and its migration diff
must stay clean. Exercises timers, cancellation, and late async
completion (#4029, #4032, #4058 motivated these primitives).

### PR 5 — Scopes, disposal contract, composition roots (prereqs: PR 1; PR 3 for lease ownership)

`TaskScope` + `createLifecycleScope` with the disposal-ordering
guarantees; timer leases re-homed onto `TaskScope`; migration of timer-
and subscription-heavy adapters with disposal-during-await and
late-registration tests; composition-root construction at
`configureChatStream`-style call sites, adding the constrained
late-binding holder only where lifecycle genuinely requires it. The
primitives are inert until adopted and each adapter adoption is
individually revertable within the PR history.

### PR 6 — Invocation references + `chat_stream` migration (prereq: PR 1; PR 3 recommended for the conformance suite)

`InvocationRef` + correlation/claim helpers + canonical `stale-operation`
ignore reason, landed with their motivating consumer: the `chat_stream`
migration that retires hand-rolled `lastStreamIdByChatId`.

### PR 7 — `app_run` migration (prereq: PR 6)

Proxy-stdout parsing bound to the spawned process's invocation reference
(#3969). Deliberately not merged into PR 6: `chat_stream` and `app_run`
are the two highest-blast-radius machines and a correlation regression in
either presents identically ("acts on stale events") — separate PRs keep
the bisection boundary.

### PR 8 — Durable handoff design + pilot (prereq: PR 6)

The user-input → `chat_stream` handoff protocol: persistence location,
record shape, acceptance transaction, acknowledgement point, and
crash/reload sequence, proven against the real queue. Generalization into
a shared API is deferred until the pilot demonstrates the protocol — it
may never need its own PR.

### PR 9 — Observability polish + rules doc (no prereqs; rules rewrite lands last)

Trace sequence tiebreaker, per-entity-key rings, dev-gating
`__dyadMachines`, co-sim snapshot freezing and eager `result.state`
validation, the `registerAtomWriter` prod-throw decision, and the
`rules/state-machines.md` rewrite pointing rules at the new primitives
(alternatively, fold each rules-doc line into the PR that lands its
primitive and reduce this to the polish items).

### Dependency graph and parallelism

```text
PR 1 ──┬── PR 2
       ├── PR 3 ──┬── PR 4
       │          └── PR 5
       ├── PR 6 ──┬── PR 7
       │          └── PR 8
       └── PR 9 (polish anytime; rules rewrite last)
```

PR 1 unblocks everything. PRs 2, 3, 6, and the polish half of PR 9 can
proceed in parallel once it lands; the critical path is
PR 1 → PR 3 → PR 4/5 and PR 1 → PR 6 → PR 7/8.

The open-ended tail — migrating the remaining complex controllers
(`version_preview`, `github_ops`, `preview_iframe`, `connection_flow`,
`user_input`, `mcp_oauth`, `first_prompt`, `plan_handoff`) onto the
dispatcher — is not counted: those migrate only when they receive
substantive changes, with the conformance suite required for new
controllers and remaining custom runtimes tracked with documented
justified deviations.

Each PR follows the established pattern: kernel change + motivating
machine migration + named regression tests mirroring the original review
findings (the A→B→A→B dispose test and the co-sim bound-drain test set
the precedent).

## Success criteria

- Re-entrancy and command ordering are no longer implemented independently
  by each controller; observers never see uncommitted snapshots.
- Illegal ignored/applied result combinations are unrepresentable.
- Transition exploration automatically checks reference and result
  contracts; dead states and unproducible commands in explicit inventories
  fail tests.
- Wait states expose auditable progress metadata; timer leases are
  operation-correlated, replaced on relevant re-entry, and cancelled on
  every exit.
- UI capability flags are explicit domain selectors, and shared consistency
  tests prove enabled representative actions are accepted by the transition.
- Disposal-during-await cleanup uses one tested shared primitive; final
  projection hooks precede writer release when the domain declares a final
  projection.
- Invocation references cannot be confused across entity, producer, or
  controller lifetimes; stale claims route to a standard ignore reason.
- Cross-machine acknowledgement requires a committed durable acceptance
  record and idempotent receiver-side deduplication.
- New controllers inherit adversarial lifecycle and ordering tests without
  duplicating them.
