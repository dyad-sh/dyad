# B2 — Machine definition + local ActorHost kernel

Implement B2 of plans/cleanup-state-machines.md ("Phase B — B2"). The
plan wins; the detailed design source is plans/distrbuted-machines.md
("Machine definition API", "Actor host", "Dispatch tickets", "Local actor
references", "Lifecycle policy") — read both before coding. Prereq: B0
ADR (lifecycle matrix, intent classes).

Scope (synthetic machines only — no production domain migrates here):

1. DistributedMachineDefinition: pure transition + runtime metadata +
   host placement + scheduler/command-runner factories + lifecycle
   policy; optional persistence/remote contracts are TYPES only in this
   PR (implementations come with B3/C waves). Avoid elaborate type-level
   inference — clear generic annotations over a clever DSL (the
   distributed plan says this explicitly; honor it).
2. Actor identity: actor instance ID (new per lifetime), snapshot
   revision (increments only on snapshot reference change), transaction
   sequence (every processed event including ignored). These compose the
   existing InvocationRef; they do not replace it.
3. ActorHost: keyed ensure/peek/disposeKey/disposeMachine/dispose over
   the existing TransactionalDispatcher, TaskScope, TimerLeaseScope, and
   trace infrastructure — the distributed layer COMPOSES
   src/state_machines/ primitives, never duplicates them (boundary test
   asserting this).
4. Dispatch tickets: dispatcher.enqueue(event) → ticket settling
   applied/ignored/failed/disposed for its exact FIFO entry, per the
   distributed plan's requirements list (re-entrant enqueue settles on
   its own turn; disposal settles all unprocessed; command failure after
   commit never rewrites an applied ticket; send() remains the
   ticket-discarding wrapper). This modifies the shared dispatcher —
   isolate it in its own commit with the dispatcher's conformance suite
   extended first.
5. Local actor refs (getSnapshot/subscribe/send, synchronous enqueue
   preserved) + the selector-aware hooks from A1 working against them.
6. Actor lifecycle policies from the matrix (subscription-creates,
   dispatch-creates, idle eviction, terminal retention, entity-deletion,
   shutdown flush) + the ordered disposal sequence (stop admission →
   settle waiters → terminal projection → cancel tasks/timers → flush →
   unsubscribe → dispose dispatcher).
7. Host conformance suite covering the distributed plan's "Local host
   conformance" list, runnable against any hosted actor.

Verify: typecheck, full unit tests (dispatcher conformance + new host
conformance + negative tests), lint, golden suite untouched-and-green.
/deep-review. Branch cleanup-b2-actor-kernel; /pr-push; update plan
status. Separate revert point: nothing outside src/state_machines/ and
the new module depends on this PR yet.
