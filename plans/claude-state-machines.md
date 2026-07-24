# Hardening the State-Machine Kernel: Lessons from the Migration PRs

## Status

Proposed. Synthesized from the review threads and fix-commit iterations of
~25 merged state-machine PRs: kernel/infra (#4014, #4015, #4024, #4026,
#4027, #4045, #4038), chat stream (#4008, #4019, #4023, #4025), app run and
plan handoff (#3968, #3969), sagas (#4040, #4060), and the domain ports
(#4036, #4058, #4059, #4061, #3967, #3970, #4005, #4029, #4032, #4033,
#4047, #4048).

The finding: the kernel's core bet held. Pure `transition()`,
commands-as-data, keyed controller hosts, and per-machine concurrency policy
(the `plans/machine-followup.md` decision) produced almost no bugs _in_ the
kernel itself. But reviewers caught the same five bug classes over and over
in the code each machine had to hand-roll — which is exactly the layer the
kernel deliberately does not own. The conclusion is not to reverse the
no-generic-controller decision or adopt XState; it is to promote a small
number of patterns from "convention in `rules/state-machines.md`, enforced
by reviewers citing line numbers" to "primitive in `src/state_machines/`,
enforced by construction."

## Evidence: what reviewers kept catching

Ranked by severity × recurrence. Each class lists the concrete findings that
motivated it; every one of these was a real review comment that produced a
fix commit.

### 1. Timers not re-armed on state re-entry; states with no timeout escape

The single worst finding of the migration. Any state whose only exit is a
timer event is one missed `schedule-*` command away from being permanently
stuck.

- #4058 (HIGH): re-entering `waitingSelectorReady` during an in-flight
  capture did not re-emit `schedule-settle` (one path emitted
  `cancel-settle`), so `SETTLE_ELAPSED` could never fire — "the machine is
  permanently stuck... reintroduces exactly the stale-thumbnail regression
  the PR set out to fix." An HMR reload during the 3s settle window is
  common.
- #4058 (MEDIUM ×2): `pending` had no fallback for untagged/error pages
  that never send `SELECTOR_READY`; `awaitingResponse` had no bounded wait
  if the iframe never replied.
- #4032: `cancelling` had no timeout — a never-settling IPC promise means
  the job is never terminal, so `pruneTerminalJobs` can never reclaim it.
- #4040: `checkingProviders` could wedge the first-prompt overlay if the
  providers query never resolved; fixed with a watchdog plus a
  timeout-origin state with late recovery.
- #3970 (pre-machine baseline): the renderer-owned 20s Neon timer the
  machine replaced — timeout vs success had to be made mutually exclusive
  by construction.

### 2. Generations that do not survive controller disposal

Staleness-by-generation only works if the generation source outlives the
controller. Three machines independently reinvented per-key identity
retention.

- #4023 (sharpest catch of the set): stream generations were per-controller
  counters, so disposing a controller and creating a replacement restarted
  the counter at 1 — a late IPC payload from the old main-process stream
  with the same reused ID _passed_ the generation check and could mutate or
  terminate the new stream. Fixed by retaining each chat's last generation
  in the manager (`lastStreamIdByChatId`) and seeding replacements from it.
- #3969: buffered proxy URLs carry no producer generation on the wire, so a
  URL from the old process could be applied after a destructive restart,
  reloading the iframe against a torn-down proxy.
- #4024: the deferred manager cleanup double-dispose (A→B→A→B commits
  before microtasks ran) was fixed with — again — a hand-rolled
  per-manager generation map.
- #4015 (P1): the accepted-plan handoff inherited a stale cached chat mode;
  "is this still current?" was answered by identity/cache comparison
  instead of explicit generation or explicit parameter.

### 3. Disposal treated as teardown instead of as a transition

Four PRs had dispose-ordering bugs. The contract that every fix converged on
lives only in fix-commit folklore.

- #4019: disposing while `starting/streaming/cancelling` released transport
  but never synced a terminal snapshot, so the legacy `isStreamingByIdAtom`
  projection stayed `true` and blocked queue dispatch forever.
- #4019: disposing in `finalizing` cleared the command queue — dropping
  `run-end-side-effects` — while skipping `releaseTransport`; with
  `autoRelease:false` the renderer stream entry and turn context leaked.
- #4045: `dispose()` called `stop()` first, releasing the projection writer
  _before_ the controller's final idle `syncProjection`; the write was
  dropped and the chat looked like it was streaming forever after remount.
- #4005: bulk delete cleared `selectedAppId` before disposing controllers;
  the manager's synchronous atom subscription sent `APP_CHANGED` and
  started a return checkout against an already-deleted app.
- #3969: the stop IPC path lacked the start path's try/catch, leaving the
  dispatch waiter hanging in `stopping` forever.

Converged contract: dispose must (a) settle all outstanding waiters
unsuccessfully, (b) synchronously emit a terminal snapshot/projection,
(c) release owned resources even when release normally lives in a queued
command, (d) make late events and settlements inert, (e) be idempotent.

### 4. Enabled UI whose events the machine silently ignores

The largest cluster by count. Total transition matrices with
`ignore(state, reason)` are correct — but no projection derived "which
events does this state accept," so legacy imperative buttons became enabled
no-ops. Every fix had the same shape: hand-add a `canRequestX` flag.

- #4059: primary Sync button enabled but a silent no-op in
  conflicted/rebase-paused states.
- #4005: "Switch to main branch" only sent `CLOSE`, which the `closed`
  state ignores; per-message restore buttons enabled during
  `recovery-required`, events "silently dropped with no navigation or
  toast."
- #4061: in-dialog loading states were unreachable dead code because
  dialogs closed synchronously on dispatch; the merge confirmation dialog
  stayed open forever after a conflict because the close-effect keyed on a
  success event the machine never emits on that path.
- #4015 (P2, same family cross-process): consent timeout/abort settled the
  waiter in main but never notified the renderer — a stale, still-clickable
  consent banner whose later Accept was silently ignored. Invariant
  adopted: every waiter settlement path emits a correlated resolved event.

### 5. Re-entrancy and same-tick effect ordering

- #3969: a listener synchronously calling `send()` re-entered `process()`,
  executing the inner event's commands before the outer's. Fixed with a
  processing flag + pending-event buffer, and enqueue-before-notify.
- #3968: the stream-idle watcher fired synchronously inside the old
  stream's `onEnd`; the old stream's post-callback cleanup then deleted the
  new stream's just-installed callbacks. Fixed with generation-aware
  callback removal (clean up only if not superseded).
- #4059: the conflict-resolution runner ignored `command.files` and relied
  on a React closure cleared in the same synchronous dispatch — "works only
  because command dispatch is synchronous... fragile, easy-to-break
  coupling."
- #3968: `watch-stream-idle` awaited inside the serial command drain — a
  never-idle stream permanently wedged the FIFO and leaked the
  subscription. Rule that emerged: never `await` an unbounded external
  condition inside the drain loop; convert to disposable, supersedable
  watchers or watchdog-bounded states.

### Lower-frequency but structural

- **Sync throws escaping command runners** before the failure event is
  emitted: `getUserMedia` throwing synchronously stranded voice-to-text in
  `acquiring` (#4029); the controller only logs runner throws, so every
  adapter must remember its own try/catch.
- **Dead states and unreachable transitions survive exhaustiveness
  checks.** `never`-checks prove totality of _handling_, not reachability
  or producibility: the never-produced `superseded` state (#4036), the
  unreachable `successBanner("rebase")` (#4059), the missing
  `conflicted → switch-blocked` cell discovered only when the consumer PR
  needed it (#4061), and `unreachableState` returning garbage instead of
  throwing so unknown events were silently swallowed (#3970).
- **First-construction-wins singletons capturing late-arriving
  dependencies.** #4047 (HIGH, found independently by two reviewers): the
  projection adapter captured `chatStream` at first construction, during
  render, before the root effect injected the facade — reload-safe
  continuation silently never ran, and tests missed it because each test
  constructed the adapter correctly. #3970's cold-start unsolicited-return
  drop (listener installed lazily) is the same defect.
- **Incomplete correlation-ID threading.** #3970 (P1): `claimReturn`
  claimed whichever same-provider flow was `awaiting-return`, so a stale
  poll or old browser callback could advance a newer flow — "connect the
  wrong account." Correlation is only as strong as its weakest claim site;
  where the ID physically cannot round-trip (Supabase/Neon proxy accepts no
  state parameter), the invariant must be structural and documented — and
  #4038's doc review showed the documentation of such invariants is itself
  correctness-critical ("teaches future contributors the wrong invariant").
- **Cancel racing registration/startup.** #4008 (P1): Stop between abort
  tracking and stream registration produced a terminal event the ordering
  model misclassified as synthetic, deadlocking `cancelling`. The adopted
  rule: always finalize on any non-stale terminal event in a cancelling
  state; reject staleness structurally (by generation), never by inferring
  event provenance from ordering. #4040's creation registry with
  commit/cancel tombstones solves the same shape in main.
- **Compensation must roll back only what the aborted operation touched.**
  #4060 (HIGH): the early-abort path called `clearTodosOnCancel` before the
  persisted snapshot was loaded, deleting the chat's on-disk todos on
  Stop-during-initial-compaction.
- **Dual-writer projections are where the races live.** `isStreamingByIdAtom`
  caused a P1 in #4008 (machine idle-write clobbering an external stream's
  `true`), the #4019 dispose bug, and defensive guards that only became
  deletable when #4025 made the machine the single writer. Same theme in
  derived-value form in #4040: three `PROVIDER_CONFIGURED` emitters resolved
  chat mode differently, so whichever event won the race decided the mode.

## Goals

Promote the five hand-rolled patterns with the worst review record into
kernel primitives, and close the flagged-but-deferred observability gaps.
Everything here stays within the micro-kernel philosophy: invariant
plumbing, no policy framework.

### 1. Entry-scoped declarative timers (eliminates class 1)

A machine declares timeouts alongside its states:

```ts
timeouts: {
  waitingSelectorReady: { after: 3_000, event: { type: "SETTLE_ELAPSED" } },
}
```

The controller arms the timer on _every_ entry path into the state
(including self-re-entry via a state that returns a new reference), cancels
it on exit, and uses the injected `Clock`. Manual `schedule-*`/`cancel-*`
command pairs remain available for timers that are not entry-scoped.

Companion test-kit assertion: any state whose only outgoing transitions are
timer-delivered events must have a declared timeout
(`assertTimerStatesBounded(transition, timeouts)`).

### 2. Per-key generation allocator on `KeyedControllerHost` (class 2)

The host already owns key lifecycle; give it identity that outlives the
controller:

- `host.nextGeneration(key)` — monotonic per key, surviving
  `disposeKey`/re-`ensure`. Deletes the hand-rolled `lastStreamIdByChatId`
  pattern and prevents the #4023 counter-reset class structurally.
- A canonical `stale-generation` ignore reason in `types.ts` so trace logs
  and tests spell it identically across machines (#4023 mapped onto
  `stale-stream-id` by hand).
- Eviction stays tied to entity deletion via `EntityDisposalRegistry`, as
  #4023's retention map already established (documented as deliberate).

### 3. Disposal contract, enforced (class 3)

Two pieces:

- `createDisposalSequence(controller)` — a kernel helper encoding the
  converged order: settle waiters unsuccessfully → synchronously emit
  terminal snapshot and final projection sync → release owned resources,
  including those whose release normally lives in a queued command → mark
  inert so late settlements are dropped → idempotent on re-entry. Writer
  release happens _after_ the final projection sync (#4045's bug, by
  construction).
- `assertDisposalContract(makeController)` in `testing.ts` — drives
  `dispose()` from every reachable non-terminal state and asserts:
  projections cleared, recorded commands include every release the state
  owned, second dispose is a no-op, post-dispose events are ignored with a
  stable reason. Required in the standard machine test suite.

### 4. Capability projection derived from the transition function (class 4)

`transition` is pure and total, so acceptance is computable by probing:

```ts
const caps = deriveCapabilities(transition, state, [
  "SYNC_REQUESTED",
  "SWITCH_BRANCH",
]);
// caps.SYNC_REQUESTED === false when the matrix would ignore() it
```

Implementation: an event is "accepted" iff `transition(state, event)` does
not return an ignored result (kernel already distinguishes this —
`ignore()` returns the same reference with a reason). Projections spread
these flags; UI disables on them. Enabled-no-op buttons become impossible
by construction instead of being caught one button per review. Events whose
construction needs a payload probe with a declared minimal probe payload.

### 5. Drain-loop hardening in the controller convention (class 5 + throws)

The serial drain loop is already verbatim-duplicated across controllers;
extract the ~40 lines with the fixes baked in:

- Re-entrancy: processing flag + pending-event FIFO; enqueue commands
  _before_ notifying listeners (#3969's fix, made the default).
- Exception fencing: every command execution wrapped; a sync or async throw
  routes to the command's declared `onThrow` event (or a standard
  `command-threw` event) instead of relying on each `commands.ts` adapter's
  discipline (#4029).
- No blocking awaits on unbounded external conditions inside the drain;
  long waits are first-class disposable watchers with an owning state, so
  supersession disposes them (#3968).

This is _not_ the declined generic controller: no staleness policy, no
concurrency model, no command scheduling semantics — those stay
per-machine. It is the mechanical loop all thirteen machines already share,
with the three review-caught bugs fixed once.

### 6. Reachability assertions in the standard test suite

`exploreReachableStates` exists in `testing.ts`; add and require:

- `assertAllStatesReachable(transition, initial, eventCorpus)` — every
  declared state identity is producible (catches #4036's dead
  `superseded`).
- `assertAllCommandsProducible(...)` — every command constructor is emitted
  on some reachable path (catches #4059's unreachable banner).
- `unreachableState` and its siblings must throw, never return a value
  (#3970's silent swallow).

### 7. Late-binding dependency holder

`createLateBinding<T>()` with `get()`, `configure(value)`, and
`onConfigured(cb)` (fires queued work immediately if already configured).
Replaces ad-hoc `configureChatStream`-style retrofits; #4047's HIGH and
#3970's cold-start listener drop are the identical defect and both reduce
to "dependency arrives after first construction."

### 8. Observability polish (deferred review findings)

All flagged during review and consciously deferred; close them here:

- Monotonic sequence tiebreaker on trace entries so same-millisecond
  cross-machine ordering is causal, not approximate (#4026).
- Per-entity-key ring buffers (or key-aware capacity) so concurrent
  chats/apps stop evicting each other's trace entries (#4026).
- Dev-gate `window.__dyadMachines`, and make `defaultDescription` refuse to
  retain raw untagged objects (#4026 — retention/exposure hazard).
- Freeze (or defensively clone) co-sim snapshots handed to caller
  callbacks so a mutation cannot corrupt the search (#4027); validate
  `result.state` eagerly (#4027).
- Decide the `registerAtomWriter` production-throw question (#4045,
  Dyadbot MEDIUM): the design doc scoped single-writer enforcement to a
  dev-mode assertion, but the guard throws unconditionally — a transient
  double-mount during an overlapping route transition would crash in prod.
  Either downgrade to dev-assert + prod-warn, or record the throw as a
  deliberate decision.

## Non-goals

- Reversing the `plans/machine-followup.md` decision. Still no generic
  controller _policy_ (staleness, concurrency, scheduling), still no
  XState. Item 5 extracts the mechanical drain loop, not a policy engine.
- Changing any machine's transition semantics. Adoption of each primitive
  is a mechanical, behavior-preserving migration.
- A statechart layer (hierarchy, parallel regions, actor trees). Nothing in
  the review record asked for one.
- Retrofitting all thirteen machines in one pass. Each primitive lands with
  the kernel change plus migration of the machines whose review findings
  motivated it (e.g. timers → `screenshot`, `image_generation`;
  generations → `chat_stream`, `app_run`); the rest migrate opportunistically.

## Rules-doc updates

`rules/state-machines.md` already encodes several of these as conventions
(bots cite it by line). Once the primitives exist, the corresponding rules
change from "remember to do X" to "use kernel primitive Y"; add rules that
remain convention-only:

- Every waiter settlement path (success, decline, timeout, abort, sweep)
  emits a correlated resolved event to every observer (#4015).
- On saga resume/retry, explicit user choices are preserved from the
  snapshot; implicit derived values are re-resolved through one shared
  resolver (#4040's SUBMIT-vs-RETRY and chat-mode lessons).
- When a machine becomes the sole scheduler for a queue, every legacy
  enqueue path must poke the machine or enqueue through it (#4008's lost
  manual-queue driver).
- Compensation on abort rolls back only what the aborted operation actually
  touched (#4060).
- Machine-adjacent TanStack Query keys nest as `[domain, appId, ...]` so
  invalidation scopes per app; no sibling keys for data invalidated
  together (#4059/#4061 hand-tuned this twice).
- Recorded plan decisions are reviewable artifacts: when a bot finding is
  rebutted as "working as designed," the cited decision must actually cover
  the behavior (#4048 rebutted two findings successfully and one wrongly;
  #4038 shipped a doc fix because the documented invariant was false).

## Suggested sequencing

1. **Items 5 + 6 first** (drain-loop extraction, reachability assertions):
   pure refactor + test additions, no behavior change, immediately raises
   the floor for every machine.
2. **Item 1** (timers) with `screenshot` and `image_generation` migrated —
   the confirmed HIGH class.
3. **Item 2** (generation allocator) with `chat_stream` and `app_run`
   migrated.
4. **Items 3 + 4** (disposal contract, capability derivation) with
   `github_ops` and `version_preview` as the motivating consumers.
5. **Items 7 + 8** as independent, small PRs.

Each step is one PR-sized unit in the established pattern: kernel change +
motivating machine migration + named regression tests mirroring the
original review findings (the A→B→A→B dispose test and co-sim bound-drain
test set the precedent).
