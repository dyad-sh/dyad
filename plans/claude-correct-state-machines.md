# Correct State Machines by Construction — Wave 2

## Status

Proposal. Successor to `plans/state-machines-hardening.md`, which analyzed
the 2026-07-16 → 07-23 migration wave and proposed the shared kernel
primitives. Those primitives shipped: `TransactionalDispatcher`,
discriminated `TransitionResult`, `InvocationRef`, `TimerLeaseScope`,
`TaskScope`/`lifecycle_scope`, capability-consistency tests, conformance
suites, co-simulation, and replay-grade traces all exist in
`src/state_machines/` today.

This plan synthesizes the review threads and fix-commit iterations of the
next wave — the distributed-actor migration merged 2026-07-25 → 07-28
since `1014afff` — kernel/infra (#4086, #4090, #4097, #4100, #4102,
#4104, #4105, #4106), codecs and services (#4092, #4093, #4095, #4098,
#4099, #4101), authority moves (#4108, #4109, #4116, #4119, #4121, #4122,
#4123), deletions (#4109, #4117, #4120), and semantics fixes (#4126) —
plus the ADRs (#4096, #4103).

## Scope and conclusion

The Wave-1 bet paid off where it was placed. Across ~150 review findings
in this wave, almost none were pure-transition bugs: the discriminated
results, exhaustive matrices, reference-stability validation, and
transition test kits held. The churn moved **one layer up**, into exactly
the territory the distributed migration opened:

1. **Async admission windows.** State checked before an `await`
   (authorization, bootstrap, construction, activation) was stale when
   the continuation committed. The single largest class by HIGH count.
2. **Settlement waiters.** Every machine hand-rolls promise waiters
   correlated to operations, and at least four machines independently
   made the same three mistakes (register-after-await, resolve-on-failed-
   outcome, never-settled-on-disposal). Reviewers cite
   `rules/state-machines.md` L307–329 by name — the invariant is
   documented, not constructed.
3. **Entity-deletion/reset fences.** Each feature re-derived its own
   fence with a new hole: missing entirely, lifted too early, installed
   before cancellation could drain (deadlock), bypassed by main-internal
   dispatch, by subscription-creates-actor, or by late producers calling
   a creating `ensure()`.
4. **Fire-and-forget dispatch.** `revision-conflict`/`stale-actor`
   receipts silently discarded (~13 findings across six PRs); UI mutated
   local presentation before the receipt arrived.
5. **Copy-paste remote managers.** The subscribe/bootstrap/release
   lifecycle was re-implemented per machine, and the same StrictMode
   unmount race was found and fixed twice (chat_stream, then
   plan_handoff).
6. **Durable side effects straddling ephemeral actors.** plan_handoff
   took three review rounds to get checkpointing right; the queue CAS in
   chat persistence took ~6 iterations; claims/compensation in
   github_ops and version_preview repeated the shape.

The conclusion mirrors Wave 1's: the invariants that recur across every
machine must move from `rules/state-machines.md` prose into kernel types,
runtime mechanics, and conformance tests — enforced by construction
instead of by reviewer. The rules doc is load-bearing (bots cite it by
line in nearly every finding), which is precisely the evidence that these
are framework invariants wearing convention costumes.

## Evidence: failure classes ranked by severity × recurrence

Every item is a real review comment or fix iteration from this wave.

### E1. TOCTOU across await boundaries (kernel + transport)

- #4105: sender destroyed during pending `authorizeSubscribe` → stale
  ownership recorded, no-subscriber eviction blocked forever (HIGH);
  unsubscribe-during-pending-subscribe installs a dead subscription;
  dispatch authorization inspected state, awaited, then acted on a
  different actor instance.
- #4100: actor `activate()` re-entering dispose via the injected clock
  after admission checks ran; disposal missing actors in synchronous
  construction (three variants); key removed from the host map before
  `finishDisposal` completed, letting a replacement overlap the old
  lifetime (HIGH).
- #4102: high-volume attach continuation unguarded against detach during
  `await bootstrap()`; superseded-generation payloads flushed after the
  replacement's bootstrap.
- #4106: a stale bootstrap resolving late released the _newer_
  generation's shared subscription.
- #4108: waiter registered after the first await, so disposal in the gap
  was missed; #4119: `waitForChatActorIdle` read the snapshot before
  registering its listener (P2 — "mirrors the settlement-waiter
  invariant").
- Recurring fix shape, invented independently each time:
  capture-then-revalidate, generation tokens, register-before-await.

### E2. Settlement-waiter correlation and lifecycle

~15 findings across #4108, #4109, #4119, #4123:

- Waiters keyed to a reused invocation instead of the request: `START`
  from `ready` reused the runtime invocation, so `PROCESS_SPAWNED`
  settled under the old operation ID and leaked the new waiter — three
  fix iterations in #4108 alone before request-operation-ID queues
  landed.
- Waiters resolved on failed outcomes: `PROCESS_FAILED` fulfilled
  `runApp`/`stopApp` promises (flagged three times independently).
- Disposal/reset never settling outstanding waiters (#4108 app deletion,
  Reset Everything; #4116).
- Legacy IPC tickets settled at admission instead of completion.

### E3. Entity-deletion and reset fencing

~14 findings across #4108, #4116, #4119, #4121, #4123:

- Missing: Reset Everything skipped actor disposal (#4108); no
  githubOpsService fence during resetAll (#4116).
- Lifted too early: GitHub reset barrier released while DB deletion still
  ran (#4116); actor-disposed published before the destructive delete
  succeeded (#4116, #4119).
- Installed too early: the chat deletion fence blocked the very CANCEL
  needed to drain the stream — deletion hung (P1, #4119).
- Bypassed: main-internal `localRef` dispatch skipping the fences
  `authorizeDispatch` enforces (P1, #4119); subscriptions recreating
  actors mid-deletion (#4119, #4123); late producer callbacks
  resurrecting disposed actors via creating `ensure()` (#4108);
  `disposeMachine` leaving new-key admission open during async cleanup
  (#4100).
- Reviewer asks, verbatim shape: "a deletion tombstone or a non-creating
  lookup" (#4108); "recheck the deletion/reset fence at the final
  synchronous admission point immediately before actor creation, such as
  key canonicalization" (#4123).

### E4. Fire-and-forget dispatch and discarded receipts

~13 findings across #4108, #4109, #4116, #4119, #4121, #4123:

- `sendWithoutReceipt` discarding `revision-conflict` — GitHub sync,
  disconnect, and branch mutations silently no-oped (#4116).
- Version preview: `APP_CHANGED` ignoring conflict receipts left the
  repo on a historical checkout (MEDIUM + P1 duplicate); `CLOSE` hid the
  pane locally before the dispatch was accepted (#4123).
- Stale-snapshot fallback: queue mutations omitted the rendered
  revision, so `dispatchQueueEvent` fell back to the latest revision and
  a stale Clear could delete prompts the user never saw (HIGH, #4120).
- Image generation: `start()` returned before the receipt; the dialog
  closed and the prompt cleared on rejection; no in-flight guard →
  double-click duplicated generations (#4121).
- Two-window `revision-conflict` surfacing as an unhandled rejection
  instead of resync-and-retry (#4109).

### E5. Remote subscribe/bootstrap/release lifecycle

#4108, #4119 (5+ findings), #4123:

- Observer-only windows never called `start()` on the client — one
  bootstrap snapshot, then silence (HIGH, found in `chat_stream` _and_
  plan_handoff managers).
- Dispatch overtaking subscribe on first submit → `stale-actor` (P1);
  fixed by awaiting bootstrap before dispatch, per machine.
- StrictMode unmount/remount release retiring a newer attach — the
  deferred-microtask fix was implemented in chat_stream, then the same
  bug was found in plan_handoff ("defer or generation-tag this release
  like the chat stream manager does").
- Failed bootstrap promise cached and re-awaited forever; subscription
  released on dispatch receipt so the terminal snapshot never arrived
  (P1); per-app subscriptions never released → 256 viewed apps exhaust
  the per-window quota (#4108).

### E6. Durable side effects across ephemeral actors

- plan_handoff (#4119): `accepted` persisted pre-admission → restart
  hides accept buttons with nothing running (P2, three rounds until
  draft → admitting → accepted checkpointing); post-admission metadata
  failure marked the handoff failed so retry duplicated the run (HIGH);
  compensation raw-deleted chats without disposing their actors (HIGH);
  second-resolution timestamp ties rehydrated the wrong row.
- Queue CAS (#4119, ~6 iterations): owner settlement before revision
  validation; rejected clears with already-settled side effects;
  revision advanced in DB while the actor kept the old revision
  (permanent conflict loop); queue head editable during async admission
  so a removed message still executed (HIGH).
- github_ops claims (#4116): routine reconciliation released the
  conflict claim mid-flight → duplicate AI conflict chats (P1); chat
  created before the STARTED ack, orphaned on expiry.
- #4101: mid-flight cancellation _reversed_ during review — tombstoning
  after a destructive mutation began was worse than completing; final
  semantics: cancel pre-start only, then emit the real settlement.

### E7. Idempotency, dedup, and replay

- Intent hash computed over pre-codec JSON while the IPC codec reorders
  keys (P1, fixed with one schema-validated canonical serializer);
  injected `originWindowSessionId` breaking the hash (HIGH, two rounds);
  edited queue entries keeping stale `payloadHash` (#4119).
- Dedup caches evicting **unsettled** entries: transport receipt cache
  (#4105 — retry double-applied the same message) and the mcp_oauth LRU
  (#4122 — evicted in-flight receipt spawned a competing OAuth flow,
  plus a dedupe TOCTOU that handed write authority to the loser, HIGH).
- Replay of an active intent cleared the live stream (HIGH); retained
  `lastCompletion` replayed terminal toasts on fresh renderer bootstrap,
  and the fix's cursor-seeding swallowed a pending submission's
  completion (#4119).

### E8. Failure treated as success; error-kind erasure

- Rejected pre-commit settled the dispatch ticket as `applied` (#4100 —
  in the Wave-1 dispatcher itself; fixed).
- `notifyStreamFinished` computed outcome from a `wasCancelled` flag, so
  errored finalize fired a "completed" notification (#4095); external
  errors ignored during finalizing were silently dropped (three
  reports).
- Classified `DyadError`s rewritten to `Auth` by broad catches;
  infrastructure failures indistinguishable from denials; expected
  admission refusals surfaced as product exceptions (#4105, #4108 ×3,
  #4119, #4121, #4123).

### E9. Retention: unbounded growth and eviction of live entries

- Version preview initiator/routing maps: never forgotten on terminal
  publication, 256-cap evicting live operations, rejected dispatches
  recording ownership nothing forgets — four distinct instances (#4123).
- Terminal/removed queue intents retaining full base64 attachments
  (HIGH ×2, #4119); renderer-supplied appIds interned before
  authorization, retained forever (HIGH, #4108); per-job prune timers
  skipped while another job was active (#4121); `recoveryScopes` growing
  for process lifetime (#4102).
- Retention deadlines that reset on traffic: every settled ticket
  restarted the full disposal delay, so sub-deadline traffic postponed
  disposal indefinitely (#4100).

### E10. Identity: duplication and renderer trust

- appId carried in three places (routed key, event payload,
  `invocationRef.entityKey`) with no enforced equality → cross-app stop
  and wrong-key snapshot publication; three escalating rounds until "the
  actor key is the sole intent identity" (#4099, HIGH).
- Renderer-supplied `originWindowSessionId` (spoofable; derive from
  `event.sender`), forged `owner.kind = plan-handoff` privileged queue
  entries, trusted `intent.appId` routing invalidations to the wrong app
  (#4096, #4119); output-supplied `invocationRef` preferred over the
  constructor-captured one (#4108); dash-prefixed git refs passing the
  remote schema after the legacy validated contract was deleted (P1,
  #4123).

### E11. Mechanical/ordering residue

- Observer-phase `forget(operationId)` ran before the command-phase
  `notify-error`, losing the failure toast — "the dispatcher runs
  observers before command batches" is observable and there is no
  post-command hook (#4123, P2).
- Envelope byte ceilings repeatedly out of sync with domain contracts:
  256 KiB dispatch vs 25 MiB attachments, then 40 MiB vs 43.35 MiB
  worst-case valid payload, snapshot 1 MiB vs unbounded queue projection
  (#4119, #4120 — per-machine ceilings became a framework feature
  mid-review, but worst-case sizing is still hand-computed).
- Revision-only reload signaling: command-only edges invisible to
  snapshot-reference consumers (#4108).
- Fan-out delivering chunks to peers that never registered the
  invocation — silently dropped; then the fix forwarded stale
  superseded-stream chunks (#4104). Effects with no observer: main
  finalization publishing invalidations only via renderer snapshot
  handlers, missed when no renderer subscribed (#4119, two rounds).

## Proposed improvements

Ordered by leverage: (findings prevented) × (machines affected) ÷ (risk
of the primitive itself). Non-goals from Wave 1 stand: no XState, no
generic controller owning domain policy. Everything below is transaction
and lifecycle _mechanics_ that this wave shows every machine reinvents.

### P1. Kernel-owned settlement waiters (`OperationWaiters`)

Kills E2 and half of E1. A per-actor (or per-service) waiter registry the
kernel owns, with an API whose _shape_ enforces the invariants:

```ts
// Registration returns synchronously, BEFORE any await can run.
const waiter = waiters.register({
  requestId: idSource.next(), // never a reusable invocation
  invocationRef, // correlation, not identity
  onDisposed: "reject", // classified DyadError, kind: Disposed
});
const receipt = await actor.dispatch(event, waiter);
return waiter.settled; // Promise<Outcome>
```

Contract, each line traceable to a finding:

- **Register-before-await by construction**: `register()` is synchronous
  and must precede the dispatch call that references it; there is no API
  to attach a waiter to an in-flight operation (#4108, #4119
  `waitForChatActorIdle`).
- **Request identity ≠ runtime invocation**: waiters key on a
  freshly-minted request operationId; the actor maps request → possibly
  reused invocation via an explicit in-flight queue, as #4108's third
  iteration converged on. The kernel provides that queue.
- **Outcome-aware settlement**: `settle(requestId, outcome)` where a
  failed outcome rejects with the projected, classified operation error —
  resolving a waiter on failure is unrepresentable (#4108's
  `PROCESS_FAILED`-fulfills-runApp, flagged 3×).
- **Disposal settles everything**: `ActorHost.disposeKey`/`dispose` and
  entity fences (P2 below) sweep the registry and reject outstanding
  waiters with a distinguishable kind before cleanup completes (#4108,
  #4116 Reset Everything).
- **Superseded is not stale-drop**: superseding an operation settles its
  waiter with a `superseded` outcome carrying the correlated error
  payload (#4108 "superseded failures lose their error").
- Legacy IPC adapters settle their tickets from waiter settlement, never
  at admission (#4108).

Adopt in `app_run`, `chat_stream` (idle waiter + pending submissions),
`github_ops` (claim acks), `version_preview`, `image_generation`
admission, replacing five hand-rolled implementations.

### P2. Fences as an ActorHost primitive, enforced at admission

Kills E3. Move entity-deletion/reset fencing from per-service convention
(`chat_actor_deletion_fence.ts`, `app_chat_creation_fence.ts`, ad-hoc
service booleans) into the host:

```ts
const fence = await host.fence({
  scope: { machine: "chat_stream", key }, // or machine-wide, or host-wide
  drain: { event: CANCEL, timeoutMs }, // phase 1: cancellation allowed
});
try {
  await deleteFromDb(); // destructive commit
  fence.commit(); // actor disposed, waiters swept
} catch (e) {
  fence.abort(); // admission reopens, clients resync
}
```

- **One admission point**: the fence is checked at key canonicalization
  inside the host, which every entry path already funnels through —
  remote dispatch, legacy IPC, main-internal `localRef`, and
  subscription-creates. A fenced key cannot be admitted or _created_ by
  any path (#4119 localRef bypass P1, #4123 subscription-recreates,
  #4108 late producers).
- **Two-phase, drain-then-seal**: phase 1 admits only the declared drain
  events (CANCEL) and waits for the actor to reach a terminal/quiescent
  state; phase 2 seals admission entirely. This is the resolution of the
  #4119 fence-vs-cancellation deadlock, made structural.
- **Held through the destructive commit**: `commit()` after the durable
  delete succeeds; `abort()` on failure resyncs subscribers instead of
  stranding them with `stale-actor` until remount (#4116 failed-deletion
  finding). The #4116 "fence lifted while deletion still running" class
  becomes impossible because disposal is fence-driven, not
  fence-adjacent.
- **Producers get non-creating handles only**: the host hands command
  runners and external producers a `WeakActorHandle` wrapping `peek()` —
  there is no creating `ensure()` reachable from a producer callback
  (#4108's resurrection class, reviewers' "tombstone or non-creating
  lookup").
- Fences settle P1 waiters and run `settleWaiters`/`onDisposed`
  lifecycle hooks exactly once, ordered by the existing disposal-barrier
  machinery from #4100's fixes.

### P3. Receipts that cannot be dropped

Kills E4. Three coordinated changes:

1. **Typed dispatch results.** `RemoteActorRef.dispatch` returns a
   `DispatchResult` discriminated union; add
   `dispatchExpectingApplied(event, {onConflict})` where `onConflict` is
   _mandatory_: `"resync-retry" | "surface" | handler`. The
   resync-retry policy encapsulates #4109's converged semantics (treat
   conflict-on-already-satisfied as success after resync, else retry
   with the current revision) once, instead of per call site.
2. **No silent discard.** Delete `sendWithoutReceipt`-style helpers. A
   boundary test (the `boundaries.test.ts` pattern) inventories dispatch
   call sites and flags unconsumed results — the same enforcement
   mechanism that already polices atom ownership.
3. **Rendered-revision plumbing.** The client tracks the revision of the
   snapshot the UI last rendered and stamps it on mutations by default;
   falling back to "latest snapshot revision" requires an explicit
   `allowStaleWrite` opt-in at the call site (#4120's stale-Clear HIGH
   becomes a type error, not a review catch).

Companion convention, promoted to capability projection where possible:
local presentation changes commit on receipt or settlement, never on
dispatch (dialog close #4121, pane hide #4123, composer clear #4120).
`assertCapabilityTransitionConsistency` already exists; extend queue
entry capabilities (`editable`/`removable`) into projected snapshots so
the UI cannot render enabled controls the transition will reject
(#4119/#4120 delete-button findings).

### P4. One shared remote manager (`createRemoteManager`)

Kills E5. Extract the base class three managers already convergently
evolved (`chat_stream/remote_manager.ts`, `app_run/remote_manager.ts`,
`plan_handoff/remote_manager.ts`):

- `start()`/`stop()`/`dispose()` with disposed-guards after awaits;
  auto-`start` on first actor access so observer-only windows work
  (#4119 HIGH ×2).
- Ref-counted per-key subscriptions with **generation-tagged, deferred
  release** — the StrictMode remount fix implemented once (#4119, found
  twice).
- **Bootstrap-before-dispatch built in**: `dispatch` awaits (or
  reserves) the bootstrap for `dispatchCreates: false` machines; the
  reviewers' explicit ask on #4119.
- Failed bootstraps are never cached; retry with bounded backoff
  (#4102's invalidation-listener fix, generalized).
- Subscription retained across an in-flight dispatch and until terminal
  snapshot delivery; release-on-receipt is unrepresentable (#4119 P1).
- Per-key release on entity disposal and LRU of _inactive_ keys under
  the window quota (#4108's 256-app exhaustion).

Managers keep their domain surface (methods, projections); they lose
their hand-rolled lifecycle. Add manager cases to the conformance suite:
StrictMode replay, unsubscribe-during-bootstrap, dispatch-before-
bootstrap, dispose-with-pending-waiters.

### P5. Admission-window helpers and conformance tests (capture-then-revalidate)

Kills the rest of E1. The transport fixes in #4100/#4105 each hand-built
the same shape; extract it:

```ts
const guard = admission.open(actor);      // captures instanceId, revision, fence state
const decision = await authorize(...);    // arbitrary awaits / reentrant callbacks
guard.revalidate();                       // throws AdmissionChanged if anything moved
```

- Used by the transport for subscribe/dispatch (already effectively
  present post-#4105 — refactor to the named primitive) and offered to
  services for their own await windows (#4108's stale-stop-kills-
  replacement, #4123's interest-acquired-for-destroyed-WebContents).
- Generation tokens (`createGenerationGate`) as a kernel utility for the
  subscribe/attach/bootstrap shape (#4102, #4106), replacing per-file
  reinventions.
- Extend `runLocalActorHostConformanceSuite` and the transport tests
  with the adversarial cases this wave found, as named regression
  tests: dispose-during-synchronous-construction (done in #4100 — keep),
  sender-destroyed-during-authorize, unsubscribe-during-pending-
  subscribe, stale-bootstrap-vs-new-generation, fence-during-drain,
  waiter-registered-then-disposed-before-await-returns.

### P6. Durable checkpoint and claim protocol (Wave 1 §9, now with evidence)

Addresses E6. Wave 1 deferred the durable-handoff primitive pending a
pilot; #4116/#4119 _were_ the pilot, run without the primitive. Extract
what their converged fixes agree on:

- **Checkpointed intent lifecycle**: `draft → admitting → accepted →
executing → settled`, where each durable write names the checkpoint it
  represents and recovery code branches on checkpoint, not on inferred
  state (#4119 plan_handoff's three rounds, generalized). Monotonic
  autoincrement ordering, never wall-clock timestamps, for rehydration
  (#4119 tie bug).
- **Claim records with correlated expiry**: mint claimId with the claim;
  release/expiry must present the claimId; routine reconciliation
  cannot release a claim it did not mint (#4116 P1). Expiry that can
  race a durable side effect requires a compensation hook (#4116 orphan
  chat).
- **CAS discipline for owned queues**: validate revision → apply
  mutation + advance revision in one transaction → only then settle
  owners; rejected mutations settle nothing. Provide this as a helper
  around the persistence adapter so the #4119 ordering mistakes (~6
  iterations) are not re-derivable.
- **Compensation disposes actors before rows**: deleting a durable
  entity always routes through the P2 fence, including compensation
  paths (#4119 HIGH).
- **Cancellation point-of-no-return**: a saga declares its destructive
  boundary; cancellation is honored before it and converted to
  "complete + report real settlement" after it (#4101's reviewed-and-
  reversed semantics, recorded once as kernel vocabulary instead of
  re-litigated per PR).

### P7. Idempotency mechanics: canonical hashing and settlement-aware caches

Addresses E7.

- `canonicalIntentHash(schema, value)` in the kernel: hash over the
  schema-parsed canonical serialization (stable key order, codec-
  round-trip-invariant), with a type-level marker so raw `JSON.stringify`
  hashing of wire payloads fails the boundary inventory (#4119 P1).
  Delivery/session metadata (`originWindowSessionId`) lives outside the
  hashed envelope by type, not by careful omission (#4119 HIGH ×2).
- `SettlementCache` primitive: keyed receipts where **unsettled entries
  are never evicted** — capacity bounds apply to settled history and to
  _admission_ of new in-flight entries (reject, don't evict). This is
  the #4105 transport fix and the #4122 mcp_oauth fix, which are the
  same data structure written twice; mcp_oauth's synchronous-
  reservation-before-first-await dedupe also folds in.
- Replay classification: replays of terminal intents settle pending
  submissions with the original outcome; replays of _active_ intents are
  ignored, never treated as new terminal events (#4119 HIGH). Encode as
  a helper the acceptance path calls, with conformance cases.

### P8. Typed outcomes end-to-end; refusal ≠ failure

Addresses E8.

- Settlement types carry `outcome: succeeded | failed | cancelled |
superseded` plus the classified error; deriving user-facing outcome
  from side flags (`wasCancelled`) has no API to do so (#4095).
- Authorization and admission hooks return a discriminated
  `allow | deny(classified) `; throwing from them is an infrastructure
  failure by definition and is reported, not converted to a denial
  (#4105). Broad catches at the transport preserve `DyadErrorKind`
  (#4108 ×3, #4123 Auth-vs-NotFound).
- Expected lifecycle refusals (`ActorAdmissionError`, fence rejections,
  stale-operation ignores) have a dedicated telemetry channel distinct
  from product exceptions (#4105, #4121 duplicate-job-receipt-as-error).

### P9. Operation-scoped routing tables and retention

Addresses E9.

- `RoutingTable<OperationId, Destination>` owned by the actor service,
  with entries whose lifetime is _tied to the operation_: recorded at
  authorized admission, forgotten on terminal publication or authorize-
  rejection, swept by fences — bounded with never-evict-live and an
  explicit reject-on-overflow (#4123's four leak variants, #4121's
  immortal toast).
- Forgetting runs in a **post-command dispatcher phase** (see P10), so
  command-phase notifications can still resolve their initiator
  (#4123 P2).
- Retention deadlines in the host are edge-triggered from the terminal
  transition, never refreshed by traffic (#4100 — landed; add the
  conformance case). Terminal projection strips heavyweight payloads
  (attachments) by schema: the snapshot codec declares which fields are
  retained post-terminal (#4119 base64 HIGHs).

### P10. Dispatcher: post-command settlement phase

Small, surgical: add an optional `afterCommands` observer phase to
`TransactionalDispatcher` that runs after the command batch is handed to
the scheduler (and, for serial schedulers, after synchronous execution
completes). Documented ordering becomes: commit → project → subscribers
→ observers → commands → afterCommands. Routing-table forgetting (P9)
and "operation fully settled" bookkeeping move there (#4123). No other
ordering changes — #4100's commit-result check already landed.

### P11. Envelope budgets derived from contracts

Addresses E11's byte-ceiling churn. A test helper,
`assertEnvelopeBudget(definition, worstCasePayloadFactory)`, that
constructs the worst-case valid domain payload (max attachments × max
size, full queue projection), runs it through the actual codec +
structured-clone measurement, and asserts the declared ceilings exceed
it with stated headroom. Every remote definition gets one. Ceiling
mismatches become test failures at the PR that changes either side, not
production snapshot drops (#4119, #4120 ×2).

Also: command-only signals that must reach snapshot consumers get an
explicit monotonic token in state (the #4108 reload-token pattern),
recorded in `rules/state-machines.md` as the standard answer to
"revision didn't change but consumers must react."

### P12. Identity: key-as-sole-identity, main-derived provenance

Addresses E10, mostly by codifying what #4099/#4119 converged on:

- The routed actor key is the only entity identity in an intent. Codecs
  for events that must carry an entity id (rare) use schema refinements
  asserting equality with the routed key; `canonicalizeKeyAfterAuthorization`
  is the single place identity is established. Add a manifest-validation
  check: an intent schema containing a field named like an entity key
  (`appId`, `chatId`) without a refinement fails registration.
- Window/session provenance is always derived from `event.sender` via
  WindowRegistry in main; renderer-supplied origin fields are rejected
  by the envelope schema (#4096, #4119 forged-owner class).
- Producer callbacks are bound to their invocation at spawn; producer-
  supplied refs are correlation hints, never admission identity (#4108).
- When a legacy validated IPC contract is deleted, its input-validation
  obligations (e.g. git-ref safety) move into the remote codec in the
  same PR — add this to the deletion-PR checklist in the rules doc
  (#4123 P1).

## Rules-doc and enforcement updates

- Rewrite the settlement-waiter section (L307–329) to "use
  `OperationWaiters`"; the fence, receipt, manager, and admission-window
  sections likewise point at P1–P5 primitives. Rules that survive as
  convention: presentation commits on settlement; compensation scope;
  cancellation point-of-no-return declaration; reload-token pattern.
- Extend the `boundaries.test.ts` enforcement pattern (which this wave
  proved out — and #4090 showed needs its writer-set seeded from the
  allowlist, not filename patterns) with: unconsumed dispatch results,
  raw-JSON hashing of wire payloads, creating-`ensure` reachable from
  producer scopes, `unavailableSnapshot` defined in two places
  (host vs client definition — make the client derive it).
- Machine-directory inventories (`MACHINE_DIRECTORIES`, distributed
  consumer lists) generated or glob-verified so a new machine cannot
  silently skip the guardrails (#4090's class).

## Non-goals

Unchanged from Wave 1: no XState/statecharts, no kernel ownership of
state shapes, concurrency policy, or staleness policy; no forced
migration of stable machines; the C2 specialized registries
(connection_flow, mcp_oauth) keep their disposition — though mcp_oauth
adopts `SettlementCache` (P7), which is mechanics, not policy.

Also out of scope here: the persistence/hydration framework
(`MachinePersistencePolicy` is contract-only today) beyond the P6
checkpoint helpers; multi-window product policy (owned by the ADR);
cloud topology ADRs.

## Rollout

Bundling rule as before: wide PRs must be behavior-neutral; semantic
changes stay small and bisectable; heavier PRs get `/code-review ultra`.

- **PR 1 — Waiters + admission guards (P1, P5).** `OperationWaiters`,
  `admission.open/revalidate`, `createGenerationGate`, conformance
  cases; pilot adoption in `app_run` (the machine with the worst waiter
  history) with named regression tests mirroring #4108's three
  iterations. Semantic change is localized to app_run settlement.
- **PR 2 — Host fences (P2).** The two-phase fence in `ActorHost`,
  `WeakActorHandle` for producers, migration of
  `chat_actor_deletion_fence` / app deletion / Reset Everything onto it.
  This is the highest-risk PR (touches every teardown path) — its spec
  is the conformance suite plus the golden characterization suite, and
  it gets ultra review.
- **PR 3 — Receipt discipline (P3).** Typed dispatch results,
  `dispatchExpectingApplied`, rendered-revision stamping, deletion of
  fire-and-forget helpers, boundary inventory of call sites. Mechanical
  where possible; call sites that previously dropped conflicts choose a
  policy explicitly (behavior change: silent no-ops become surfaced or
  retried — bisectable per machine).
- **PR 4 — Shared remote manager (P4).** `createRemoteManager` + the
  three manager migrations + manager conformance cases. Behavior-
  preserving relative to the already-fixed managers.
- **PR 5 — Idempotency + outcomes (P7, P8).** `canonicalIntentHash`,
  `SettlementCache` (transport + mcp_oauth adoption), replay
  classification helper, typed authorize results, refusal telemetry
  channel.
- **PR 6 — Routing tables + dispatcher phase (P9, P10).**
  `afterCommands` phase, `RoutingTable`, version_preview and
  image_generation adoption (their leak findings become the regression
  tests).
- **PR 7 — Durable protocol (P6).** Checkpoint lifecycle + claim
  records + CAS helper, retrofitting plan_handoff and github_ops onto
  the named primitives (their current fixed code is the reference
  implementation; the PR is mostly extraction plus tests).
- **PR 8 — Contracts + identity + docs (P11, P12, rules rewrite).**
  `assertEnvelopeBudget` for all six remote definitions, manifest
  identity-refinement validation, boundary-test extensions, rules-doc
  rewrite pointing at the primitives.

```text
PR 1 ──┬── PR 2 ── PR 7
       ├── PR 4
       └── PR 6
PR 3 ──┘ (independent start; PR 4 consumes its dispatch types)
PR 5 (independent)          PR 8 last
```

## Success criteria

- A waiter that resolves on a failed outcome, registers after an await,
  or survives disposal unsettled is unrepresentable in the API, and
  every machine's waiters are the kernel's.
- No code path — remote, legacy IPC, main-internal, subscription,
  producer — can admit or create an actor through a fence; deletion
  drains cancellation before sealing; fence commit/abort is explicit.
- Dispatch results cannot be silently discarded; stale-revision writes
  require an explicit opt-in; conflict handling is a named policy.
- One remote-manager lifecycle implementation, StrictMode-proof by
  conformance test.
- Every await window in transport and services revalidates admission
  through one named primitive.
- Idempotency hashes survive codec round-trips by construction; no
  dedup structure can evict an unsettled entry.
- Refusals, failures, cancellations, and supersessions are distinct
  types end-to-end; telemetry separates expected refusals from defects.
- Envelope ceilings are proven against worst-case valid payloads in CI.
- The next authority-move PR ships with materially fewer review
  iterations than #4119 — the real metric this plan exists to move.
