# Hardening Dyad State Machines

## Status

Proposal only. This document records correctness lessons from the recent
state-machine migration and recommends shared infrastructure that can make
future machines robust by construction. It does not authorize implementation
or require existing machines to migrate mechanically.

## Scope and conclusion

This review covered 30 state-machine implementation PRs merged between
2026-07-21 and 2026-07-23, primarily authored by `keppo-bot`, together with
the two `wwwillchen` planning PRs:

- [#4017 Machines detailed plan](https://github.com/dyad-sh/dyad/pull/4017)
- [#4042 Machines plan progress](https://github.com/dyad-sh/dyad/pull/4042)

The migration's domain modeling is generally strong. Pure transitions,
explicit commands, reference-stable snapshots, provider-owned managers, and
structured ignored-event telemetry are all sound foundations.

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
- durable acknowledgement across machine boundaries.

Those mechanisms were deliberately excluded from the initial micro-kernel in
[#4014](https://github.com/dyad-sh/dyad/pull/4014). The subsequent PR
iterations provide enough evidence to revisit that boundary. The recommended
direction is not a framework that owns domain policy. It is a small shared
runtime that owns event transaction mechanics while leaving state shape,
concurrency policy, and staleness policy domain-specific.

## Evidence from PR iterations

Most serious review findings were not missing transition cases. They came from
orchestration surrounding otherwise reasonable transition tables.

| Failure class                                                        | Representative iteration                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Re-entrant events reordered commands                                 | [#3969 review](https://github.com/dyad-sh/dyad/pull/3969#discussion_r3607908235)         |
| An async command wedged a serial queue                               | [#3968 review and fix](https://github.com/dyad-sh/dyad/pull/3968#discussion_r3607899376) |
| A synchronous runner throw left a machine permanently pending        | [#4029 review](https://github.com/dyad-sh/dyad/pull/4029#discussion_r3628359815)         |
| A callback observed stale state                                      | [#4028 review](https://github.com/dyad-sh/dyad/pull/4028#discussion_r3628323130)         |
| A local generation was mistaken for a globally unique identity       | [#4031 review](https://github.com/dyad-sh/dyad/pull/4031#discussion_r3631552691)         |
| Late async setup escaped disposal                                    | [#4021 review](https://github.com/dyad-sh/dyad/pull/4021#discussion_r3627971018)         |
| Terminal settlement depended on a fallible ancillary command         | [#4033 review](https://github.com/dyad-sh/dyad/pull/4033#discussion_r3628590963)         |
| A wait state was entered without reinstalling its progress mechanism | [#4058 review](https://github.com/dyad-sh/dyad/pull/4058#discussion_r3636307586)         |
| Command data was ignored in favor of stale React closure state       | [#4059 review](https://github.com/dyad-sh/dyad/pull/4059#discussion_r3636261590)         |
| Cross-machine queued work lacked durable ownership and settlement    | [#4047 review](https://github.com/dyad-sh/dyad/pull/4047#discussion_r3633885316)         |
| Teardown order dropped the final projection update                   | [#4045 review](https://github.com/dyad-sh/dyad/pull/4045#discussion_r3633712105)         |
| UI treated dispatch as success and destroyed retryable input         | [#4061 review](https://github.com/dyad-sh/dyad/pull/4061#discussion_r3639891573)         |

The present implementation also shows controller-semantic drift:

- Only four of the eleven controllers or registries using
  `observeTransition` have an event re-entrancy buffer.
- All eleven call observers before committing the next snapshot.
- Command execution ordering varies by controller.
- Some runners execute serially and others directly, with different
  synchronous-throw and asynchronous-rejection behavior.
- Transition contract validation runs only when each test suite remembers to
  invoke it.

The state-machine rules have absorbed many of these lessons. The next step is
to move the most universal rules into types, runtime mechanics, and reusable
tests.

## Proposed improvements

### 1. Transactional event dispatcher

Add a small shared dispatcher that owns one event transaction:

1. Append the event to a FIFO.
2. Run the pure transition exactly once.
3. Validate the transition result.
4. Stage commands without starting them.
5. Commit the snapshot.
6. Notify projections, subscribers, and observers in one documented order.
7. Start the staged command batch.
8. Process synchronously emitted or re-entrant events afterward.

Required guarantees:

- An observer, listener, or synchronous command emission never processes an
  event against an uncommitted snapshot.
- Commands derived from event B cannot overtake commands derived from event A.
- Re-entrant dispatch is always FIFO.
- A runner exception cannot wedge the dispatcher.
- Disposal stops event admission and late emissions consistently.

The dispatcher must not choose domain concurrency. A domain should still
inject its command scheduler and decide whether commands run serially,
concurrently, or as independently tracked operations.

### 2. Discriminated transition results

Replace the optional `ignoredReason` result shape with a discriminated union:

```ts
type TransitionResult<State, Command, Reason> =
  | {
      kind: "ignored";
      state: State;
      reason: Reason;
    }
  | {
      kind: "applied";
      state: State;
      commands: readonly Command[];
    };
```

Provide constructors with unambiguous semantics:

- `ignore(state, reason)`
- `change(nextState, commands?)`
- `stay(state, commands)` for an applied command-only transition

This makes it impossible to attach commands to an ignored event accidentally,
and distinguishes deliberate command-only transitions from implicit no-ops.

### 3. Automatic transition-contract validation

Strengthen `driveTransitionMatrix` and `exploreReachableStates` so callers do
not need to reproduce the same validation loop.

Both helpers should assert:

- ignored transitions retain the exact state reference and emit no commands;
- an applied value-equal state reuses the previous reference;
- every transition returns a valid discriminated result;
- duplicate state keys represent values the domain considers equivalent;
- failures identify the source state, event, result, and explored path.

`exploreReachableStates` should return the explored graph, including edges and
predecessors, rather than only a state array. This would make counterexamples
and coverage gaps much easier to diagnose.

### 4. Progress-obligation testing

Add an optional way for a machine to describe how each non-terminal state can
make progress. For example:

```ts
{
  state: "waitingSelectorReady",
  progressBy: ["timer:settle", "external:selector-ready"],
}
```

The exploration tooling should reject reachable non-terminal cycles that
have:

- no scheduled command or timer;
- no live external operation;
- no watchdog;
- no explicitly declared wait for user or external input.

This targets machines that enter a valid state but lose the timer,
subscription, callback, or acknowledgement needed to leave it. It would have
caught the screenshot reload race from #4058.

### 5. Shared task and resource scope

Introduce a reusable `TaskScope` or `ResourceScope` for:

- keyed subscriptions;
- timers;
- pending async registrations;
- cancellable operations;
- cleanup functions.

Suggested operations:

```ts
scope.replace(key, cleanup);
scope.remove(key);
scope.trackPromise(promise, lateCleanup);
scope.dispose();
```

Registering a cleanup after the scope has already been disposed must run that
cleanup immediately. `dispose()` must be idempotent.

Timer helpers should use the shared `Clock`. This scope should encapsulate the
pattern where disposal cleans up immediately and also cleans up external state
that appears after an awaited operation settles.

### 6. Standard operation identity and correlation

Prefer stable operation identities minted by `IdSource` over controller-local
numeric generations:

```ts
type OperationToken<Kind extends string> = {
  kind: Kind;
  id: string;
};
```

The complete token should cross every relevant IPC, queue, and persistence
boundary. Entity identity should remain a separate explicit field rather than
being inferred from the operation counter's scope.

Provide shared helpers for:

- matching completion events to active operations;
- recording superseded tokens;
- settling superseded waiters without applying stale state;
- constructing composite registry keys;
- retaining bounded cancellation tombstones for late completion.

### 7. Durable cross-machine handoff

Create a shared primitive for workflows where one machine submits work to
another and waits for acknowledgement:

```text
created -> durably accepted -> executing -> acknowledged
                       \-> rejected or settled
```

The primitive should require:

- a stable idempotency key;
- durable receiver-side deduplication;
- acknowledgement only after durable acceptance;
- typed ownership on machine-generated queue entries;
- removal or bulk-clear behavior that explicitly rejects or settles the
  owner;
- no persistence when authority or callbacks are memory-only.

An injected facade remains the composition boundary, but this primitive would
make reload-safe acceptance and settlement part of the implementation rather
than a convention.

### 8. Controller conformance suite

Every controller runtime should pass the same adversarial suite:

- an observer dispatches re-entrantly;
- a subscriber dispatches re-entrantly;
- a command emits synchronously;
- a runner throws synchronously;
- a runner rejects asynchronously;
- the controller is disposed while a command awaits;
- a command emits after disposal;
- a key is disposed and recreated while stale events remain;
- a manager undergoes StrictMode replay;
- a manager undergoes rapid A -> B -> A -> B replacement;
- final projection cleanup occurs before writer release.

Domain controller tests would remain responsible for domain behavior. The
conformance suite would prove the shared execution and lifecycle contract.

### 9. Stronger trace replay

`replayTrace` currently trusts a recorded ignored marker and skips the
transition. Replay should instead execute every event and verify:

- the ignored/applied classification;
- the ignored reason;
- the resulting state key;
- the command descriptions.

Where deterministic replay matters, trace timestamps should use an injected
clock. A replay mismatch should report the shortest divergent prefix.

## Non-goals

The shared runtime should not:

- prescribe state shapes or phase names;
- decide which stale events are safe to drop;
- force all commands to run serially;
- infer durability from renderer-local state;
- hide domain-specific recovery policy;
- replace explicit protocol or co-simulation models for cross-process flows;
- require an immediate migration of existing stable machines.

The goal is to genericize linearization, lifecycle mechanics, correlation
mechanics, and verification—not domain policy.

## Rollout

### Phase 1: Types and test tooling

- Introduce the discriminated transition result.
- Add transition constructors.
- Make contract validation intrinsic to matrix and reachable-state helpers.
- Return explored graphs with diagnostic paths.
- Strengthen trace replay.

This phase should not change production scheduling semantics.

### Phase 2: Transactional dispatcher pilot

- Implement the dispatcher and conformance suite.
- Document the exact commit, observer, subscriber, and command-start order.
- Pilot it on `voice_to_text`, `image_generation`, and `screenshot`.
- Compare traces and existing tests before and after migration.

These machines are bounded enough to exercise synchronous emission, timers,
cancellation, and late async completion without beginning with the most
complex chat workflows.

### Phase 3: Resource scopes

- Add the shared task/resource scope.
- Migrate timer- and subscription-heavy adapters.
- Add disposal-during-await and late-registration tests.
- Ensure every manager and scope has idempotent teardown.

### Phase 4: Correlation and durable handoff

- Introduce operation tokens and correlation helpers.
- Use them for new IPC-spanning operations.
- Implement the durable cross-machine handoff primitive.
- Migrate the next workflow that needs reload-safe machine-to-machine queued
  work instead of mechanically rewriting existing flows.

### Phase 5: Incremental adoption

- Migrate complex existing controllers only when they receive substantive
  changes.
- Require the conformance suite for newly constructed controllers.
- Track remaining custom controller runtimes and document justified
  deviations.

## Success criteria

The proposal is successful when:

- re-entrancy and command ordering are no longer implemented independently by
  each controller;
- illegal ignored/applied result combinations are unrepresentable;
- transition exploration automatically checks reference and result contracts;
- wait states can be audited for an explicit progress mechanism;
- disposal-during-await cleanup uses one tested shared primitive;
- operation IDs cannot be confused across entity or controller lifetimes;
- cross-machine acknowledgement requires durable acceptance;
- new controllers inherit adversarial lifecycle and ordering tests without
  duplicating them.
