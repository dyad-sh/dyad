# Cleanup of the State-Machine Layer

## Status

Proposal. This is the unified successor to two overlapping plans and the
committed cleanup trajectory:

- `plans/codex-cleanup-state-machines.md` — ownership model, target renderer
  APIs, boundary enforcement, runtime consolidation. Its architecture and
  rules are adopted here; its rollout is superseded by this plan's.
- `plans/claude-cleanup-machines.md` — the verified atom-level inventory
  (116 atoms classified; 152 trace claims adversarially checked, 20
  corrected) and per-atom migration recipes. It remains the **execution
  appendix** for this plan: every atom retirement below is specified
  reader-by-reader there, and its file:line traces are authoritative where
  the two source plans disagreed.
- `plans/distrbuted-machines.md` — the actor-runtime alternative. Not
  adopted now, **deliberately kept open**. This plan sequences the cleanup
  so that nothing done here is discarded if the distributed runtime is
  pursued, and names the hold-points where work would be.

Follows `plans/state-machines-hardening.md` (all nine PRs landed). The
hardening work made the layer safe; this plan makes it small and truthful:
one authoritative owner per lifecycle fact, typed cross-machine edges, and
no second Jotai representation of machine state.

## Target architecture

```text
producer event
    |
    v
typed machine facade            (carries operation identity;
    |                            delivers post-commit, deferred
    v                            when crossing into another machine)
dispatch -> committed immutable snapshot -> pure selectors
    |                                          |
    v                                          v
command adapter                        React domain hook
    |                                          |
    v                                          v
IPC / Query / UI-only runtime stores        component
```

The central rule:

> A lifecycle fact represented in a machine snapshot is not also stored in
> Jotai.

Jotai remains correct for client-only state no machine owns: edit buffers,
navigation, tabs, dismissals, visual-editor selections, high-frequency
console/stream content, independent diagnostics. React Query remains
authoritative for IPC-backed entities. Main-process machines may expose
renderer read models across IPC — a process boundary is not a second
same-process authority.

Every cross-machine facade introduced by this plan follows two rules taken
from the distributed proposal, so the facades are shaped like the actor
references that might replace them:

1. **Events carry operation identity** (invocation refs), never inferred
   from timestamps or map edges.
2. **Delivery is post-commit**, and microtask-deferred on any edge that
   would otherwise run inside another machine's dispatch.

## The inventory (verified)

Full tables, per-atom traces, and corrections live in
`plans/claude-cleanup-machines.md`. Summary:

- **116 atoms** across `src/atoms/*`, `src/store/appAtoms.ts`, and machine
  projection modules.
- **69 UI-only — keep as Jotai.** Includes documented deliberate keeps
  (machine writes into UI-owned atoms: plan_handoff navigation writes,
  first_prompt post-submit clears, isPreviewOpenAtom) and machine _reads_
  of UI atoms (inputs, not projections — out of scope).
- **32 machine-mirror — retire.** Machine is the writer; the atom
  duplicates snapshot state (isStreaming-adjacent flags, saga projections,
  image-gen job copies, app_run's preview-runtime family, user_input's
  renderer adapter atoms).
- **12 cross-machine + 3 mixed-ownership — retire; worst class.** Atoms as
  mailboxes or status buses between machines: `pendingScreenshotAppIdsAtom`
  (producer mailbox), `previewRunStateByAppIdAtom` (preview_iframe infers
  app_run restarts), `isStreamingByIdAtom` (plan_handoff subscribes — the
  #4077 ORDERING INVARIANT re-entrancy hazard), plus mixed-owner primary
  stores that need owned stores and facades (`chatMessagesByIdAtom` — which
  version_preview also writes; the queue pair; `planStateAtom` split).

Load-bearing verification corrections (already folded into the appendix
recipes; repeated here because getting them wrong inverts behavior):
release-age outranks pnpm-migration in the warning priority rule; six (not
two) preview-error writer sites, four of them in `PreviewIframe.tsx`
including `dyad-app`-sourced cloud-sandbox errors; `subscribeStreamFinished`
is microtask-deferred but does not fire on `disposeKey`, so the plan_handoff
`watchIdle` facade must also observe disposal; provider mount order
(`ChatStreamProvider` above the router, deps registered under
`AppRunProvider` but above `ScreenshotProvider`) constrains facade wiring.

## Ownership model

Adopted verbatim from the codex plan; classification is mandatory before
code changes:

- **Machine-owned lifecycle state** — stored only in the snapshot; read via
  domain hooks/facades; derived with pure selectors; never mirrored into a
  writable atom; never reconstructed by watching command side effects.
- **External entity data** — React Query / main persistence; adapters
  invalidate; copied into machine state only when a stable operation
  snapshot is required for correctness.
- **UI/runtime state** — Jotai (shared/surviving unmounts) or local React
  state; never promoted into a machine solely to reduce atom count.
- **Cross-process projections** — named read models with one adapter owning
  hydration/ordering/writes; read-only public APIs; may stay Jotai-backed
  where composition is materially useful (`user_input` is the allowlisted
  case).
- **Derived indexes** — read-only external-store selectors over
  authoritative keyed snapshots; exposed only for real cross-key consumers;
  never independently mutated.

## Shared infrastructure

1. **Selector-aware external-store bindings** in `src/state_machines/react.ts`:
   `useMachineSelector`, `useKeyedMachineSelector`, `useProjectionSource` —
   no resubscription on selector-closure change, reference-stable snapshots,
   optional equality, StrictMode/unrelated-key tests, no Jotai dependency.
2. **Standard manager facade** (`getSnapshot(key)` / `subscribeKey` /
   `send` / `disposeKey` / `dispose`) — a naming/shape convention over
   `KeyedControllerHost`; domain extensions stay domain-owned.
3. **Projection-free provider convention** — providers own managers and
   lifecycle only; they do not copy snapshots to atoms. Domain hooks live
   beside the provider.
4. **Composition-root wiring** for the typed edges this plan creates:
   `app_run → preview_iframe`, `chat_stream → plan_handoff`,
   producers `→ screenshot`, `user_input → chat_stream` (existing
   direction preserved). Dependency graph recorded in module headers and an
   architecture test; must remain acyclic. Respect the verified mount-order
   constraints when choosing injection sites.
5. **Ownership boundary test** (extends `boundaries.test.ts`):
   `state.ts`/`transition.ts` cannot import `@/atoms`, Jotai, React, IPC, or
   another machine; machine directories cannot import another machine's
   owners; lifecycle projection modules cannot export writable atoms;
   cross-process projections are allowlisted with reasons; new
   `registerAtomWriter`/`projectToAtom` uses outside the allowlist fail.
   Temporary exceptions carry an owner and a deletion PR number.

## Rollout

Two phases. Phase A is **no-regrets**: valuable in every future, including
the distributed one (its deletions are prerequisites for a host move, not
casualties of it). Phase B is **hold-point-gated**: runtime consolidation
that a main-hosting decision could discard, done opportunistically or after
the gate.

Rules for every PR (merged from both source plans):

- Consumer migration precedes projection deletion **in the same PR**; no
  indefinite dual consumption; a compatibility projection has exactly one
  writer until deletion.
- Behavior-preserving under existing suites; intentional deltas enumerated
  in the PR description (known set: notification timing +1 microtask,
  checkout loading-bar span, MANUAL_RELOAD transient `reloading`, machine
  URL dropping on stop). A PR that must change a transition test is out of
  scope by definition.
- When replacing an atom edge with a subscription, close the
  read-before-subscribe race: check before and immediately after
  subscribing.
- One-shot events run only after the authoritative snapshot commit and
  preserve operation identity.
- Every removed keyed atom has an explicit entity-deletion/provider
  disposal replacement (`clearPreviewRuntimeForAppAtom` shrinks map-by-map
  and is deleted last).
- Do not mix controller-runtime migration with ownership/behavior changes.

### Phase A — ownership cleanup (no-regrets)

Per-atom recipes for A2–A6 are in `plans/claude-cleanup-machines.md`
(sections named per atom); each PR below names its scope and what it
subsumes from the codex rollout.

**PR A1 — Boundary enforcement and bindings** _(codex PR 1)_
Ownership table into repo docs; boundary-test rules with allowlisted
current violations mapped to their deletion PRs (A2–A6); selector-aware
React bindings + tests. No production behavior change.

**PR A2 — S-tier mirrors, no new stores** _(claude PR 1; subsumes codex
PRs 2 and 9)_
Completion-event pair (via `useStreamFinished` + chatSummary threading),
firstPromptSaga pair, version_preview checkout-counter pair (delete
`src/store/appAtoms.ts`), pendingToolConsentsAtom, app_run run-state
derived trio (two of three have zero production readers).

**PR A3 — Single-machine store conversions** _(claude PR 2; subsumes codex
PR 3)_
image_generation projection family (manager snapshot exposed directly;
dismissal atom stays UI); user_input renderer adapter → one SnapshotStore
holding requests + responding set (stays the allowlisted cross-process
read model — renamed and documented as such, per codex §J);
streamingPreviewByChatIdAtom → per-chat sidecar store (high-frequency
content stays out of StreamState); previewAppExit family (timestamp onto
`stopped`, the template for A5's error work).

**PR A4 — Cross-machine signal edges** _(claude PR 3; subsumes codex PR 4
and the facade half of PR 5)_
`pendingScreenshotAppIdsAtom` → `ScreenshotRequestFacade.requestCapture(appId, source)`,
both producers migrated in one change, coalescing policy explicit in the
machine; `previewRunStateByAppIdAtom` → app_run lifecycle facade to
preview_iframe (**microtask-deferred**; edge-triggered or
invocation-identified, never `startedAt`-deduped); reload-token family
(chat_stream bump → `MANUAL_RELOAD` facade, then a manager-owned counter);
appUrl family (URL read from RunState).

**PR A5 — Multi-producer channels get owned stores** _(claude PR 4;
completes codex PR 5's atom deletions)_
previewError channel → preview_iframe-owned state with all six writer
sites landing together (app_run's set/clear crosses via a deferred facade;
source-priority and dismiss semantics encoded in transitions); console
trio → keyed PreviewConsoleStore, five producers atomically;
package-manager warning unit → standalone store porting the dismissed-set
guard and the **release-age-wins** priority rule with its characterization
test. `previewRuntimeAtoms.ts` and `clearPreviewRuntimeForAppAtom` reach
empty and are deleted.

**PR A6 — chat_stream / plan_handoff core** _(claude PR 5; subsumes codex
PR 7 and the facade half of PR 8)_
Ordered stack: (a) `isStreamingByIdAtom` — useStreamChat first (~15
components come free), ChatTabs aggregate selector, plan_handoff
`isIdle`/`watchIdle` facade **with disposal observation**, resyncChat
injection, then delete the atom, syncProjection, and **both #4077
protective comments** — retiring this atom deletes the re-entrancy hazard
itself; (b) chatErrorByIdAtom bundled (same files; external-error machine
event; lastError durability); (c) chatMessagesByIdAtom — chat_stream-owned
messages store landed behind the existing write pattern, version_preview
`replaceChatMessages` facade with a stream-active guard, hydrate command,
readers flipped, atom deleted last (highest regression risk; full
streaming E2E suite required); (d) queue pair → one QueueStore (atomic
dequeue, pause read-before-pop, restore-as-paused hydration, item identity
preserved); (e) planStateAtom split (acceptedChatIds → plan_handoff
projection; plansByChatId → renamed UI-owned documents atom).

**PR A7 — Compatibility infrastructure removal** _(codex PR 12)_
Delete or narrow `registerAtomWriter`/`projectToAtom` (only the
allowlisted cross-process projection may retain a renamed private copy);
remove boundary-test allowlist entries; update `rules/state-machines.md`,
`rules/jotai-state.md`, `docs/why-state-machines.md`; add the test
asserting no lifecycle atom names from this plan return.

Dependencies: A1 first; A2/A3 parallel; A4 after A2 (derived trio gone);
A5 after A4 (facade + app-exit template); A6 after A2/A3 (patterns
settled); A7 last.

### Phase B — runtime consolidation (hold-point-gated)

The remaining custom controller loops (app_run, chat_stream, first_prompt,
github_ops, plan_handoff, preview_iframe, version_preview) and main
registries still predate `TransactionalDispatcher`. Uniformity is worth
having — but the distributed proposal's candidate-placement table marks
app_run, github_ops, version_preview, chat_stream, and plan_handoff as
possible main-hosted machines, and a host move deletes the renderer
controller wholesale. Mechanically migrating those five ahead of the
placement decision is potential throwaway work (this is exactly the
distributed plan's "superseded by this plan" list).

Policy:

- **Migrate freely, opportunistically** (when the machine is touched for
  other reasons): `preview_iframe`, `screenshot`-adjacent leftovers,
  `first_prompt`, `voice_to_text`-style renderer-forever domains. Each
  migration = trace comparison + controller conformance suite, one
  high-blast-radius controller per PR.
- **Hold** bulk dispatcher migration of `app_run`, `github_ops`,
  `version_preview`, `chat_stream`, `plan_handoff` renderer controllers,
  and any new bespoke per-domain IPC read models, until the Phase C gate
  is decided. (Dispatcher adoption _inside main registries_ —
  connection_flow, mcp_oauth — is distributed-compatible, since the actor
  host composes the dispatcher; migrate those opportunistically with the
  codex §J constraints: resource ownership stays in the registry,
  synchronous claim contracts documented if they block direct use.)

### Phase C — the distributed decision gate

Not scheduled; a recorded decision procedure for when (if) to open
`plans/distrbuted-machines.md`:

1. **Forcing function: `app_run`.** After Phase A, app_run's remaining
   pain is structural — the renderer owns the lifecycle of a main-owned
   process; producer correlation, IPC settlement, and reload-teardown all
   compensate for that split. If that pain justifies action, the first
   step is **not** the generic runtime: it is a one-off main-hosted
   app_run machine built on existing primitives (dispatcher,
   InvocationRef, leases) with hand-written typed contracts, the way
   user_input already is — using the distributed plan's Pilot 1 section
   (event model, safe remote projection, acceptance scenarios 1–12) as
   its design doc. Phase A's facade shapes (post-commit, identity-carrying)
   mean preview_iframe and other consumers only swap event sources.
2. **Rule of three for the runtime.** Extract
   `src/distributed_machines/` only when a third main-hosted machine is
   hand-rolling mechanically identical transport/read-model plumbing
   (user_input and a main-hosted app_run would be two). At that point the
   distributed plan's Phases 0–3 (ADR, deletion budget, kernel, transport)
   run as written — extraction from proven copies, not speculation. This
   is the same method that produced the micro-kernel
   (`plans/machine-followup.md`) and it is the house rule.
3. **If the gate never triggers**, Phase B's holds convert to ordinary
   opportunistic migrations and the codex plan's end-state stands as the
   final architecture.

## Verification strategy

From the codex plan, with the appendix's concrete test lists per atom:

- **Pure transition tests** unchanged (reachability, inventories,
  ignored-reference identity, capability consistency, stale invocations).
  Projection removal requiring a transition change means the projection
  exposed a missing domain fact — isolate and review it as behavior.
- **Controller conformance** (`runControllerConformanceSuite`) for every
  migrated runtime.
- **Renderer tests** per deleted atom: replacement hook under a test-owned
  manager; unrelated-entity transitions do not rerender keyed consumers;
  StrictMode replay; provider replacement; deletion cleanup. Tests and the
  hybrid harness drive the machine boundary — never write a lifecycle atom
  to simulate machine state after migration.
- **Integration scenarios** (codex list): run/restart/stop from one
  committed snapshot path; stale proxy/exit after controller replacement;
  double-submit queues; cancel around registration; stream completion
  wakes plan handoff without an atom edge; screenshot from completion and
  commit; concurrent image jobs; concurrent version mutations; first-prompt
  resume without projection atoms.
- **Performance checks**: keyed subscribers notified only for their
  entity; stream chunks do not rerender lifecycle consumers; console
  appends do not rerender run controls; aggregates reference-stable;
  controller retention bounded. If per-tab subscriptions measure too hot,
  add a manager-owned read-only index — never a writable atom.

## Non-goals

- XState or any statechart framework; a generic pub/sub bus.
- Moving UI-only atoms into machines, or console logs / streamed chunks /
  form buffers into snapshots.
- Replacing React Query.
- Adopting the distributed runtime in this plan (Phase C is a gate, not a
  commitment); building transport/actor infrastructure ahead of the rule
  of three.
- Rewriting stable transitions to normalize names; changing visible
  product behavior as part of mechanical cleanup.
- Fixing the usePlan/usePlanEvents dual-source write race (moves intact,
  commented); retiring machine _reads_ of UI-owned atoms.

## Success criteria

Phase A is complete when:

- Zero same-process machine-written Jotai atoms remain except the
  documented deliberate keeps (each commented at the write site);
  `registerAtomWriter`/`projectToAtom` have no production callers outside
  the cross-process allowlist.
- Cross-machine communication uses typed facades or owned stores only —
  post-commit, identity-carrying, deferred where crossing into another
  machine's dispatch. No machine reads or subscribes to an atom written by
  another machine.
- The #4077 protective comments are deleted because the re-entrancy vector
  no longer exists.
- `previewRuntimeAtoms.ts`, `store/appAtoms.ts`, the first_prompt and
  user_input projection atoms, and `clearPreviewRuntimeForAppAtom` are
  gone; cleanup rides `useRegisterEntityDisposer` + `disposeKey`.
- Boundary tests prevent reintroduction; all listed suites pass ported,
  not weakened; the streaming E2E suite and
  `e2e-tests/package_manager.spec.ts` pass unchanged; the
  priority-direction characterization test exists against the new store.
- A contributor can answer — where a lifecycle fact is stored, which
  transition changes it, which selector exposes it, which command performs
  its effects, which typed facade connects another machine — without
  finding a second atom, counter, ref, or effect that must agree.

Phase B/C add: migrated controllers pass conformance with trace parity;
every remaining custom runtime has a documented reason (resource
ownership, synchronous contract, or a pending Phase C hold); and if the
gate triggers, the distributed pilots are judged by that plan's own
acceptance criteria and deletion budget.
