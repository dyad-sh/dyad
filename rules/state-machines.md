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
- When that purity requires a hand-written state type to duplicate an IPC zod
  schema, add a mutual-assignability assertion beside the schema so either
  definition drifting fails type-checking.
- A strict Zod object with a `message` field still accepts an `Error` instance
  through property lookup. Wire schemas that exclude `Error` objects must
  reject them before parsing the plain error-info object, and test that case.
- When a keyed wire transport decodes its key and event independently, keep
  events entity-relative. If an event must repeat entity identity, the
  per-definition admission boundary must validate it (and cancellation refs)
  against the decoded key; separate schemas cannot enforce that relationship.
- Cover the full state × event matrix with exhaustive switches and `never`
  checks. Deliberate no-ops must use shared `ignore(state, reason)` so they are
  distinguishable from omissions and observable in telemetry.

## Invariants

- Controllers migrated to `TransactionalDispatcher` use one event transaction:
  enqueue FIFO; run the pure transition exactly once; validate; reserve the
  command batch and any explicit post-commit outcome batch without running
  domain code; cancel exiting state-owned leases; commit the snapshot (the
  linearization point); update the authoritative projection; notify snapshot
  subscribers; notify transition observers; then publish the reserved outcomes
  and hand the reserved commands to the injected domain scheduler. Re-entrant
  callbacks may mutate transition-owned arrays, so both batches must be
  shallow-copied before callbacks. Re-entrant sends append to the FIFO and run
  after the current transaction. Ignored events skip commit, projection,
  subscribers, outcomes, and commands, but notify observers at the equivalent
  point in FIFO order.
- The dispatcher isolates and reports projection, subscriber, observer,
  scheduler, and command failures. Adapters convert expected command failures
  to typed domain events; unexpected throws/rejections may be mapped by the
  domain and never create a universal failure event. Scheduler injection owns
  concurrency policy.
- When a linearization boundary requires a synchronous return value, reject
  thenables whose runtime type is either `object` or `function`; callable
  functions can also define a `.then` property and be assimilated by `await`.
- A pre-commit lease-cancellation failure is also isolated and reported, but
  does not veto commit. Unlike pure transition and validation failures, an
  effectful cleanup hook may have partially completed; rejecting at that point
  would drop the event against a partially modified old state. Cancellation is
  required resource hygiene, while operation/state-instance token checks are
  the correctness backstop that rejects any stale callback which still fires.
- Recheck dispatcher admission after an effectful pre-commit hook. The hook can
  synchronously re-enter owner disposal; if it does, do not commit, notify,
  schedule commands, or report the current ticket as applied.
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
  Bounded dedup caches may evict settled history, never unresolved receipts;
  reject excess in-flight work through a separate bounded admission limit.
  Scope renderer retries to the stable window-session identity, not an
  ephemeral `webContents.id`, so reconnect cannot bypass deduplication. Start
  the retention window when the receipt settles, not when slow authorization
  begins, or a lost receipt can be immediately evicted after acceptance. Evict
  transient pre-admission transport-lifetime rejections after settlement, with
  an identity check against the cached entry, so reconnect can retry work that
  was never admitted while concurrent in-flight duplicates still coalesce.
  Compute the complete retry fingerprint before fresh actor admission: a
  matching retained receipt must replay after its subscription is released,
  while a fresh dispatch still requires an admitted subscription.
- Make remote subscribe/bootstrap idempotent per window, machine, and key.
  Resync and reconnect retries must refresh the bootstrap without incrementing
  ownership; projection/encoding failure rolls back only ownership acquired by
  that call. Coalesce concurrent retries of the same logical attach behind one
  pending quota reservation and admission result. Track pending attach identity
  so unsubscribe, window destruction, actor disposal, or transport disposal
  invalidates authorization still in flight; after every await, reject a
  cancelled or closed lifetime before admission. Renderer bootstrap applies both
  codecs and refuses disposed actor lifetimes, or failed retries and delayed
  responses can retain stale state.
- After asynchronous remote authorization, revalidate both the sender's window
  session and the actor instance/revision used for the decision. Re-authorize
  changed state only a bounded number of times (then reject it), and keep
  admission synchronous. Remote dispatch may address only an existing actor
  created by subscription and must lock admission to that actor instance.
- Remote key codecs need an explicit encoder as well as a decoder. Use the
  canonical encoded value in every wire envelope; never emit the decoded domain
  key, which may be transformed or non-serializable. A native intent contract's
  codec, encoder, and key identity function must also own renderer store
  identity plus inbound snapshot/disposal routing; mixing in the legacy key
  contract can silently drop native updates. Bound every untrusted
  envelope before its codec runs, including subscribe/unsubscribe addresses,
  and bound snapshot envelopes before delivery. Use a
  structured-clone-compatible byte measurement; JSON sizing is not
  wire-compatible with values such as `bigint`. When an existing domain payload
  legitimately exceeds the shared default, declare a bounded per-machine
  ceiling and enforce aggregate projected state below its snapshot ceiling.
- When a remote machine uses an object key, canonicalize it through the same
  interner used by main-process producers only after subscription authorization
  succeeds, then pass that canonical key to `ActorHost`. Its actor map is
  identity-keyed, but interning inside an untrusted wire decoder lets rejected
  entity IDs grow a process-lifetime cache. Post-authorization canonicalization
  must preserve the reserved encoded wire address; otherwise reject it or
  atomically re-key pending quota, subscription, disposal, and reference
  bookkeeping before admitting the actor.
- Remote authorization hooks use `DyadErrorKind.Auth` for expected access
  denial. Convert only that explicit classification to an unauthorized receipt;
  propagate unexpected hook failures so telemetry can distinguish dependency
  failures and bugs from ordinary refusal. A named domain-revision policy needs
  both an explicit renderer-observed domain token and a main-side resolver;
  never compare it with, or silently substitute, the actor snapshot revision.
- Capture receipt metadata synchronously when that dispatch ticket settles.
  Reading mutable actor metadata after awaiting the ticket can observe a
  re-entrant follow-up transaction instead of the acknowledged event.
- Machine-generated queued work must not be editable or removable (including
  through bulk-clear paths) unless removal explicitly settles or rejects the
  owning machine request; otherwise reload can resurrect abandoned work.
- Settle memory-owned requests on every destructive entity path, including
  parent-row cascade deletion, bulk deletion, and full reset—not only direct
  deletion of the child entity the request references.
- Before parent deletion snapshots child entities for settlement, fence new
  child creation and serialize the snapshot with each child's final insertion.
  Otherwise a late child can evade cleanup and disappear through the cascade.
- Register an in-memory request's disposal rejector before its first
  asynchronous admission await, and remove it in `finally`. Registering only
  before the terminal subscription leaves an admission-to-subscription race
  where owner disposal can strand the request forever.
- Model user-initiated owner rejection as a typed non-error facade outcome.
  Rejecting the transport promise routes successful cancellation through
  generic failure toasts/retry logic and can incorrectly acknowledge dispatch.
- If queue removal awaits owner settlement, first validate the optimistic
  revision and atomically claim/remove the invocation-time items so a rejected
  mutation has no external effect and the queue driver cannot start them.
  Restore failed owners, preserve items enqueued during the await, and surface
  settlement errors without aborting the whole clear.
- When a callback's direct caller owns rollback or restoration, settlement
  failure must reject that callback itself. Rejecting only a separate outer
  promise hides the failure from the component responsible for compensation.
- When changing a lifecycle facade from projecting failures in state to
  rejecting its returned promise, audit every event-handler and automatic
  fire-and-forget caller. Attach an explicit rejection consumer there while
  preserving rejection for callers that await the operation for sequencing.
- Do not persist machine-generated queue entries when their authority or
  acceptance callbacks are memory-only. Let the live authoritative registry
  rehydrate and re-enqueue them; a full restart must not restore orphan shells.
- `observeTransition` runs before a controller commits its next snapshot. If
  an observer callback can re-enter the machine (for example, by submitting a
  follow-up turn), defer that callback until the committed state is visible.
- In custom controllers that start an async command batch before committing,
  the batch executes synchronously through its first `await`. Defer any
  command callback that promises post-commit delivery (or reserve the batch
  until after commit), and test the snapshot observed inside the callback—not
  only the snapshot after the event returns.
- When a manager needs machine-specific observer behavior, compose it with the
  production trace observer (including ignored events) instead of replacing
  trace coverage.
- Command runners convert expected failures into events. A runner throw is a
  programming error: log it and keep the service usable; never wedge a queue or
  silently rewrite state.
- When a generation token suppresses superseded async probe results, apply the
  same token check to rejection handling. A stale failure must not emit a
  toast, settle newer state, or trigger recovery for the replacement probe.
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
- When destructive cleanup sends a cancellation terminal through an IPC sender
  other than the actor's observer, also settle the authoritative actor with the
  same correlated cancelled terminal; a silent handler return must not be
  synthesized as successful completion.
- Compensation on abort rolls back only what the aborted operation touched.
- When a multi-step side effect can fail partway through, retain the exact
  completed/next step in the failure state. Retrying from the start can repeat
  non-idempotent external work or deterministically fail on an existing-resource
  guard even when the owning entity is correctly reused.
- Controllers are disposable and their owner must call `dispose()` on provider
  unmount or entity deletion. Renderer controller collections belong to a
  provider-owned `KeyedControllerHost`; never keep them in module globals.
- Async keyed disposal must stop admission synchronously but keep the lifetime
  addressable until its final cleanup promise settles. Every disposal caller
  awaits that same barrier, and same-key recreation stays blocked behind it.
  If the key is still under synchronous construction, publish a keyed barrier
  that adopts the eventual actor cleanup rather than treating the missing map
  entry as already disposed. Publish the barrier before invoking any cleanup
  hook, and aggregate synchronous admission/timer cleanup failures behind it.
- Reserve a keyed lifetime before running definition factories. Factories may
  synchronously re-enter host admission; reject that re-entry rather than
  constructing a second owner that can be overwritten and leaked.
- Bulk or machine-scoped disposal must publish one collection barrier before
  snapshotting members and block new member admission until it settles. Enroll
  members whose synchronous construction began before the barrier but finishes
  after publication, suppress their buffered factory-time ingress, and await
  their cleanup as part of that same barrier. Reserve every snapshotted member's
  disposal cause before stopping any member: one member's injected cancellation
  hook may otherwise re-enter and claim another member's barrier with the wrong
  cause. If the definition remains registered, reopen admission only after
  final cleanup.
- Treat bounded retention as an edge-triggered deadline. Once a snapshot
  qualifies for delayed disposal, traffic that leaves it qualifying must not
  refresh the timer; cancel the deadline only when the authoritative snapshot
  stops qualifying.
- Reject bounded terminal-retention policies that do not provide a terminal
  classifier; otherwise the configured deadline can never become eligible.
- Retention scheduling must publish a provisional ownership token before
  calling the injected clock, then attach the returned handle only if ownership
  survived synchronous re-entry. Callbacks verify that token before acting, and
  cancellation clears it before touching the clock; a clock may re-enter or
  throw without physically removing the callback.
- Route every actor event ingress—including command and timer callbacks—through
  the host's shared enqueue wrapper. Bypassing it may preserve FIFO ordering
  while skipping retention, tracing, or other host-owned settlement bookkeeping.
- Register a newly constructed actor before draining events buffered by its
  factories, and recheck collection/key admission for every drained event.
  Disposal re-entered by the first event must be able to stop that actor before
  any later buffered event commits.
- After actor activation, recheck host, machine, and keyed admission before
  returning the reference. Activation can synchronously re-enter disposal
  through buffered observers or an injected retention clock.
- When a host passes live scopes or snapshot/send methods into definition
  factories, make factory-time access safe and construction failure-atomic.
  Dispose every acquired task/timer resource if any later factory step throws.
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
- When a cross-owner facade defers keyed delivery to a microtask, entity
  disposal must invalidate both queued and future deliveries for that key.
  Otherwise the deferred callback can recreate a controller after deletion.
- Producer callbacks that arrive after entity disposal must use a non-creating
  actor lookup. Never route late output through `ensure()`, which can recreate
  retained authority for a deleted entity.
- A keyed ownership replacement must adopt the incoming cleanup before running
  the previous cleanup. Otherwise a throwing unsubscribe/cancel can orphan the
  already-acquired replacement resource.
- If command adapters can be replaced while async setup is pending, late
  compensation must use the adapter captured when setup began. A fresh adapter
  lookup may release the wrong lifetime's resource.
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
- Do not include main-injected sender metadata in a renderer-computed immutable
  payload hash. Bind and validate that metadata separately during authorization,
  or compute the authoritative hash only after main supplies it.
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

## Read models and intents

- The former same-process Jotai projection compatibility layer was retired by
  `plans/cleanup-state-machines.md`. Do not reintroduce `projectToAtom`,
  `registerAtomWriter`, or another lifecycle-mirroring helper. Renderer
  consumers read the owner snapshot through domain hooks and pure selectors.
- Cross-process actors expose a named, serializable read model. Each renderer
  window owns its subscription/bootstrap adapter and treats unavailable or
  pre-bootstrap data as non-authoritative. The adapter may cache the remote
  snapshot for `useSyncExternalStore`; it must not create a second writable
  lifecycle authority in Jotai.
- Renderer actions cross the owner boundary as typed facade intents. Intent
  admission, transition commit, command completion, and durable acceptance are
  distinct outcomes; expose the narrow receipt or settlement signal the caller
  actually needs.
- Manager admission and transition application are separate facts. Before
  deleting an admission-gated side channel, characterize admitted events that
  the transition deliberately ignores (including startup, shutdown, and
  compatibility routing); preserve any observable data in an owner-scoped read
  model unless changing those transitions is explicitly in scope.
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
- A remote dispatch receipt proves transport admission, not runtime completion.
  When callers sequence work on the outcome, project a bounded,
  operation-correlated settlement acknowledgment. Superseded completions must
  settle their original waiters without advancing the current lifecycle.
  Keep the request correlation ID separate from a reused runtime invocation
  identity (for example, an idempotent ensure-running request targeting an
  existing process), and subscribe before the final settlement recheck so a
  completion cannot land between the initial read and listener registration.
  Track every in-flight request, not only the latest: a reused invocation can
  be superseded before its producer settles, but its original waiter must
  still complete. A producer sink captured for one invocation must also ignore
  or overwrite any conflicting invocation identity supplied by its payload.
- A first-response-wins renderer handoff needs a correlated claim, not a
  boolean. Matching follow-ups may be revision-stale only when the opaque claim
  ID is validated by the host. Unrelated reconciliation must not release the
  claim, and renderer loss needs an owner signal or bounded actor-owned expiry.
  Clear claimant-local identity in `finally` when a matching settlement
  dispatch fails, because actor expiry cannot clear renderer memory. If the
  claimant creates a durable resource before host acknowledgement, delete it
  when acknowledgement fails or the claim expires.
- An unavailable/bootstrap remote snapshot is not authoritative idle state.
  Gate every actor-backed capability on a ready connection and defer recovery
  dispatches until subscription bootstrap has completed. Cleanup dispatched
  while navigating away must temporarily retain the old actor, resync stale
  revisions, and retry with the same stable operation identity; losing an exit
  intent can leave the external resource under hidden retained ownership.
- When window-local presentation controls a shared external lifecycle, track
  explicit per-window interest in main and clean up only when the last owner
  explicitly releases it. Window destruction should drop stale interest without
  triggering cleanup when the actor is designed to survive renderer reloads.
- A safe remote projection contains only domain facts needed by consumers.
  Keep window-local presentation fields out of the authoritative snapshot and
  route one-shot toast/navigation outcomes to the initiating window. Publish
  durable query scopes separately so every attached window converges. At the
  renderer boundary, explicitly recombine the local presentation snapshot with
  every remote lifecycle state, including transient command states; otherwise a
  correct domain transition can silently reset the visible pane or selection.
- Apply presentation for a remotely adjudicated selection only after an
  applied receipt, and serialize rapid selections through resync. Suppressing
  an earlier accepted presentation merely because a later stale dispatch is
  pending can leave the UI disagreeing with the external resource.
- Treat an operation ID's initiating window as a first-writer ownership claim.
  A duplicate intent from another window must not overwrite that routing entry,
  even if the duplicate transition will later be ignored.
- Authorization can run before revision admission. Keep any presentation
  ownership recorded there tentative and expire it unless an applied
  transition confirms the claim; rejected stale dispatches never reach actor
  observers and otherwise leak bounded routing capacity.
- Do not hide local presentation for a cleanup intent until main accepts the
  exit (or already reports a safe terminal state). Resync and retry stale
  cleanup receipts with one operation ID so a hidden pane cannot mask retained
  external ownership.
- Keep transport revisions separate from semantic presentation epochs. A
  revision may advance for bookkeeping-only transitions, while a reload token
  must advance exactly once for each user-visible remount.
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
- A remote renderer adapter must preserve the legacy terminal side-effect
  contract as well as lifecycle state: query invalidations, authoritative
  message refresh, preview-open policy, reload/capture requests, and settlement
  callbacks all belong in the completion projection.
- When seeding a retained-completion cursor from bootstrap, skip only receipts
  that have no matching local in-flight request. A matching receipt must take
  the normal completion path or its waiter and terminal side effects are lost.
- Main-owned work must report terminal settlement through a main-owned observer
  or return path. Renderer delivery is best-effort: a destroyed `WebContents`
  can make `safeSend` a no-op and must not strand the authoritative actor.
- `useSyncExternalStore` snapshots must be referentially stable between store
  changes. If an adapter overlays optimistic admission on a remote snapshot,
  cache the projected object by base snapshot and operation identity instead of
  allocating a new object from every `getSnapshot()` call.

## Persistence and hydration

- Model hydration explicitly when persisted state gates machine behavior.
  Persist through an adapter-owned, debounced command using a versioned zod
  schema; do not let components write snapshots independently.
- When a side effect can make recovery state externally observable (for
  example, detaching Git HEAD), force and await persistence of the exact
  committed checkpoint before starting it. Observer error isolation must not
  allow the side effect to run after that checkpoint fails.
- A checkpoint immediately before a destructive step means that step may have
  started. Restart reconciliation must not infer "not started" from one
  unchanged external fact such as Git HEAD; validate every relevant identity
  and mutable surface (for example branch, HEAD, and user-visible index/tree),
  and classify failure from the last effect boundary that may have crossed.
- A durable `completed` checkpoint must follow every authoritative effect, not
  just the primary one. If a workflow mutates Git and then SQLite, persist an
  explicit post-Git/next-database step until the database mutation finishes.
- Define merge/replacement semantics for events received during hydration.
  On teardown, flush the latest accepted snapshot through a transport that is
  safe for the lifecycle boundary (for example, one-way IPC during pagehide).
- Entity deletion must fence new command admission before waiting for the
  entity lock. Recheck the fence inside the lock, stop actor admission before
  unrelated awaited cleanup, and make actor disposal flush every admitted
  command before database or filesystem deletion.
- Deletion settlement tracks the full command-runner continuation, including
  post-handler lifecycle work and the terminal event that may synchronously
  enqueue compensation. Waiting only for the low-level handler promise can
  dispose the actor before its compensating command exists.
- A persisted main-owned recovery actor must reconcile its domain facts with
  the external resource before accepting new mutations after restart. Treat
  matching origin state as closed and detached/divergent state as explicit
  recovery; never serialize command handles or renderer presentation state.

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
  behavior. A command fixture may change domain state,
  but its test adapter must model that real transition and expose the
  controller's real snapshot. Disposal assertions compare with the snapshot
  captured immediately before disposal; never normalize or fabricate snapshots
  to make them pass.
- Normalize discovered file paths to `/` and sort filesystem-derived
  inventories before asserting literal repository paths. `path.relative()`
  returns `\` on Windows CI, and directory enumeration order differs by
  filesystem and case-sensitivity.
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
- Boundary allowlist tests must derive the actual production call sites and
  exact-compare them with the declared inventory. Checking only that declared
  markers still exist does not prevent an undeclared boundary crossing.
  Classify calls through the owning API (for example, Jotai stores and hooks),
  not an expected import directory; domain values may be local or re-exported.
- When adding an intentional completion-aware `dispatch` or `enqueue` framework
  path, classify it in the boundary inventory separately from raw compatibility
  escape hatches; do not widen the raw allowlist to make the inventory pass.
- Keep host-only distributed-machine definitions outside shared machine
  directories (for example, under `src/ipc/services/` for a main-owned actor).
  Shared machine directories are scanned as renderer-reachable code and may
  not import IPC, Electron, or WindowRegistry internals. Add every intentional
  distributed-machine consumer to the exact inventory in
  `src/distributed_machines/boundaries.test.ts`.
- Keep remote transport test doubles behind an existing domain test-support
  facade. Renderer and hybrid harnesses may consume that facade, but must not
  widen the allowlist of production modules that import transport internals.
- When a test definition uses the native `remoteIntent` contract, inject
  authorization races through `remoteIntent.authorizeSubscribe` or
  `remoteIntent.authorizeDispatch`. Replacing the legacy `remote.authorize*`
  hooks exercises only compatibility definitions and can leave a native test
  gate waiting forever.
- Keep native remote-admission revalidation out of the protocol-v1
  compatibility adapter until a domain migrates. Moving trusted conversion or
  adding a second revision fence to legacy dispatch can change terminal
  delivery even when the wire envelope is unchanged; cover a representative
  legacy streaming integration when editing the adapter. Preserve the adapter's
  bounded re-authorization when an allow-stale event races an actor revision;
  exact captured-revision rejection belongs to the native prepared path.
- Model StrictMode subscriber replay and explicit subscription leases as
  different ownership classes. A shared subscriber lease may use a
  replacement generation, while every explicit `retain()` needs its own live
  token so releasing one owner cannot retire or leak another. A lease created
  before the owning client/provider starts must let `ready` adopt that startup
  bootstrap, and an in-flight completion retain must count as transport
  interest during connection replacement and disposal teardown.
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
- Capturing keyed admission before authorization must not allocate permanent
  per-key gate metadata. Use a shared open generation (or explicitly release
  the capture) so rejected, attacker-controlled keys cannot grow a
  process-lifetime map.
- When a fence snapshots work admitted before publication, settlement must
  remove that work from the current fence's drain set even though no fence
  existed when tracking began. Test this with controlled pre-fence work; a
  tracker that cleans up only its originally captured fence can strand sealing.
- A command runner that returns `void` after starting asynchronous work has not
  provided a fence-trackable completion boundary. Until that compatibility path
  adopts a completion promise or explicit tracked lease, destructive fencing
  must fail closed rather than treating the handoff as command completion.
- Prepared admission must revalidate after the last trusted synchronous domain
  callback, not merely after asynchronous authorization. Revision policies,
  intent conversion, and similar callbacks can reenter fencing, subscription,
  or disposal code before final host admission.
- Treat supersession settlement listeners as synchronous domain callbacks.
  Revalidate after they run and roll back any replacement registration before
  enqueue if they fence, replace, or dispose the intended actor.
- A transport disconnect does not prove that authoritative admission failed.
  Preserve delivery/admission ambiguity across retry and disposal; only a
  failure classified at a definitely-pre-delivery boundary may settle as
  `not-admitted`.
- If terminal outcome or receipt construction throws, reject or explicitly
  fail the exact correlated registry entry and continue bulk disposal. Never
  leave callback-construction failures pinned as unresolved work.
- A fresh subscription or actor-reference acquisition must assert that keyed
  admission is open even when it retains an existing actor. Generation equality
  alone is insufficient because work prepared after fencing captures the
  current closed generation.
- Revalidate fence identity and phase after invoking a drain-admission policy.
  The policy is synchronous domain code and can reenter sealing, abort, or
  replacement before returning.
- Construction continuations enrolled for fencing must settle on every
  post-activation exit, including host or machine disposal triggered by buffered
  factory-time ingress, or a later fence can wait forever. Keep factory-buffered
  events bound to that construction admission; if fencing publishes before
  activation, do not reclassify them as cleanup allowed during draining.
- Disposal of an admission primitive is terminal. Clearing current records
  without a persistent disposed state lets retained references recreate open
  admission after host teardown.
- If a scheduler retains an execution callback and then throws or rejects, the
  retained callback must be invalidated. Marking the batch failed while still
  allowing that callback to run lets command side effects escape after sealing.
- A revision-bound producer sink that supports sequential emissions must
  advance its expected revision in the dispatcher's synchronous settlement
  callback. Updating only from `ticket.settled.then(...)` is too late when an
  async command continuation resumes before that Promise reaction. Events
  buffered during synchronous construction must retain the same mutable
  per-sink revision cursor so activation can advance the sequence after each
  replayed event.
