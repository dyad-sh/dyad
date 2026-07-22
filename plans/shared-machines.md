# Shared Machine Infrastructure: Next Developments

## Status

Proposal only — no code changes are authorized by this document. Surveyed
against main at 8ff895e37 (v1.9.0-beta.3), with eight machines in-tree:
version_preview, plan_handoff, app_run, connection_flow, chat_stream,
voice_to_text, image_generation, user_input (mcp_oauth and first_prompt are
in open PRs; preview_iframe, github_ops, and the screenshot machine are
Phase 5 of [even-more-machines.md](./even-more-machines.md)).

This is the successor question to
[machine-followup.md](./machine-followup.md): that plan extracted the
micro-kernel (`src/state_machines/`) from four machines. We now have twice
as many machines and a new generation of hand-rolled plumbing sitting just
above the kernel — providers, managers, projections, disposal call sites,
main-process registries. This document identifies which of those layers has
re-earned extraction and which should stay per-machine.

## The extraction bar (unchanged)

The decisions recorded in machine-followup and even-more-machines still
bind:

- **Rule of three.** Nothing is extracted with fewer than three consumers
  whose copies are mechanically identical, not merely similar.
- **No generic controller, no XState.** Concurrency and staleness policy
  stay per-machine. Extractions are lifecycle plumbing only.
- **Behavior-preserving.** A migration PR that must change a machine's
  transition or command test expectations is out of scope by definition.
- **The kernel stays domain-free** (boundaries.test.ts enforces it).

## What already worked

Worth naming, because it calibrates the proposals: `useManagerLifecycle`,
`KeyedControllerHost`, `SnapshotStore`, `createTraceObserver`,
`Clock`/`IdSource`, and the testing kit are each consumed by 4-8 machines
with zero drift since extraction. The kernel bet paid off; these proposals
are the same move one layer up.

## Inventory of hand-rolled plumbing above the kernel

| Layer                    | Copies today               | Lines (approx)                                            | Drift visible?                                                         |
| ------------------------ | -------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| React provider + context | 5                          | 55-140 each, ~460 total                                   | plan_handoff predates the Owned/Provided split                         |
| Keyed manager facade     | 4                          | 64-201 each                                               | disposal method named disposeKey/disposeApp/disposeChat inconsistently |
| Atom projection wiring   | 5                          | inline in managers; user_input/projection.ts is 349 lines | single-writer rule enforced nowhere                                    |
| Entity-deletion disposal | 3 call sites               | 2 managers per app site today, growing                    | two app-deletion sites must be updated in lockstep                     |
| Main-process registry    | 2 (3 when mcp_oauth lands) | 344 + 422 lines                                           | per-key deadline maps duplicated verbatim                              |

## Proposal 1: machine provider factory (strongest evidence)

Five providers (AppRunProvider, VersionPreviewProvider, ChatStreamProvider,
ImageGenerationProvider, PlanHandoffProvider) implement the same template:
a context, an Owned variant that constructs the manager from the Jotai
store, a Provided variant for test injection, `useManagerLifecycle`, and a
`useXManager()` hook that throws outside the provider. AppRunProvider.tsx
is 55 lines containing zero domain decisions; four of the five are
line-for-line the same shape, and plan_handoff's older shape is the drift
the factory would end.

Proposed addition to `src/state_machines/react.ts` (the one kernel file
allowed to import React):

```ts
createMachineProvider<M extends DisposableManager>(name: string, create: (store: JotaiStore) => M)
  → { Provider, useManager }
```

- `Provider` accepts an optional `manager` prop (the Provided/test path) and
  otherwise owns construction — exactly the split four providers already
  implement.
- An optional `onMount?: (manager: M) => () => void` slot covers the one
  legitimate variation: ImageGenerationProvider's 140 lines include its
  toast-orchestration subscription, which is provider-mounted by design
  (the projection decision from even-more-machines Phase 2). The factory
  must host that, not forbid it.
- Domain hooks (`usePlanHandoff`, `useAppRun`, etc.) stay in the machine
  directories; the factory replaces only the context/lifecycle shell.

Migration is mechanical for all five; plan_handoff additionally converges
on the Owned/Provided split it currently lacks. Est. net deletion ~350
lines. New machines (three arriving in Phase 5) stop copying the template.

## Proposal 2: projection kit with single-writer enforcement

rules/state-machines.md's Projections section mandates one writer per
projected atom, and even-more-machines 3.3 sketched an optional helper.
The evidence has since hardened: five machines now hand-write the
subscription-to-atom wiring (app_run/manager.ts writes
`setPreviewRunStateForAppAtom` inline; version_preview, chat_stream, and
image_generation managers each carry their own copy;
user_input/projection.ts is a 349-line module). Nothing enforces the
single-writer rule — it held so far because reviews caught violations, and
review is exactly what the rule was written to stop depending on.

Proposed `src/state_machines/projection.ts`:

- `projectToAtom(store, atom, source, select)` — one subscription, writes
  only on selected-value change (reference-stable per the snapshot rules).
- A dev-mode registration check: registering two writers for the same atom
  throws in development. This is the enforcement the Projections rule
  lacks.
- Explicitly NOT a data-mapping framework: `select` is the machine's own
  projection function; merge/hydration semantics (user_input's
  events-win-during-hydration rule) stay in the machine's adapter.

user_input/projection.ts does more than project (rehydration via
getPending, the respondingRequestIds overlay); it would consume the helper
for its write path only. That is fine — the helper is a primitive, not a
replacement for projection modules.

## Proposal 3: entity-deletion disposal registry

Deleting an app must dispose per-app controllers in every per-app machine.
Today that is a hand-maintained list duplicated at two call sites
(apps.tsx:163-166 and app-details.tsx:200-202, currently version_preview +
app_run + the preview-runtime cleanup), and chat deletion has its own pair
(ChatList.tsx:244-245: plan_handoff + chat_stream). Phase 5 adds three more
per-app machines (preview_iframe, screenshot, github_ops), taking the
app-deletion list to five entries maintained in lockstep at two sites. The
failure mode is silent: a machine missed at one site leaks controllers and
atom residue exactly the way chat_stream did before its disposeChat landed.

Proposed `src/state_machines/entity_disposal.ts`:

- A small registry with two scopes: `onAppDeleted(fn)` / `onChatDeleted(fn)`
  returning unregister functions; providers register their manager's
  disposeKey during mount.
- Deletion call sites collapse to one call: `disposeForApp(appId)` /
  `disposeForChat(chatId)`.
- Ownership stays explicit (each provider registers its own disposal — no
  global scanning), and the registry itself is provider-hosted, not a
  module global, honoring the lifecycle rules.

Alternative considered: documentation only ("update both sites"). Rejected
because the list is about to more than double and the two-site invariant is
precisely the kind of comment-enforced rule this program keeps converting
into structure.

Also fold in the naming drift: disposeKey/disposeApp/disposeChat become one
conventional name during registration migration (no behavior change).

## Proposal 4: main-process registry kit (deferred until third consumer)

connection_flow/registry.ts (344 lines) and user_input/registry.ts (422
lines) share real, verbatim-level slices: injected Clock/IdSource/broadcast
construction, a keyed entry map with snapshot getters (`getStates` /
`getPending`), per-key deadline scheduling (user_input/registry.ts:93,
137-157 is the same schedule/cancel/fire-on-expiry map connection_flow
hand-rolls), and dispose-as-abort-all for before-quit. The mcp_oauth
registry (open PR) is the third instance.

Hold until mcp_oauth merges, then extract ONLY the identical slices:

- `DeadlineMap` — keyed Clock-handle scheduling with cancel-on-settle.
- A keyed snapshot/broadcast shell (entry map + getStates-style snapshot +
  injected broadcast), if — and only if — the third instance confirms the
  shape. The two existing registries deliberately differ on
  commands-as-data vs derive-effects; that difference is domain policy and
  MUST NOT be papered over by the kit.

## Proposal 5: testing-kit additions (small, opportunistic)

- **Trace replay helper**: `replayTrace(transition, capturedEntries)` — the
  documented technique (replay a `window.__dyadMachines` capture through a
  pure transition) exists only as a hand-written test in trace.test.ts.
  Promote it so bug reports carrying a trace dump become regression tests
  in one line. Three immediate uses: any machine with a trace observer.
- **Cosim second consumer**: the protocol.ts + main_model.ts + cosim suite
  pattern has one consumer (chat_stream). The recorded second candidate is
  the app-run ↔ process_manager contract. Do not generalize the pattern
  into a kit until that second co-sim exists; note it here so the intent
  survives.

## Examined and not proposed

- **Serial command drain loop** — only plan_handoff and chat_stream have
  one, and their semantics differ (FIFO event drain vs serial command
  queue with settlement). Two consumers, non-identical: below the bar.
- **Persistence/hydration helper** — the rules section exists, but the
  candidate machines (queue persistence, tab session) are deferred with
  triggers. No consumer, no extraction.
- **Devtools panel over `window.__dyadMachines`** — plausible, zero pull so
  far. Trigger: the first debugging session that wishes it existed.
- **Re-evaluating XState** — no. Eight machines have produced no need for
  hierarchy, parallel regions, or actor trees; the decision record stands.

## Sequencing

1. **PR 1: provider factory + trace-observer default folding** (proposal 1)
   — migrate all five providers; plan_handoff converges on Owned/Provided.
2. **PR 2: projection kit** (proposal 2) — helper + dev single-writer
   check; migrate the five write paths.
3. **PR 3: disposal registry** (proposal 3) — land with, or immediately
   before, the first Phase 5 per-app machine so preview_iframe never joins
   the hand-maintained lists.
4. **Deferred:** registry kit after mcp_oauth merges (proposal 4); testing
   additions whenever convenient (proposal 5); everything in "examined and
   not proposed" waits for its trigger.

Each PR is behavior-preserving under the machines' existing suites; the
provider and manager tests are the characterization net.

## Risks

- **Framework creep.** The provider factory and projection kit are the
  closest this program has come to "generic machine framework". The guard:
  both host zero policy (construction, context, subscription plumbing), and
  the `onMount` escape hatch means domain behavior stays in machine
  directories. If a migration needs a factory option that only one machine
  uses, that machine keeps its bespoke provider instead.
- **Two-site disposal migration.** Proposal 3 briefly has both the registry
  and the hand-maintained lists live; land it in one PR per entity type so
  there is no window where a site calls a half-migrated list.
- **Deferred ≠ forgotten.** Proposals 4-5 carry explicit triggers;
  re-litigating them earlier requires new evidence, per the standing
  convention.

## Verification

```sh
npm test -- src/state_machines/
npm test -- src/app_run/ src/version_preview/ src/plan_handoff/ src/chat_stream/ src/image_generation/ src/user_input/ src/connection_flow/ src/voice_to_text/
npm run fmt && npm run lint && npm run ts
```

plus the full unit suite per PR. boundaries.test.ts must stay green
(projection.ts and entity_disposal.ts are kernel files: no domain imports;
react.ts remains the only React importer).

## Definition of done

- All five providers ride `createMachineProvider`; the bespoke templates
  are deleted; new-machine PRs get provider+hook in two lines.
- Every projected atom is written through the projection kit and
  double-writer registration throws in dev.
- App and chat deletion each make one disposal call; the per-site manager
  lists are gone; Phase 5 machines register instead of editing call sites.
- The registry-kit and cosim-kit decisions are recorded with their
  triggers, and nothing beyond the named proposals entered the kernel.
