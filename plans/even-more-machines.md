# Even More Machines

## Status

Planning only. This document does not authorize implementation; each machine
listed here gets its own design document (at the depth of
[version-preview-state-machine.md](./version-preview-state-machine.md))
before code. It is the third-generation survey and program plan, following:

- [more-state-machines.md](./more-state-machines.md) — the original survey.
  Its top four candidates are all landed as machines (#3967/#4005 version
  preview, #3968 plan handoff, #3969 app run, #3970 connection flow, #4008
  chat stream).
- [machine-followup.md](./machine-followup.md) — kernel + convention. Audited
  as **effectively done**: `rules/state-machines.md` exists and is linked from
  the rules index (AGENTS.md:38); `src/state_machines/` matches its spec
  (types with ignore reasons + `TransitionObserver`, `snapshot_store`,
  `keyed_host`, `react`, `testing`); all four migrations landed with real
  deletion-time disposal owners (apps.tsx:163, app-details.tsx:200,
  ChatList.tsx:242). Its residuals are absorbed into Part 3 here.

Method note: this plan was produced by a multi-agent survey (6 sweepers over
disjoint slices, 4 ground-truth auditors, adversarial verification of every
candidate, completeness critic). Every file:line below was verified against
the current tree by an independent verifier agent; corrections from
verification are incorporated. Two proposed candidates were killed in
verification (ImportAppDialog saga, chat-mode latch) and are recorded in the
rejected list.

**Progress record (updated 2026-07-22).** Phases 0, 1, 2, 3, and 4 stage 1
are COMPLETE; Phase 5 is the active frontier.

- Phase 0: 448e2a4dd (#4014 kernel migration), b44e54c3d, 1a7b9964a,
  8ad56501c. Over-delivered: banked Part 1A item 5, the plan_handoff half
  of item 4, and candidate 1's staging (a).
- Phase 1: #4019 (PR 1 kernel adoption), #4021 + #4024 (PR 2 manager +
  lifecycle centralization), #4025 (PR 3 merge-conflict fold), #4028
  (PR 4 stream-finished signal + edge-detector cascade), #4023 (PR 5
  streamId echo).
- Phase 2: #4026 (trace observer), #4029 (voice + Clock/IdSource), #4030
  (image-gen main abort fix), #4032 (image-gen machine), #4036 (MCP OAuth
  registry), #4040 (home first-prompt saga).
- Phase 3: #4033 (items 1+2a — machine core + main-side consent port),
  #4037 (2b — renderer projection + rehydration), plus items 3, 4, and 5
  (questionnaire and continuation ports, legacy deletion, and hardening).
- Phase 4: #4027 (PR A cosim driver), #4031 (PR B protocol + model +
  suite + tripwire). Stage 2 remains unscheduled; both of its entry gates
  are now satisfied, so opening it is a decision, not a wait. The two
  compaction chores its audit recorded are still open.
- Also landed: docs/why-state-machines.md (#4038, contributor rationale).

Evidence sections below are point-in-time records from the survey; where
landed work changed the ground, the **Phase plans** section is
authoritative. The detailed phase specs were produced the same way as the
survey: five drafter agents grounded in the post-Phase-0 tree, each
adversarially critiqued, with cross-phase conflicts adjudicated in the
"Cross-phase handshakes" subsection.

## Three findings shape this plan

1. **`chat_stream` is the new drift.** It landed in parallel with the kernel
   and satisfies none of the conventions the other four machines now follow:
   zero kernel imports, a module-global controller Map
   (`src/chat_stream/registry.ts:18`) directly violating
   rules/state-machines.md:30-32, no `dispose()`, reasonless local `ignore()`,
   hand-rolled listener plumbing, no telemetry. Worse, two chat streams still
   run _outside_ the machine and write its projection by hand. Part 1 is
   mostly a chat*stream convention-and-consolidation program. *(Phase 0
   update: one external stream remains — plan implementation was folded;
   `useResolveMergeConflictsWithAI` still streams outside the machine.)\_
2. **The #4008 cancel deadlock is the program's most instructive incident.**
   The re-land review found the renderer machine deadlocking because it
   encoded a false assumption about main's cancel protocol (fixed in
   3ac500962). The bug was in neither process's logic alone — it was in a
   cross-process assumption that exists only in code and comments. Part 3's
   centerpiece (shared protocol spec + interleaving co-simulation) targets
   exactly that class.
3. **One topology, three sick instances.** Tool consent, integration
   continuation, and the planning questionnaire are the same agent-paused
   user-input round-trip (main parks a promise on a map; renderer shows a
   banner; a stream-end sweep cleans up), implemented three times with
   divergent semantics — one instance already has the clean primitive
   (`userInputResolver.ts`) the other two lack. The highest-value new machine
   is the one that unifies them. _(Phase 0 update: all three now ride the
   shared resolver, and 8ad56501c added terminal settlement broadcasts; what
   remains diseased is the classifier race, the multi-writer renderer atoms,
   reload rehydration, and the duplicate questionnaire deadline — see
   Phase 3.)_

## Part 1: Improving the existing machines

### 1A. chat_stream convention migration and consolidation

Ordered so each step stands alone; all are behavior-preserving under the
existing `src/chat_stream/__tests__/` and the streaming integration suites.

1. **Kernel types + observer** (medium). Retype transitions with the kernel's
   `TransitionResult`; tag every `ignore()` with a reason
   (`"stale-stream-id"`, `"already-streaming"`, …); thread an optional
   `TransitionObserver` through `createChatStreamController`. Today the
   controller conflates "ignored" with "command-only, same state"
   (`controller.ts:75` computes `changed = result.state !== state`), so a
   submit-while-streaming is indistinguishable from a dropped event in any
   future telemetry.
2. **SnapshotStore + `dispose()`** (medium). Replace the hand-rolled listener
   set (`controller.ts:41-65`) with `SnapshotStore`, extended with the
   subscriber-count/unsubscribe hook the quiescence check needs. `dispose()`
   must release the live transport: cancel ack timers, `ipc.chatStream.release`
   for the active streamId (today only the terminal side effects do this,
   `commands.ts:199-207`).
3. **Provider-owned host + disposal ownership** (large). Replace the
   module-global Map + `runtimeDeps` singleton (`commands.ts:101-117`) with a
   `ChatStreamManager` (`KeyedControllerHost<number, ChatStreamController>`)
   constructed at the app root, where `useChatStreamRuntime` already mounts —
   controllers must outlive route components (background queue dispatch), so
   the host lives at the root, not per page. **Disposal decision (resolving a
   real contradiction between audits):** migrate to the host _and_ keep the
   quiescence self-GC. `disposeKey(chatId)` is called on chat deletion (next
   to plan_handoff's at ChatList.tsx:241-242) and also clears the chat's
   residue in `queuedMessagesByIdAtom`, `queuePausedByIdAtom`,
   `chatErrorByIdAtom`, `isStreamingByIdAtom` — today that residue survives
   deletion forever. Quiescence GC (terminal + settled + unobserved,
   `registry.ts:20-30`) remains as an additional release path for
   never-deleted idle chats, documented in the module header as the
   concurrency model. Non-React callers (`registerRendererIpcListeners.ts:8`)
   get the manager injected via a wiring handle.
4. **Fold the external streams into the machine** (large; the highest-value
   item in Part 1). _Half banked in Phase 0: the plan_handoff side is folded;
   the merge-conflict side remains — see Phase 1 PR 3._
   `startImplementationStream`
   (`src/plan_handoff/commands.ts`) and `useResolveMergeConflictsWithAI` each
   duplicate ~80 lines of chunk plumbing, write `isStreamingByIdAtom`
   directly (breaking single-writer), and require `queue-poked` compensation.
   Both are plain prompt submissions — folding them in is routing through the
   machine's `submit`. This also closes a real race: the IPC stream client
   keys entries by chatId only, so a machine stream and an external stream
   colliding on one chat replaces the client entry and cross-attributes
   terminal events (can deadlock the machine or freeze messages mid-stream).
   Folding unlocks a cascade of deletions:
   - `chatStreamCountByIdAtom` — a hand-rolled generation counter with three
     writers duplicating the machine's `streamId`; resync staleness guards
     compare machine snapshots instead.
   - `useIntegrationContinuation`'s `prevStreamingRef` edge detector and
     ChatPanel's `store.sub` edge detector — both replaced by a
     `stream-finished {chatId}` signal emitted on the `finalizing → idle` /
     `→ errored` transitions (observer- or atom-based).
   - `useStreamChat.cancelStream`'s non-machine bypass branch.
   - The two defensive projection guards inside the machine's own commands.
5. **Cross-machine facade** (small). _DONE in Phase 0._ plan_handoff no
   longer deep-imports `chat_stream/registry`; it submits through the
   `chatStream` facade injected via `PlanHandoffDeps`
   (src/plan_handoff/commands.ts:35, adapter at src/app/layout.tsx:35-46) —
   the reference implementation of Part 3's composition rule.
6. **Module-level mutable state in commands.ts** (medium). `turnContexts`
   (per-stream targetAppId) moves into machine state; ack maps/timers scope
   to the adapter instance with cleanup wired to `dispose()`.
7. **Defense in depth, coordinated with Part 3** (medium): main echoes the
   renderer `streamId` in chunk/end/error/start payloads so the stream client
   can key entries by (chatId, streamId) and `registered` becomes
   stale-checkable like every other event.

### 1B. Small residuals across the other four machines

- Wire production observers for plan_handoff and app_run (their providers
  construct without one, so ignored-event telemetry is type-level only there;
  version_preview and connection_flow do log). Superseded by Part 3's shared
  trace observer if that lands first.
- `useConnectionFlow` still binds via raw `useSyncExternalStore`
  (useConnectionFlow.ts:157) instead of `useControllerSnapshot`. Explicitly
  optional in machine-followup; record the skip or do it in passing.

## Part 2: New machine candidates

Ranking is adjudicated, not raw verifier score: severity and
incident-adjacency count for; a cheap non-machine fix that removes the
headline bug counts against. Every candidate has a "quick fix first" line
when one exists — those fixes ship as chores regardless of whether the
machine is ever built.

| #   | Candidate                                                                   | Value       | Effort | Confidence |
| --- | --------------------------------------------------------------------------- | ----------- | ------ | ---------- |
| 1   | Agent-paused user-input round-trip (consent + continuation + questionnaire) | **High**    | large  | 82–85/100  |
| 2   | Home first-prompt submission & resume saga                                  | **High**    | medium | 80         |
| 3   | Image generation job lifecycle                                              | Medium-high | medium | 88         |
| 4   | GitHub repo operation lifecycle                                             | **High**    | large  | 82         |
| 5   | MCP OAuth loopback flow                                                     | Medium      | medium | 80         |
| 6   | Preview iframe identity + navigation (+ picker)                             | Medium-high | large  | 82         |
| 7   | Neon linkage saga (after the lock fix)                                      | Medium      | medium | 84         |
| 8   | Screenshot capture pipeline                                                 | Medium      | medium | 75         |
| 9   | FileEditor save/dirty; voice-to-text (carried over)                         | Medium      | small  | —          |
| 10  | Chat tab session lifecycle                                                  | Medium-low  | medium | 62         |
| —   | Main-process stream engine                                                  | see Part 3  | large  | 76         |
| —   | Deferred: queue persistence, deep-link mailbox                              | see below   | —      | 75/78      |

### 1. Agent-paused user-input round-trip (HIGH)

**Scope:** `src/ipc/utils/mcp_consent.ts`,
`src/pro/main/ipc/handlers/local_agent/tool_definitions.ts` (agent-tool
consent), `userInputResolver.ts`/`userInputResolvers.ts`,
`src/atoms/{chatAtoms,integrationAtoms,planAtoms}.ts` (pending maps),
`registerRendererIpcListeners.ts:135-151` (stream-end sweep),
`useIntegrationContinue/Continuation.ts`, `QuestionnaireInput.tsx`,
`ChatInput.tsx` consent banners, `plan_handlers.ts`/`integration_handlers.ts`.

**Evidence (verified).** Three instances of one cross-process topology:

- Two consent paths are hand-rolled pending maps: `mcp_consent.ts:17-26`
  (bare promise, **no timeout, no abort signal**) and
  `tool_definitions.ts:164-225` (a second, semantically divergent copy).
  Meanwhile `userInputResolver.ts` is the _already-clean_ generic factory
  (timeout + abort + per-chat sweep) used by questionnaire and integration —
  the consents are un-migrated laggards.
- Five independent writers to `pendingToolConsentsAtom`, with main separately
  resolving its maps at four other sites — cross-process bookkeeping synced
  by hand.
- Questionnaire duplicates main's 5-minute deadline with a renderer
  `setTimeout` that resets on chat switch while main's timer keeps counting
  (`QuestionnaireInput.tsx:90-105`); `plan_handlers.ts:199` silently discards
  the resolver's matched/unmatched result while `integration_handlers.ts:14-22`
  throws NotFound for the identical condition — the same flow disagrees with
  itself on stale-request semantics.
- Continuation still edge-detects stream end via `prevStreamingRef`
  (`useIntegrationContinuation.ts:40-53`) with a self-documented
  write-before-IPC ordering hazard (`useIntegrationContinue.ts:53-62`).

**Verified reachable bugs:**

1. **Stream parked forever after reload.** Renderer reload while a consent
   banner is pending: atoms reset, but main's `waitForConsent` has no
   timeout/abort — the stream stays parked on an invisible consent with no
   UI to resolve it (traced end-to-end; a later stream on the same chat does
   not unblock it).
2. **Decline dropped → tool executes.** In the classifier race, a human
   decision arriving in the IPC-latency window after classifier-approve is
   silently discarded (`mcp_consent.ts:171-184` settles the human waiter with
   an injected fake decline) — including an explicit Decline.
3. **Answers lost with positive feedback.** Timer-skew: main times out first,
   agent proceeds; user submits the still-visible questionnaire; the stale
   requestId is silently dropped while the UI plays the "submitted"
   confirmation animation.
4. **Continuation silently stalls** after reload between Continue and stream
   end (in-memory map; the "Continue. I have completed…" message is never
   sent).

**Sketch.** One generic machine for the round-trip, keyed by requestId with a
per-chat index: `prompted → awaiting-user (classifier-racing) →
decided(human|classifier|timeout|abort) → resolved`, main-authoritative with
a renderer projection replacing the five-writer atoms. Deadline lives in
exactly one place (main emits `timed-out`); decisions are correlated events,
so the classifier race is a pair of guarded transitions instead of a
`Promise.race` with comment-documented gaps; reload rehydration (a
`get-pending` contract on mount) is an explicit design requirement — an
in-memory renderer machine alone does not fix bug 1.

**Staging.** (a) _DONE in Phase 0:_ both consent maps migrated onto the
shared `src/ipc/utils/user_input_resolver.ts` (5-min timeout + abort +
per-chat sweep; every wait now takes the stream's abort signal, which also
closes the before-quit waiter leak indirectly — bug 1 downgrades from
"parked forever" to "invisible banner, silent auto-decline after 5
minutes"); 8ad56501c additionally broadcasts a terminal settlement event on
every path. (b) build the machine; (c) port questionnaire and continuation
onto it, deleting `prevStreamingRef` (**sequence after the chat_stream
folding**: the port consumes Phase 1's submit-during-finalization enqueue
semantics rather than re-implementing stream-end detection). The full spec
is Phase 3.

### 2. Home first-prompt submission & resume saga (HIGH)

**Scope:** `src/pages/home.tsx`, `HomeChatInput.tsx`,
`pendingFirstPromptAtom` + payload atoms, plus the three other surfaces that
fork on the flag (TitleBar.tsx:48-52, ProviderSettingsPage.tsx:265-268,
SetupBanner.tsx:41).

**Evidence (verified).** A literal 2-second `setTimeout` in the submit path
(home.tsx:312-314, with a test-mode special case); `hasAttemptedAutoResumeRef`
once-latch reset by a second effect watching the same atom (360-365); the
auto-resume effect fires on a 6-condition dependency conjunction then runs a
fire-and-forget IIFE (367-415); `pendingFirstPromptAtom` is a bare boolean
whose real payload (prompt, attachments, selected app, mode) is scattered
across four atoms and re-read at resume; no in-flight guard on submit. The
comments at home.tsx:308-311 and 388-400 document races already hit and
patched piecemeal — the same signature that preceded the first five machines.

**Verified reachable bug:** createApp succeeds, then the Neon template hook
or `setAppTheme` throws → error toast, prompt retained, but the app exists —
resubmit creates a second app. (Double-Enter double-create is reachable only
through the voice-toggle await gap, and the stuck-spinner needs a navigation
failure — both real but narrower.)

**Sketch.** Single-key machine: `idle → validating →
awaitingProviderSetup(armed payload) → creating → postCreate → dispatching →
navigating`, errors forking to `failed(retainInput)` vs
`failedPartial(appCreated)`. `PROVIDER_CONFIGURED` is an event (from settings
page / deep link) instead of a dependency-edge effect; the armed payload is
state, not a boolean plus four atoms; the 2s sleep becomes an explicit
settle command with a test override. Cross-page + deep-link coordination puts
this closer to connection_flow complexity than a single-component machine.

### 3. Image generation job lifecycle (MEDIUM-HIGH; highest verifier confidence)

**Scope:** `useGenerateImage.ts`, `imageGenerationAtoms.ts`,
`ImageGenerationToast.tsx`, plus main's `image_generation_handlers.ts` abort
coverage.

**Evidence (verified).** Module-level `cancelledJobIds` Set mirroring the
atom's status for mutation closures; a 2-minute `setTimeout` eviction whose
correctness depends on the abort error arriving in time; three independent
status writers with unconditional cancel mapping; the pending-count/toast
projection recomputed in three-and-a-half places while a derived
`pendingImageGenerationsCountAtom` already exists unused.

**Verified reachable bug (deterministic, not a race):** main's cancel aborts
only the initial fetch; the URL-download phase uses a separate controller and
the file save has no abort check — any cancel after the first fetch completes
yields success-after-cancel, which the renderer's Set check swallows: the
image is written to disk but media queries are never invalidated and the
result is silently orphaned. Cancel-after-success also flips a succeeded job
to `cancelled`.

**Sketch.** Keyed machine per jobId: `pending → succeeded | failed |
cancelling → cancelled`; late SUCCEEDED-after-cancel must NOT be a plain
ignore — the cancelled state handles it (invalidate media queries or command
main to delete the file). Main's abort-coverage gap is in scope; fits
`keyed_host` + `snapshot_store` directly. Good early win: small surface,
clear bug, exercises the kernel on a genuinely new domain.

### 4. GitHub repo operation lifecycle (HIGH value, large)

**Scope:** `githubSyncAtoms.ts`, `GitHubConnector.tsx`,
`GithubBranchManager.tsx`; main's `github_handlers.ts` stays (but see the
lock caveat).

**Evidence (verified).** `GithubSyncState` is 7 orthogonal patch-merged
fields — illegal combinations representable; recovery states derived by
parsing error-message substrings (`includes("rebase-merge")`,
`"divergent branches"`); a three-tier fallback _guesses_ rebase-in-progress
(structured code → extra `getGitState` probe → message substring), duplicated
in both components; `isSyncing` written from 8+ sites including a nested
finally that clears it mid-composite; 8 independent in-progress booleans in
GithubBranchManager plus a duplicate conflict store; a generation ref +
prop-edge auto-sync effect.

**Verified reachable bugs:** stale-conflict UI (abort-and-switch clears the
merge but not the atom → "Resolve with AI" targets conflicts that no longer
exist, and would stream a prompt naming files with no conflict markers);
sticky `syncSuccess` banner persisting across history-invalidating
operations. (The mid-composite overlapping-push race was refuted — no await
in the window.)

**Sketch.** One machine keyed by appId: `idle → pushing | rebasing | merging
| switching-branch` with `conflicted(files)` and `rebase-paused` first-class;
`getGitState` becomes a reconcile event; both components project one
snapshot. Caveat from verification: main's `withLock(appId)` covers only the
clean-workspace/auto-commit slices (github_handlers.ts:198, 967) — the
renderer machine carries more serialization burden than it may assume, or
main's lock coverage widens as part of the design. The
`useResolveMergeConflictsWithAI` ref-mirror is chat_stream folding scope
(Part 1), not this machine.

### 5. MCP OAuth loopback flow (MEDIUM)

**Scope:** `src/ipc/utils/mcp_oauth_flow.ts`, entry via `mcp_handlers.ts`.

**Evidence (verified).** Port-keyed `pendingFlows` with manual supersede;
`disposed` closure boolean + map-identity liveness checks re-checked after
the async bind window; raced 500ms close fallback + 5-minute hand-managed
timeout. The densest hand-rolled orchestration left in main outside the
machines, and visibly the pattern connection_flow was built to replace.

**Plausible traced bug (verifier-found):** supersede deletes the old entry,
awaits socket closes, _then_ registers the new flow — a third Connect in that
window is silently clobbered, yielding a misleading EADDRINUSE and an
unsupersedable orphan listener until the 5-minute timeout.

**Sketch.** Per-**port** machine (multiple servers can share the default
callback port; per-serverId keying would break the supersede invariant):
`idle → binding → awaitingCallback → exchanging → connected | failed |
superseded | timedOut`. The state-param CSRF check and
stale-callback-keeps-flow-alive rule become guarded transitions. Include
`runOAuthFlow`'s `provider.abort()` coupling as a command — nudges effort to
the high end of medium.

### 6. Preview iframe identity + navigation + picker (MEDIUM-HIGH, large)

Previously scoped out of app_run as "event-driven UI concerns with their own
working stale guards." **That rationale is now falsified:**
`isComponentSelectorInitialized` is set true once (PreviewIframe.tsx:876) and
never reset, and the remount key omits appId.

**Quick fixes first (chores, regardless of the machine):** key PreviewIframe
by `${selectedAppId}-${token}` (PreviewPanel.tsx:229) — token collisions are
the _common_ case since each app's counter starts at 0 and bumps per run, so
A→B switches routinely skip the remount, leaking picker state, enabled
buttons posting into a listener-less document, preserved-route restore, and
even app A's navigation history into app B.

**Evidence (verified).** `prevAppUrlRef` prop-edge detection as the sole
"app switched" signal; `canGoBack/canGoForward` written by four writers and
recomputed by an effect; `currentIframeUrlRef` written from 10 sites and read
inside a `useMemo` with pseudo-trigger deps; **two parallel reload
mechanisms** with different remount semantics (local `reloadKey` keys only
the `<iframe>`; the per-app token keys the whole component — bumped by
app_run and chat_stream as producers); five copy-pasted `preservedUrls`
mutation blocks; picker/selection state (`isPicking`, restore-handshake
boolean atom) leaking across iframe replacements — a reloadKey remount resets
neither flag, so the picker renders active over an iframe with no selector
(confirmed: requires a double-toggle to recover), and the
`isRestoringQueuedSelectionAtom` handshake leaks when the early-return guard
exits without clearing.

**Sketch.** Per-app machine owning `{history, position, currentUrl,
preservedUrl, iframeEpoch, selectorReady, picking, restoreQueued}` with
`IFRAME_REPLACED` as a real event; `canGoBack/Forward` become selectors; the
two competing React keys collapse into one explicit epoch. The component is
2,196 lines with screenshot/visual-editing concerns interleaved — scope
discipline is the design doc's main job (screenshot pipeline stays out, see
candidate 8; picker/selection is in, as a sub-state or sibling sharing the
iframe-epoch events).

### 7. Neon linkage saga (MEDIUM after the lock fix)

**Chore first (closes the corruption bug):** `neon_handlers.ts` has **zero**
`withLock` calls while github/app/git_branch handlers all serialize per app.
Verified trace: branch-switch parks at a network await; Disconnect (guarded
only by its own boolean) clears the project link and env; the switch resumes
on its stale row snapshot and re-injects `DATABASE_URL` for the disconnected
project — half-linked row with live credentials on disk. `withLock(appId)`
on the five Neon mutation handlers fixes this outright.

**Machine (incremental on top):** per-app `unlinked → linking(create|connect)
→ linked(activeBranch) → switching-branch | unlinking`, making the
compensation cascades (`createProject`'s 4-level unwind, `setActiveBranch`'s
manual revert) explicit states, collapsing the renderer's six booleans into a
projection. Build when Neon work is next scheduled; the lock ships now.

### 8. Screenshot capture pipeline (MEDIUM)

**Chore first:** `pendingScreenshotAppIdAtom` is a single global slot written
by commits and by stream finalization for possibly _different_ apps
(background streams are explicitly supported); a commit's pending capture for
app A is silently clobbered by app B's stream. Making it per-app removes the
verified stale-thumbnail bug without a machine.

**Machine (per-app, medium):** `idle → screenshotPending(source) →
waitingForIframeReady → settleDelay → resolvingCommitHash →
awaitingResponse(requestId) → saving`, replacing two mirrored refs, two
hand-rolled requestId correlations, a 3s `setTimeout`, and five clear sites.
The prior survey deferred this with "at most a shared epoch helper" — that
helper never materialized; the kernel now is that helper. Coordinate scope
with candidate 6 (it consumes the same iframe-load/selector-init events).

### 9. Carried-over opportunistic pair

Unchanged from the prior survey, evidence re-verified at current lines:

- **FileEditor save/dirty** — new since the survey: `fileSaveQueue.ts` fixed
  the IPC-overlap half; the refs+mirrored-booleans dirty/saving tracking
  remains. 4-state machine keyed `appId:filePath` with fileSaveQueue as the
  executor.
- **Voice-to-text** — untouched; `startAttemptRef` generation counter,
  `isStartingRef`, `skipOnStopProcessingRef`, `stopReasonRef`. Small kernel
  machine with an epoch (app_run's runId pattern). Good next-small-PR
  candidate.

### 10. Chat tab session lifecycle (MEDIUM-LOW)

Dual hydration flag (ref + state), hydration inferred from a `loading` prop
edge, hydrate wholesale-replaces the four tab-tracking sets across an async
boundary (verified eviction: a chat opened before the initial chats query
resolves vanishes from the tab bar when hydration lands — real but
sub-second window in practice), 8+ writers to the persisted composite, and a
`prevStreamingRef` notification-dot detector that belongs to the chat_stream
`stream-finished` signal anyway. **Do the hydrate-as-merge fix and the
signal migration; the full machine is opportunistic** — exactly one async
boundary, all mutators synchronous, existing unit tests.

### Deferred with revisit triggers (adjudicated down)

- **Queued-prompt persistence saga** (verifier 75). Machine-shaped
  (7 coordinating refs incl. an object-identity self-echo sentinel), but
  stable, carefully commented, and race-correct today; its one bug
  (hydrate-failure permanently disarms persistence) is a documented
  deliberate clobber-safety tradeoff a machine would still have to solve.
  Revisit on the first hydration bug, or when Part 3's persistence
  convention lands and makes the conversion mechanical. **Chore extracted
  now:** decide persist-vs-strip for `redo`/`appId`/`requestedChatMode` on
  queued items (schema lacks them; a queued Retry silently loses redo
  semantics after restart — persist them zod-optional, or strip explicitly
  and surface it). _(Phase 0: shipped as persist, zod-optional —
  src/ipc/types/queue.ts.)_
- **Deep-link one-slot mailbox** (verifier 78). Real (Date.now()-stamped
  one-slot state, three edge-detecting consumers, verified lost-event paths —
  the cold-start queue flush broadcasts back-to-back and the second link
  overwrites the first; TitleBar clears other links after its awaited
  refetch). But three rare link types make this routing cleanup, not a
  machine: replace the slot with consume-once dispatch (typed handler
  registry + mount-time replay), and **delete the now-vestigial
  supabase/neon `deep-link-received` broadcasts in main.ts** (connection*flow
  has its own channel; no renderer consumer matches those types).
  *(Phase 0: the vestigial broadcasts are deleted; the consume-once
  dispatch remains deferred with the triggers restated in Phase 5's exit
  criteria.)\_

## Part 3: Core architecture

Beyond the micro-kernel. The kernel itself is done and stays frozen; these
are the conventions and facilities the next ten machines need that the first
five got away without.

### 3.1 Cross-process protocol spec + interleaving co-simulation (the anchor)

Motivated directly by the #4008 incident and by the main-engine audit: the
main-side stream lifecycle is **eight** module-level collections
(`activeStreams`, `admissionPendingStreams`, `streamCompletions`, two
block-count maps, two waiter maps, `partialResponses`) with four load-bearing
invariants that exist only as comments — including the admission
check-then-clear atomicity ("Do NOT introduce an `await`…",
chat_stream_handlers.ts:671-685) and the cancelTrackedStreams sole-sender
rule — maintained across four independent writer sites in three handler
files, with zero interleaving tests. The restore saga's barrier-leak hazard
("Leaking the block would permanently stall new streams… until the process
restarts", version_handlers.ts:1030-1032) rests on hand-placed try/finally.

**Stage 1 (medium, high leverage):** a shared pure protocol spec — typed
states/events for the main side of the stream lifecycle (`tracked →
admission-pending → admitted → streaming → unwinding → finalized`) — plus an
interleaving co-simulation harness in `src/state_machines/` that drives a
model of main against the renderer's real pure `transition()` through all
orderings (abort at every await point, barrier install/release at every
boundary) and asserts the renderer machine always reaches a terminal state
and never double-dispatches. This catches the #4008 class _before_ review.
Checklist item: enumerate the compaction saga's (`chats.pendingCompaction`)
interleavings with admission/cancel while building the model — it was never
audited.

**Stage 2 (large, optional, gated on stage 1 passing against current
behavior):** extract the admission/cancel/end-emission core into a real
main-side machine following the connection*flow registry precedent, making
the four invariants structurally unrepresentable. Note the prior survey
\_chose* "main stays the engine" (more-state-machines.md:112-118) — stage 2
deliberately revisits that recorded decision, justified by the barrier
machinery (#3596) that postdates the choice's rationale. Stream identity is
part of the migration cost: main today keys by AbortController identity, not
streamId — coordinate with Part 1 item 7.

`process_manager.ts` (run-state maps + `processCounter` generation guard) is
the same shape at lower severity: no incident, `withLock` holds. Deferred;
if the protocol-spec pattern proves out, a later follow-up unifies renderer
`runId` and main `processId` into one generation token over the run contract.

### 3.2 Composition rule (machine ↔ machine)

rules/state-machines.md is silent on how machines talk to each other, and the
one existing edge (plan_handoff deep-importing chat_stream's registry) is
about to be replicated by every candidate that must trigger chat streams
(user-input round-trip, home saga). **Rule to add:** machines communicate
only through facades injected via their Deps (or events); never import
another machine's registry/controller module; the dependency graph is a DAG
recorded in each machine's header. Part 1 item 5 is the reference migration.

### 3.3 Projection convention

Machines write Jotai atoms ad hoc today (chat_stream's commands write ~8
atoms inline; app_run pushes a run-state projection), and the rules doc says
nothing — which is how `isStreamingByIdAtom` grew multiple writers and
`chatStreamCountByIdAtom` grew three. **Rule to add:** one writer (the
controller/manager), atoms are read-only views, derived in one subscription
from the snapshot rather than per-command writes. Optional kernel helper
`projectSnapshotToAtom(store, atom, selector)` with a dev-mode single-writer
assertion. chat_stream's migration (Part 1) is the proof case.

### 3.4 Shared trace observer / devtools

The kernel defines `TransitionObserver` but the only inspection facility is
version_preview's bespoke ring buffer (`debug.ts`,
`window.__dyadVersionPreviewLog`). Promote it: generic
`createTraceObserver(machineName)` in the kernel — 100-entry ring buffer,
applied + ignored events with reasons, `window.__dyadMachines` index — wired
into all five machines (which also closes 1B's observer gap), with
captured-trace replay through `transition()` documented as a test technique.

### 3.5 Persistence/hydration convention

Three candidates are persistence-shaped (tab session, queue persistence,
user-input rehydration), and the existing precedent is the 7-ref
`useQueuePersistence`. Decide once, before any of them: an explicit
`hydrating` state in machines that need it; persist-as-command with debounce
owned by the adapter; versioned zod schema for stored snapshots; teardown
flush semantics. Add to rules/state-machines.md.

### 3.6 Clock/IdSource injection

connection_flow injects timers and mints flowIds as a one-off; chat_stream
mints streamIds; the new candidates need timers (loopback timeout, settle
delay, deadline) and IDs (requestId, jobId). Add minimal `Clock` and
`IdSource` interfaces to the kernel with fakes in `testing.ts`; extend the
rules doc's degrees-of-freedom section to renderer machines. Retrofit
optional; new timer-using machines must take them injected.

### 3.7 Boundary enforcement (the one still-owed machine-followup item)

The kernel's no-domain-imports rule and the new composition rule (3.2) are
enforced nowhere. Cheapest form: a small vitest that reads
`src/state_machines/*.ts` and asserts imports are relative-or-react only,
plus one asserting no `src/<machine>/` module imports another machine's
modules. An oxlint no-restricted-imports config if/when available.

### 3.8 Testing-kit decision

`src/state_machines/testing.ts` has **zero adopters** — every machine kept
bespoke totality tests. Decide deliberately rather than drift: either migrate
the five machines' matrix tests to `driveTransitionMatrix` (mechanical, low
value) or drop the adoption expectation and keep the kit for new machines
only — and extend it with reachable-state exploration (current driver
requires hand-enumerated states) plus the 3.1 co-simulation harness either
way.

## Targeted concurrency chores (no machine required)

_All seven DONE in Phase 0 (b44e54c3d + 1a7b9964a): Neon serializes via the
new shared `src/ipc/utils/app_mutation_lock.ts`; both token refreshes are
single-flight; PreviewIframe is keyed `${selectedAppId}-${token}`; the
screenshot pending atom is per-app (`pendingScreenshotAppIdsAtom`); queued
items persist `redo`/`appId`/`requestedChatMode` (zod-optional,
src/ipc/types/queue.ts); the vestigial broadcasts are deleted from main.ts;
both consent maps ride the shared resolver. Two NEW chores from the Phase 4
compaction audit are OPEN: (8) thread `abortController.signal` into
`performCompaction` so Stop doesn't wait out a full summary generation;
(9) single-flight the `pendingCompaction` flag so two concurrent streams on
one chat can't both compact. Plus the chat-tab hydrate-as-merge chore from
Phase 5 item 7a._ Original list, kept for the record:

1. **OAuth token refresh single-flight** — `refreshSupabaseToken` /
   `refreshNeonToken` are check-then-act across an await with refresh-token
   rotation; two concurrent calls both POST the same refresh token and the
   loser can invalidate the winner's rotated credentials (Neon's comment
   admits bursts happen). Module-level in-flight-promise dedup.
2. **Neon `withLock(appId)`** on the five mutation handlers (candidate 7).
3. **PreviewIframe key `${selectedAppId}-${token}`** (candidate 6).
4. **`pendingScreenshotAppIdAtom` per-app** (candidate 8).
5. **Queued-item fidelity**: persist-or-strip `redo`/`appId`/
   `requestedChatMode` (deferred queue-persistence candidate).
6. **Delete vestigial supabase/neon `deep-link-received` broadcasts** in
   main.ts (deferred deep-link candidate; check the e2e fake-handler sends).
7. **Consent-map migration onto `userInputResolver`** (candidate 1 stage a —
   also fixes before-quit never resolving MCP waiters).

## Examined and rejected (do not re-litigate without new evidence)

Adjudicated kills and survey rejections, beyond the standing list in
more-state-machines.md (whose entries were re-checked and stand: terminal —
zero commits touching terminal paths since the rejection; attachments;
blueprint atoms — re-read, still a clean event-sourced reducer; Vercel):

- **ImportAppDialog import saga** — killed in verification (score 55): linear
  mutation with dialog-scoped state; its name-check staleness quirk is a
  small fix, and CreateAppDialog next to it shows the correct pattern.
- **Chat-mode default sync + manual-selection latch** — killed (55): a
  deliberate one-way latch plus one declarative sync effect; settings
  synchronization, not orchestration.
- **TypeScript utility-process hosts** (`code_explorer.ts`, tsc scheduler) —
  machine-shaped (generation counter, pending maps, crash-loop guard, idle
  timer) but heavily commented, abstracted behind a scheduler, and covered by
  five test files with no incident history. Revisit trigger: a host-lifecycle
  bug or a second resident-process kind.
- **McpManager client cache** — coalesced-promise cache where promise
  identity is the state; deliberate and defended; supabase_deploy_queue
  category.
- **Problems panel** — request/response TanStack query, stateless handler.
- **previewModeAtom, reload-token pattern as such** — declarative enum / a
  legitimate machine output channel; the real smell is candidate 6's two
  competing keys.
- **Restore-to-message renderer flow** — already owned by version_preview;
  the main-side barrier half is Part 3.1.
- **queue_store.ts / queue_handlers writeChain / git_utils helpers /
  github+git_branch main handlers / supabase functions deploy /
  MigrationPanel / CapacitorControls / useCountTokens / useAttachments /
  theme+dialog flows / useCreateApp / useOpenApp / useSelectChat /
  agentTodos projection / Node-install card / cloud-sandbox banner /
  visual-changes accumulation** — each examined; clean pattern, plumbing, or
  below the bar (one-line reasons recorded in the survey output).
- **Pro/billing gating, Dyad Pro auth return, help-bot streams,
  BackupManager, eval harness** — checked clean by the completeness pass:
  single-shot writes, query polling, one-dialog abort map, sequential
  startup, test infra respectively.

## Phase plans

Phases gate on dependencies, not the calendar; items within a phase are
independent PRs unless a gate is stated. Overview (details in the per-phase
sections below):

| Phase | Contents                                                        | Gates on                   | Status         |
| ----- | --------------------------------------------------------------- | -------------------------- | -------------- |
| 0     | Chores, doc rules, boundary test, resolver migration            | —                          | DONE           |
| 1     | chat_stream convention program (Part 1A remainder)              | —                          | DONE           |
| 2     | voice, image gen, home saga, MCP OAuth + trace/Clock facilities | — (independent of Phase 1) | DONE           |
| 3     | user-input round-trip machine (`src/user_input/`)               | gates met                  | items 3–5 left |
| 4     | stream protocol spec + co-simulation (stage 1)                  | stage 2 gates now met      | stage 1 DONE   |
| 5     | github_ops, preview iframe, screenshot + triggered tail         | gates met                  | next           |

### Cross-phase handshakes (adjudicated)

Five items span phases; ownership is recorded here so no two phase PRs
double-book or contradict each other:

1. **Shared trace observer (3.4)** — owned by **Phase 2 item 1** (the full
   facility incl. the `version_preview` debug.ts migration and
   connection_flow wiring, which also closes 1B's plan_handoff/app_run
   observer gap). Phase 1 PR 1 only threads observer support through
   chat_stream; whichever of the two PRs lands second adds the one-line
   `createTraceObserver("chat_stream")` construction. Neither blocks the
   other.
2. **`stream-finished` signal** — Phase 1 PR 4 creates it and migrates all
   four edge detectors mechanically (ChatPanel, ChatTabs, TestsPanel,
   useIntegrationContinuation). Phase 3 item 4 later deletes
   `useIntegrationContinuation` wholesale. Phase 5 does not touch ChatTabs.
3. **streamId echo** — Phase 1 PR 5 implements the contract change;
   Phase 4 item 1's protocol.ts documents it; Phase 4 **stage 2** gates on
   it (stage 1 does not).
4. **Clock/IdSource (3.6)** — owned by **Phase 2 item 2**. If Phase 3 starts
   first, its item 1 lands them instead (pre-approved by 3.6); Phase 5
   machines consume them.
5. **chatStream facade pattern** — banked in Phase 0 (adapter at
   src/app/layout.tsx:35-46). Phases 3 and 5 replicate it for their submit
   paths; the concrete adapter is always constructed at the composition
   root, never inside a machine module (boundaries.test.ts enforces).

### Phase 0 — chores, doc rules, resolver migration (DONE)

Landed as 448e2a4dd, b44e54c3d, 1a7b9964a, 8ad56501c. Receipts:

- All seven targeted concurrency chores (see that section's annotation),
  including the new shared `src/ipc/utils/app_mutation_lock.ts` primitive
  that Phase 5 item 2 reuses for GitHub.
- rules/state-machines.md gained Composition (line 43), Projections (52),
  and Persistence-and-hydration (61) sections; rules/electron-ipc.md:93
  gained the every-settlement-path terminal-event rule.
- `src/state_machines/boundaries.test.ts` enforces kernel purity and
  machine-to-machine import isolation (3.7); `exploreReachableStates` landed
  in the testing kit (3.8's extension — the kit-adoption decision is:
  new machines use it; existing bespoke matrix tests stay).
- Over-delivery banked: Part 1A item 5 done; item 4's plan_handoff half
  done; candidate 1 staging (a) done; consent settlement broadcasts
  (8ad56501c).

### Phase 1 — the chat_stream program (DONE)

Landed as: PR 1 → #4019, PR 2 → #4021 + #4024, PR 3 → #4025, PR 4 → #4028,
PR 5 → #4023. All exit criteria met; spec below kept as the record.

Bring chat_stream to full convention compliance, fold the last external
stream, and replace every ad-hoc "did a stream just finish?" detector with
one machine-emitted signal. **Characterization net** for every step:
`src/chat_stream/__tests__/{transition,controller,queue_dispatch}.test.ts`,
`src/hooks/useStreamChat.test.tsx`, and the integration suites
`src/ipc/handlers/__tests__/{queued_message,pause_queue,streaming_renderer}.integration.test.tsx`
plus `chat_stream_message_projection.test.ts`. A step that must change a
transition test's expectations is out of scope by definition.

Entry criteria: none beyond Phase 0 (landed).

Five PRs. Two of the survey's seven workstream items ride with their
neighbors rather than standing alone: kernel-type adoption and the
SnapshotStore/dispose rewrite are both consumer-invisible refactors of the
same files (one PR); the adapter's module-state cleanup restructures the
same `commands.ts` instance scoping the host migration creates (one PR).
The fold (PR 3), the signal cascade (PR 4), and the main-process contract
change (PR 5) stay isolated no matter what — they carry the documented
behavior deviations and the cross-process blast radius, and each must be
revertable on its own.

1. **PR 1 — kernel adoption: types, ignore reasons, observer threading,
   SnapshotStore + `dispose()`** (medium). Consumer-invisible; zero
   projection or UI changes.
   - Types half: retype `transition()` with the kernel's
     `TransitionResult<StreamState, StreamCommand, ChatStreamIgnoreReason>`;
     delete the local `TransitionResult` (src/chat_stream/state.ts:147-150)
     and reasonless local `ignore()` (transition.ts:27-29). Canonical reason
     set (exact mapping is the PR's job; the totality test asserts every
     ignore carries one): `"no-active-stream"`, `"stale-stream-id"`,
     `"already-registered"`, `"already-cancelling"`,
     `"chunk-while-streaming"`, `"not-finalizing"`, `"stream-active"`,
     `"too-late-to-cancel"`.
   - The controller stops conflating ignored with command-only-same-state
     (`changed = result.state !== state`, controller.ts:75): it branches on
     `ignoredReason` and reports through `observeTransition`. Thread
     `observer?: TransitionObserver<...>` through
     `ChatStreamControllerOptions` (controller.ts:27).
   - Decision: trace-observer construction is Phase 2 item 1's (handshake 1);
     this PR only threads support. 1B's `useConnectionFlow` binding item:
     **skip recorded**, per machine-followup's explicit-optional status.
   - Store half: replace the hand-rolled listener set (controller.ts:41-65)
     with kernel `SnapshotStore`. Decision: extend SnapshotStore with a
     read-only `subscriberCount(): number` accessor, NOT an onUnsubscribe
     hook — the quiescence trigger point already lives in the controller's
     own `subscribe` wrapper (controller.ts:48-53), so the kernel needs only
     the read-side predicate and GC _policy_ stays out of the kernel.
   - New `ChatStreamController.dispose()`: idempotent; settles the active
     request's `onSettled` with `{ success: false }` (no stranded callers);
     runs a new `ChatStreamCommands.releaseTransport({ chatId, streamId })`
     command wrapping today's `cleanupStreamTransport` (ack timer + chunk
     map + preview clear + `ipc.chatStream.release`, commands.ts:199-207)
     when non-terminal; then `SnapshotStore.dispose()`. It does NOT abort
     main's stream: the production caller (PR 2's chat-deletion path) runs
     after `await ipc.chat.deleteChat`, and main drains streams before the
     mutation (`mutateChatAfterDrainingStreams`, chat_handlers.ts:157-159);
     a stale `release(key, streamId)` is already a no-op (core.ts:591-596).
     Post-dispose `send()` is a reasoned no-op observable via the observer.
   - Tests: extend transition.test.ts (every ignore reasoned; reference
     stability retained); observer assertions in controller.test.ts;
     snapshot_store.test.ts (accessor); controller.test.ts with
     `createRecordingCommandRunner` (dispose emits releaseTransport exactly
     once; post-dispose events ignored; onSettled fired).
   - Exit: zero reasonless ignores; controller implements the kernel
     `KeyedController` shape (getSnapshot/subscribe/dispose).
2. **PR 2 — `ChatStreamManager` host, disposal ownership, instance-scoped
   adapter state** (large).
   - Scope: new `src/chat_stream/manager.ts` wrapping
     `KeyedControllerHost<number, ChatStreamController>`, replacing the
     module-global Map (registry.ts:18) and the `runtimeDeps` singleton
     (commands.ts:101-117; `productionChatStreamCommands` becomes a
     `createProductionChatStreamCommands(depsHandle)` factory).
   - Injection seam (decision): the manager is constructed once in
     `renderer.tsx`'s `App` via `useState` (renderer.tsx:129), passed (a)
     into `registerRendererIpcListeners` as a required option — replacing
     the module import at registerRendererIpcListeners.ts:8, so
     `onChatStreamStart` calls `manager.notifyStreamRegistered(chatId)` —
     and (b) into a `ChatStreamProvider` wrapping `RouterProvider`
     (renderer.tsx:181). `useStreamChat`, `useChatStreamState`, and the
     layout facade (layout.tsx:35-46) read the manager from context;
     `useChatStreamRuntime` becomes `manager.registerRuntimeDeps(...)`.
   - All six current registry importers are migrated HERE (so the exit grep
     is satisfiable): layout.tsx:33, hybrid_chat_harness.tsx:93 (+ its :514
     listener call — the harness constructs its own manager: constructed-
     owner isolation per rules), useResolveMergeConflictsWithAI.ts:13 (its
     two `ensureController(...).send({type:"queue-poked"})` compensations at
     :191/:213 swap mechanically to the context manager — the behavioral
     fold stays PR 3), useStreamChat.ts:13, useChatStream.ts:7,
     registerRendererIpcListeners.ts:8.
   - `manager.disposeChat(chatId)`: `host.disposeKey` + clears the chat's
     residue in `queuedMessagesByIdAtom`, `queuePausedByIdAtom`,
     `chatErrorByIdAtom`, `isStreamingByIdAtom` (today that residue survives
     deletion forever); called in `ChatList.handleDeleteChat` next to
     plan_handoff's (ChatList.tsx:241-242).
   - Quiescence GC preserved as the documented deviation: the
     terminal+settled+unobserved self-GC (registry.ts:20-30) moves into the
     manager as `onQuiescent → host.disposeKey`, documented in manager.ts's
     header as the release path for never-deleted idle chats (safe: terminal
     controllers already released their IPC entry, so PR 1's dispose is a
     no-op for them).
   - Adapter-state half (rides here because this PR creates the per-manager
     factory the instance scoping needs): `turnContexts` (commands.ts:161)
     moves into machine state — `startStream` emits
     `stream-context { streamId, targetAppId }` after async app-id
     resolution (commands.ts:260-270); active states gain
     `targetAppId: number | null`; end/error side-effect commands carry it;
     stale-guarded with `"stale-stream-id"`. The ack throttle maps/timers
     (commands.ts:127-151) and `latestChunkByChatId` scope to the adapter
     instance created per-manager by this PR's factory; cleanup wired
     through PR 1's `releaseTransport`/`dispose`.
   - Deleted: `src/chat_stream/registry.ts` entirely.
   - Tests: new manager.test.ts (ensure/disposeChat/quiescence GC/atom
     residue); extend ChatList integration coverage (deletion clears
     residue); transition matrix regenerated via `exploreReachableStates`
     (stream-context orderings: before/after registered, after terminal);
     adapter test asserts two constructed adapters share no ack state;
     full characterization net.
   - Exit: `grep -r "chat_stream/registry" src/` returns nothing;
     controllers reachable only through a constructed owner; commands.ts
     has zero module-level mutable bindings.
3. **PR 3 — fold `useResolveMergeConflictsWithAI`** (medium). The last
   external stream.
   - Characterization test FIRST (per Risks): new hook test pinning
     createChat → stream → terminal-sync behavior against the invariants
     (chat created, stream runs, messages synced, isResolving cleared,
     queue poked) — not the exact side-effect set (see deviations below).
   - Scope: keep `ipc.chat.createChat` (:74), the selection writes (:92-93)
     and navigation (:103-106); replace the `ipc.chatStream.start` block
     (:110-216) with `manager.ensure(newChatId).send({ type: "submit",
request: { prompt, chatId: newChatId, appId, onSettled } })`.
   - Created-chat decision: no special machine handling — a fresh chat's
     controller is deterministically `idle`, so submit takes idle→starting;
     `requestedChatMode` stays `undefined`, reproducing the legacy wire
     value (machine falls back to the cached chat, absent for a new chat →
     undefined; commands.ts:272-291).
   - `isResolving` decision: set true before createChat; cleared in
     `onSettled` for all outcomes plus the createChat catch;
     `isResolvingRef` stays as pre-createChat reentrancy guard only.
     `refreshApp()` moves into onSettled.
   - Documented deviations (pre-declared so the characterization test pins
     invariants, not literals): stream errors now land in
     `chatErrorByIdAtom` (in-chat display) instead of the legacy
     `showError` toast (:194); the machine's end path runs a superset of
     legacy side effects (completion event, preview reload-token bump,
     pending screenshot — commands.ts:454-472). Both intended.
   - Deleted (the cascade unlocked): the hook's chunk plumbing and direct
     `isStreamingByIdAtom`/`chatStreamCountByIdAtom`/preview writes
     (:96-100, :134-141, :172-176, :195-199, :220-225); both `queue-poked`
     compensations; `useStreamChat.cancelStream`'s non-machine bypass
     branch (useStreamChat.ts:116-124); the machine's two defensive
     projection guards — the runEndSideEffects merge-skip
     (commands.ts:511-518) and the dispatchNextQueued isStreaming check
     (commands.ts:602-609) — with their now-false "plan implementation /
     merge-conflict" comments.
   - Exit: `grep -rn "ipc.chatStream.start" src/` matches only
     src/chat_stream/commands.ts.
4. **PR 4 — `stream-finished` signal + generation-counter deletion cascade**
   (medium).
   - Signal decision: a manager-level callback registry, NOT an atom —
     `manager.subscribeStreamFinished(cb: (e: { chatId, streamId, outcome:
"completed" | "cancelled" | "errored" }) => void)`, emitted from the
     manager's production observer on `finalizing → idle` (outcome from
     `wasCancelled`) and `→ errored`. An atom would be a new
     one-shot-as-state counter — exactly the smell being deleted
     (Projections rule). Thin hook `useStreamFinished(cb)`.
   - Consumers migrated here (handshake 2): useIntegrationContinuation's
     prevStreamingRef edge detector (useIntegrationContinuation.ts:40-53 —
     mechanical swap; Phase 3 deletes the hook wholesale later), ChatTabs'
     notification-dot detector (ChatTabs.tsx:255, 404-431), ChatPanel's
     `store.sub` scroll edge detector (ChatPanel.tsx:279-295), and the
     third detector found during drafting: TestsPanel.tsx:565-573
     (spec invalidation on stream end).
   - ChatPanel's scroll-on-new-stream (streamCount at ChatPanel.tsx:93/141,
     effect :151-177) switches to a derived `streamGeneration(state)`
     selector (`streamId` when active, else `lastStreamId`) over
     `useChatStreamState`. Documented deviation: the scroll fires at submit
     instead of first chunk (double-RAF still waits for the placeholder
     render).
   - `triggerResync`'s staleness guard (resyncChat.ts:101, 118-121) takes an
     injected `isStale: () => boolean`; after PR 3 its only caller is the
     machine's own onChunk (commands.ts:354), which closes over the
     controller snapshot.
   - Deleted: `chatStreamCountByIdAtom` (chatAtoms.ts:83) and all
     writers/readers (commands.ts:321-328, ChatPanel.tsx, resyncChat.ts).
   - Tests: manager.test.ts signal cases (fires once per generation, correct
     outcome, no fire on stale terminals); ChatTabs test extension.
   - Exit: `grep -rn "chatStreamCountByIdAtom\|prevStreamingRef" src/`
     returns nothing.
5. **PR 5 — streamId echo in main payloads** (medium). Defense in depth,
   coordinated with Phase 4 (handshake 3).
   - Contract change (all fields optional — backward-compatible for starts
     whose params carry no streamId, e.g. the merge-conflict hook until
     PR 3 lands, or any pre-upgrade payload): `ChatStreamParamsSchema`
     (src/ipc/types/chat.ts:137) gains `streamId?: number`;
     chunk/end/error schemas (chat.ts:215/234/254) and the
     `chat:stream:start` payload gain `streamId?: number`.
   - Main records the streamId beside the tracked AbortController at
     admission and echoes it at every send site (registration :692; chunks
     :1084/:1129/:1754/:2169; ends :367/:2183/:2192; errors
     :1698/:1850/:2175/:2205 in chat_stream_handlers.ts).
   - `createStreamClient` (core.ts:430) drops chunk/end/error whose payload
     streamId is present and ≠ the entry's — entries stay keyed by chatId,
     so absent-streamId payloads route exactly as today. The `registered`
     machine event gains optional `streamId`; a mismatched registration is
     ignored with `"stale-stream-id"` (absent ⇒ current generation).
   - Tests: core.test.ts (echoed-id routing, absent-id fallback,
     cross-generation drop with two starts on one chat);
     streaming_renderer integration extension; stale-registration
     transition test.
   - Exit: a late terminal from generation N cannot reach generation N+1's
     callbacks even though both key by chatId.

Phase 1 exit criteria:

- [ ] chat_stream imports kernel types; every ignore carries a reason;
      observer threaded (trace wiring per handshake 1).
- [ ] Controller on `SnapshotStore` with `dispose()`; registry.ts deleted;
      controllers owned by `ChatStreamManager` in renderer.tsx and the
      hybrid harness.
- [ ] Chat deletion calls `manager.disposeChat` and clears the four residue
      atoms; quiescence GC documented in manager.ts.
- [ ] `ipc.chatStream.start` appears only in src/chat_stream/commands.ts;
      cancel bypass and both defensive projection guards deleted.
- [ ] `chatStreamCountByIdAtom` and all `prevStreamingRef` detectors gone;
      the four consumers ride `stream-finished`.
- [ ] commands.ts has no module-level mutable state; main echoes streamId
      and the client drops mismatches.
- [ ] Characterization net green throughout.

Sequencing within Phase 1: PRs 1 → 2 → 3 → 4 are strictly sequential —
PR 1's dispose feeds PR 2's host, PR 3 reads the manager from PR 2's
context, and PR 4 needs PR 3's deletion of the counter's last external
writer (PR 3's characterization test can be written any time earlier).
PR 5 needs only PR 1 and proceeds in parallel from then on — its contract
change is reviewed by whoever owns Phase 4's protocol doc. The phase's gate
for downstream phases is PRs 3/4: Phase 3 consumes the
submit-during-finalization enqueue semantics and the signal.

Risk profile (riskiest first): **PR 2** is high-medium — it rewires the
composition root and IPC listener registration (startup-ordering exposure),
migrates six importers including the hybrid harness, and carries the
phase's only transition-graph change (the `stream-context` event); failures
are loud (nothing streams), not subtle. **PR 4** is medium — the widest
subtle surface: the signal fires on `finalizing → idle`, strictly LATER
than the old projection-edge detectors (safer for continuation — messages
are synced — but a timing change on an agent-driving path), plus the
declared scroll-at-submit deviation. **PR 5** is low-medium — mechanical
but wide (~12 send sites), and its one scary failure mode is silent: a
wrong echoed id or a schema slip makes the client drop legitimate events
(frozen stream, the #4008 symptom class); the cross-generation client
tests plus one manual smoke stream are the real net. **PR 3** is
low-medium — low-traffic feature, pre-declared deviations; the sharp edge
is the guard-deletion cascade, sound only once the `ipc.chatStream.start`
grep is green (which its exit criterion enforces). **PR 1** is low —
consumer-invisible, `dispose()` has no production caller until PR 2, and
the only hazard (notify-semantics drift in the SnapshotStore swap) is
exactly what the reference-stability tests pin. Cheap insurance: soak
after PR 2 before landing PR 3, and consider landing PR 5 early (it is
parallel-eligible after PR 1) so generation-tagged events are in
production before PRs 3/4 change stream behavior.

### Phase 2 — first new machines + kernel facilities (DONE)

Landed as: item 1 → #4026, item 2 → #4029, 3a → #4030, 3b → #4032,
item 4 → #4036, item 5 → #4040. Spec below kept as the record.

Four machines on the frozen kernel — image generation (§3), voice-to-text
(§9), home first-prompt saga (§2), MCP OAuth loopback (§5) — plus the two
facilities gated on a first consumer: the shared trace observer (3.4) and
Clock/IdSource (3.6). Nothing here waits on Phase 1: the home saga submits
through a facade over today's `useStreamChat.streamMessage` (exactly as
home.tsx:301-307 calls it now) and is insulated from Phase 1's internals by
the Composition rule.

Entry criteria: Phase 0 landed (verified). No Phase 1 gate.

1. **Shared trace observer** (small; owns handshake 1). Generalize
   src/version_preview/debug.ts into `src/state_machines/trace.ts`.
   - API: `createTraceObserver<S, E, C>(machine, key?, options?: {
maxEntries?, describeState?, describeEvent?, describeCommand?, mute? })`
     returning a kernel `TransitionObserver` (types.ts:65-75); entries
     `{at, machine, key, from, event, to, commands, ignoredReason}` in a
     per-machine 100-entry ring; `getTraceLog(machine?)` exported for
     main-process access; `window.__dyadMachines` (index + `dump()`)
     installed only when `typeof window !== "undefined"` so the same module
     serves connection_flow's main-side registry (observer option at
     registry.ts:71-76). `mute` keeps per-chunk ignores out of the buffer.
   - Decision: delete debug.ts and `window.__dyadVersionPreviewLog` outright
     (dev-only, no programmatic consumers; no deprecation alias).
   - Retrofit in this PR: version_preview manager, plan_handoff + app_run
     provider construction (closing 1B's observer gap), connection_flow
     registry. chat_stream per handshake 1.
   - Tests: trace.test.ts (ring cap, ignored-reason capture, main-safety
     without `window`, replay of a captured trace through version_preview's
     `transition()` as the documented technique).
   - Exit: all convention-compliant machines emit to `window.__dyadMachines`;
     debug.ts gone.
2. **Voice-to-text machine + Clock/IdSource** (medium; owns handshake 4).
   - Kernel additions in `src/state_machines/clock.ts`: `Clock { now();
schedule(cb, ms); cancel(handle) }`, `IdSource { next(prefix) }`, with
     production `systemClock`/`uuidIdSource` and testing fakes
     `createFakeClock()` (manual advance, pending-timer inspection) and
     `createSequentialIdSource()`. Injection assignments: voice takes both;
     image gen takes IdSource (jobId) + Clock (prune `now()`); home saga
     takes Clock (settle delay); the MCP OAuth registry types its injected
     timer/id options with these interfaces; retrofitting connection_flow
     stays optional per 3.6.
   - New machine `src/voice_to_text/{state,transition,controller,commands}.ts`;
     useVoiceToText.ts becomes a thin binding with an unchanged return shape
     (HomeChatInput.tsx:64 and ChatInput.tsx:324 untouched).
   - States: `idle | acquiring{attempt} | recording{attempt} |
stopping{attempt, reason: "user"|"duration"|"size"} |
transcribing{attempt}`. Events: `TOGGLE, MEDIA_ACQUIRED{attempt},
MEDIA_DENIED{attempt,message}, SIZE_LIMIT_REACHED,
DURATION_ELAPSED{attempt}, RECORDER_STOPPED{attempt,hasAudio},
TRANSCRIPTION_OK{attempt,text}, TRANSCRIPTION_FAILED{attempt,message}`.
     Commands: `AcquireMedia, StartRecorder, StopRecorder{reason},
ReleaseMedia, ScheduleDurationLimit, CancelDurationLimit, Transcribe,
DeliverTranscription{text}, NotifyError{message}`.
   - Decisions: no keyed host — one controller per hook mount, disposed in
     effect cleanup (recording is deliberately input-scoped; the two mounts
     are on mutually exclusive routes; documented in controller.ts).
     `dispose()` runs CancelDurationLimit, StopRecorder{reason:none},
     ReleaseMedia through the adapter and discards in-flight
     RECORDER*STOPPED/TRANSCRIPTION*\* results — matching today's
     unmount-discards contract (useVoiceToText.ts:75-91), asserted by a
     recording-runner dispose test. `TOGGLE` in `acquiring` →
     `ignore("start-in-flight")`; `MEDIA_ACQUIRED` with a stale attempt is
     an _applied_ same-state transition emitting `ReleaseMedia`.
   - Deleted: the six coordination refs (`startAttemptRef`, `isStartingRef`,
     `skipOnStopProcessingRef`, `stopReasonRef`, `isMountedRef`,
     `recordingTimerRef`) outright; the four handle/buffer refs
     (`mediaRecorderRef`, `chunksRef`, `recordedBytesRef`, `streamRef`)
     move into the command adapter.
   - Tests: `driveTransitionMatrix` totality (5 flat states — hand
     enumeration is trivial and exact); fake-clock duration-limit;
     stale-attempt release; useVoiceToText.test.ts kept as characterization.
   - Exit: the hook file contains zero `useRef` calls; behavior preserved.
3. **Image generation** (two PRs).
   **3a — main abort-coverage fix** (small; shippable alone, fixes a
   user-visible bug). In image_generation_handlers.ts: (i) the URL-download
   fetch (:151-158) switches to `AbortSignal.any([controller.signal,
downloadTimeoutSignal])`; (ii) `controller.signal.aborted` checks after
   the download and inside `withLock` immediately before `writeFile`
   (:210), throwing `DyadErrorKind.UserCancelled`; (iii) `activeControllers`
   deletion moves to a `finally` — today only :89 and :217 delete it, so
   every failure after the first fetch leaks the entry forever and a later
   cancel of the dead job returns `{cancelled:true}`. Tests: handler vitest
   covering abort-at-each-phase and the leak fix.
   **3b — renderer machine** (medium).
   `src/image_generation/{state,transition,controller,commands}.ts` +
   `ImageGenerationProvider` at the layout root (jobs outlive dialogs; the
   toast is global). Keyed `KeyedControllerHost<string, …>` by jobId via
   injected IdSource (replacing caller-side `crypto.randomUUID()`,
   ImageGeneratorDialog.tsx:99).
   - States: `pending | cancelling | succeeded{result, lateAfterCancel?} |
failed{message} | cancelled`. Events: `JOB_SUCCEEDED{result},
JOB_FAILED{message,kind}, CANCEL_REQUESTED, CANCEL_CONFIRMED{cancelled}`
     (submit is manager-level: creates the controller in `pending` with a
     `GenerateImage` command). Commands: `GenerateImage{params}` (runner
     converts resolve/reject into events per the expected-failures rule),
     `RequestCancel{jobId}` (IPC result → CANCEL_CONFIRMED; a throw becomes
     `{cancelled:false}` — cancel is best-effort by contract),
     `InvalidateMediaQueries`.
   - Late-success decision: SUCCEEDED arriving in `cancelling` is an applied
     transition to `succeeded{lateAfterCancel:true}` emitting
     `InvalidateMediaQueries`, no success toast, and no delete-file command —
     after 3a the only remaining window is IPC latency past the final
     pre-write check, so a late success means the file is durably on disk;
     deleting would add a second failure mode and an appear-then-vanish in
     the library. Transition-cell calls: `CANCEL_CONFIRMED` in `cancelling`
     is an applied same-state transition (bookkeeping; `{cancelled:false}`
     means the job already settled — stay and await the settle event);
     `cancelling → cancelled` happens solely on
     `JOB_FAILED{kind:UserCancelled}`; the `cancelled` state keeps a
     defensive `ignore("already-terminal")` for anything else.
     `CANCEL_REQUESTED` in `succeeded`/`failed` →
     `ignore("already-terminal")` (fixes the succeeded→cancelled flip,
     useGenerateImage.ts:128-131).
   - No renderer cancel timer: every main-side phase either has its own
     120s abort timer (:68-71 generation, :152-155 download) or settles via
     the IPC promise, so the renderer never needs one.
   - Projection: `imageGenerationJobsAtom` becomes a read-only view written
     by one provider subscription; `pendingImageGenerationsCountAtom` /
     `chatImageGenerationJobsAtom` stay derived;
     `dismissedImageGenerationJobIdsAtom` remains view-local. All toast
     orchestration moves into that single subscription (deleting the four
     independent count computations — useGenerateImage.ts:51-53, :111-117,
     :136-143; ImageGenerationToast.tsx:16-24).
   - Migration surfaces: ImageGeneratorDialog.tsx:77-116,
     ChatImageGenerationStrip.tsx:27 (hooks) + :65-80 (retry/cancel), and
     ImageGenerationProgressDialog.tsx:99 (cancel) move to `{start, cancel}`;
     ImageGenerationProgressButton.tsx:12-13 and
     ImageGenerationProgressDialog.tsx:228 are unchanged projection readers.
   - Deleted: `cancelledJobIds` + `markCancelled` (useGenerateImage.ts:26-34),
     the useMutation plumbing and its three status writers,
     `useCancelImageGeneration`'s unconditional mapping (:123-152).
   - Disposal: manager prunes terminal controllers older than 30 minutes on
     each submit via `clock.now()`; disposes all on provider unmount.
   - Tests: `driveTransitionMatrix` totality with the late-success cell
     asserted applied-not-ignored; recording-runner cancel races; projection
     single-writer test.
   - Exit: cancel at any phase either prevents the file or yields
     `succeeded{lateAfterCancel}` with media invalidated — never a silent
     orphan.
4. **MCP OAuth loopback registry** (medium). New main-process machine
   `src/mcp_oauth/{state,transition,registry}.ts` following the
   connection_flow registry precedent (explicitly constructed, injected
   Clock/IdSource, commandless derived-effects documented as the deviation,
   as connection_flow does). mcp_oauth_flow.ts shrinks to the HTTP-listener
   - `auth()` adapter; the entry point (mcp_handlers.ts:422) and the
     `{success, error}` return contract are unchanged.
   * Keying: per **port** (multiple servers share the default callback
     port; per-serverId would break the one-flow-per-port supersede
     invariant). States per port: `idle | superseding{closing, next} |
binding{flowId} | awaitingCallback{flowId} | exchanging{flowId} |
connected | failed{message} | superseded | timedOut` (terminals clear
     the port entry after reporting). Events: `CONNECT{flowId,
expectedState, serverId}, SOCKETS_CLOSED, BINDS_SETTLED{boundHosts,
anyInUse}, AUTHORIZED_SILENTLY, CALLBACK{state, code?, error?},
TIMEOUT{flowId}, EXCHANGE_OK, EXCHANGE_FAILED{message}`. Derived
     effects: `RejectFlow, CloseSockets, Bind, StartTimeout/CancelTimeout,
AbortProvider`.
   * The traced supersede-clobber bug is fixed structurally: `CONNECT`
     while any non-terminal state holds the port transitions to
     `superseding{closing, next}` synchronously — the entry is never absent
     mid-supersede (today `pendingFlows.delete` at mcp_oauth_flow.ts:187
     opens the window) — and a third CONNECT during `superseding` replaces
     `next`, rejecting the queued flow explicitly.
   * Guarded transitions replace comment-enforced rules: `CALLBACK` with
     mismatched state in `awaitingCallback` → `ignore("state-mismatch")`,
     flow stays alive; `TIMEOUT` for a non-current flowId →
     `ignore("stale-flow")`; the HTTP handler consults a
     `claimCallback(port, state)` accessor mirroring connection_flow's
     `ClaimReturnResult`.
   * `provider.abort()` coupling: `registry.connect()` takes an `onAbort`
     callback per flow; `AbortProvider` fires it on every transition into
     `failed | superseded | timedOut`, replacing the
     `listener.code.catch(() => provider.abort())` side-channel (:496). The
     raced 500ms close fallback (:196-203) moves into the `CloseSockets`
     runner, settling as `SOCKETS_CLOSED{forced}`.
   * Deleted: `pendingFlows` map (:51), `PendingFlow`, the `disposed`
     closure boolean + map-identity liveness checks (:221-251, :367-399),
     the hand-managed 5-minute timeout (:25, :401-408).
   * Tests: `exploreReachableStates` totality (phase-projecting `stateKey`,
     per-state event generator — the superseding×connect combinations are
     exactly where the current code went wrong); a triple-Connect
     regression; fake-clock timeout-vs-callback exclusivity; existing
     mcp_oauth_flow.test.ts + integration suite pass unchanged.
   * Exit: three rapid Connects on one port leave exactly one live listener
     and two explicit "superseded" rejections.
5. **Home first-prompt saga** (large). New machine
   `src/first_prompt/{state,transition,controller,commands}.ts` +
   `FirstPromptProvider`.
   - Residence decision: a singleton hosted at the composition root in
     layout.tsx — NOT page-mounted — because the armed payload must survive
     the provider-setup detour across pages: ProviderSettingsPage.tsx:265-268
     and TitleBar.tsx:48-52 currently navigate home just to re-trigger
     home.tsx's resume effect, and SetupBanner.tsx:41 forks on the same
     flag. Those surfaces send `PROVIDER_CONFIGURED` instead; the machine
     emits `NavigateHome` itself.
   - States: `idle | checkingProviders{payload} |
awaitingProviderSetup{payload} | creating{payload} | postCreate{payload,
appId, chatId} | dispatching{appId, chatId} | navigating{appId, chatId}
| failed{payload, message} | failedPartial{payload, appId, chatId,
message}`. The armed payload `{prompt, attachments, selectedApp,
chatMode}` is captured into state — replacing the bare boolean
     `pendingFirstPromptAtom` (chatAtoms.ts:70-71) plus the four scattered
     payload atoms re-read at resume.
   - Events: `SUBMIT{payload}, ARM_FOR_SETUP{payload}, DISARM,
PROVIDERS_LOADED{anySetup}, PROVIDER_CONFIGURED, SETUP_DISMISSED,
APP_CREATED{appId, chatId}, CHAT_CREATED{chatId},
CREATE_FAILED{message}, POST_CREATE_DONE, POST_CREATE_FAILED{message},
SETTLED, PREVIEW_DECISION{opened}, REFRESHED, RETRY, RESET`. The
     non-submit arming path is first-class: the setup pill
     (home.tsx:473-476 → openAiSetupDialog :178-189) sends
     `ARM_FOR_SETUP{payload}` (idle → awaitingProviderSetup without
     creating) and the dialog's close handler (:191-199) maps to
     `SETUP_DISMISSED`/`DISARM` — preserving the type-prompt → configure →
     auto-resume flow the boolean encodes today.
   - Commands: `CreateApp, CreateChat, RunNeonTemplateHook, ApplyTheme,
OpenPreviewIfSetupRequired, SubmitPrompt` (facade over `streamMessage`,
     adapter built at the root per the Composition rule, same shape as
     layout.tsx:35-46), `ScheduleSettle` (Clock — the literal 2s at
     home.tsx:312-314 becomes injected; test mode passes a zero-delay clock
     instead of the `isTestMode` special case), `RefreshQueries,
NavigateHome, SelectChat, ShowSetupDialog, ClearEditingBuffer,
ShowError`.
   - The §2 partial-failure bug is fixed by state, not retry logic:
     `neonTemplateHook`/`setAppTheme` failures land in `failedPartial`
     carrying the created appId/chatId; `RETRY` resumes at
     postCreate/dispatching with the existing app — never a second
     createApp. Concurrency: single-flight; `SUBMIT` outside idle/failed\* →
     `ignore("submission-in-flight")` — closing the double-Enter window
     through the voice-toggle await gap (HomeChatInput.tsx:123-125).
   - Projection: one read-only `firstPromptSagaAtom` `{phase,
hasArmedPayload}` written by the provider subscription; home.tsx's
     spinner and all four flag surfaces read it. Editing atoms
     (homeChatInputValue, attachments, homeSelectedApp) remain the input
     buffer; the machine snapshots them at SUBMIT/ARM_FOR_SETUP and clears
     via `ClearEditingBuffer` at the same commit point as today's :311
     comment.
   - Deleted: home.tsx handleSubmit body (:237-358 → `send(SUBMIT)`), the
     openAiSetupDialog arm/disarm pair (:178-199), `hasAttemptedAutoResumeRef`
     - reset effect (:360-365), the 6-condition auto-resume effect
       (:367-415), `shouldOpenAiSetupDialogWhenProvidersLoad` (:114-117,
       :201-218), `pendingFirstPromptAtom`, home.tsx isLoading/loadingMode.
   - Tests: `exploreReachableStates` totality (the generator provably
     reaches `failedPartial`, which hand-enumerated matrices tend to omit);
     recording-runner sequences for both §2 bug scenarios; home.test.tsx
     migrated to the projection; fake-clock settle test.
   - Exit: create-then-fail never double-creates on resubmit; the
     provider-setup detour resumes without any page-remount effect firing.

Phase 2 exit criteria:

- [ ] trace.ts landed; version_preview/plan_handoff/app_run/connection_flow
      observable via `window.__dyadMachines`/`getTraceLog`; debug.ts deleted.
- [ ] Clock/IdSource in the kernel with fakes; voice/image-gen/home construct
      with them injected; MCP OAuth types its injections with them.
- [ ] Four new machine directories in the boundaries inventory, passing
      isolation.
- [ ] Image gen: main abort coverage complete; late success after cancel
      yields `succeeded{lateAfterCancel}` + invalidation; `cancelledJobIds`
      gone.
- [ ] Voice: zero `useRef` in the hook; API unchanged at both call sites.
- [ ] Home: `pendingFirstPromptAtom` deleted; all four surfaces on the
      projection/events; the 2s literal and both resume effects gone;
      partial-failure resubmit reuses the created app.
- [ ] MCP OAuth: `pendingFlows` gone; triple-Connect regression green;
      existing suites unchanged.

Sequencing within Phase 2, smallest proof first: (1) trace observer — zero
behavior change, instruments everything after it; (2) voice + Clock/IdSource
— smallest machine, exercises both facilities; (3a) then (3b) image
generation; (4) MCP OAuth; (5) home saga last — largest, spans pages,
benefits from every facility proved earlier. Items 2–4 are mutually
independent once (1) merges; (5) gates only on (1) and (2)'s Clock.

### Phase 3 — the user-input round-trip machine (COMPLETE)

Landed as: items 1+2a → #4033, 2b → #4037, followed by items 3, 4, and 5
(questionnaire port, continuation port, and deletion + hardening sweep).

One machine replaces the three hand-synced copies of the agent-paused
user-input round-trip (evidence in Part 2 §1; Phase 0 banked staging (a) —
see the annotated Staging paragraph there). What remains diseased: the
classifier `Promise.race` with an injected fake decline (mcp_consent.ts:170,
:182); eight ad-hoc writers to `pendingToolConsentsAtom`
(registerRendererIpcListeners.ts:75-146, ChatInput.tsx:227/233); no reload
rehydration anywhere; the questionnaire's duplicate renderer deadline
(QuestionnaireInput.tsx:90-105) and nested-setTimeout confirmation fade
(~:203); plan_handlers.ts:199 discarding the resolver's matched result while
integration_handlers.ts:14-22 throws NotFound for the same condition; and
the continuation's write-before-IPC hazard (useIntegrationContinue.ts:53-62).

Entry criteria:

- Phase 1 PR 3 landed — the real gate is the **submit-during-finalization
  enqueue semantics** (a follow-up submitted through the facade while the
  prior stream finalizes must enqueue, never drop). The renderer's
  `stream-finished` signal drives only button state here; it does NOT feed
  the main registry (main uses its own stream-end knowledge — see item 4).
  Gates item 4 only; items 1–3 do not need it.
- Kernel Clock/IdSource landed with a Phase 2 machine; if Phase 3 starts
  first, item 1 lands them (pre-approved by 3.6).

Design decisions (resolved):

- **One generic machine, not a core with three instances.** The transition
  graph is identical across flows except two legs that are guards, not
  kinds: the classifier race (present only when the descriptor carries a
  classifier) and the armed follow-up leg (only with `followUpPrompt`).
  Three instances would triple the respond/get-pending contract surface,
  and the per-chat sweep must clear a consent AND a questionnaire in the
  same chat atomically — one keyed registry, one sweep. The divergent UI
  surfaces (ChatInput banner, QuestionnaireInput panel, DyadAddIntegration
  card) are projections filtered by `kind`; divergence lives in components,
  never in `transition()`.
- **Main-authoritative registry; the renderer is a projection.** Validated
  against connection_flow's registry: same shape — one authoritative
  process, injected timers/ids/broadcasts, timeout-vs-decision mutual
  exclusion through a single pure transition. A renderer machine cannot fix
  bugs 1/3/4: the parked promise, the deadline, and the armed continuation
  must all survive renderer reload, so the state lives where the promise
  lives. Renderer-side there is no controller — a read-only projection
  adapter plus thin per-surface hooks; the adapter and its `chatStream`
  facade are constructed at the composition root, mirroring
  layout.tsx:35-46.
- **Commands-as-data, not connection_flow's derive-effects deviation.**
  Settlement effects vary by kind (persist always-consent, resolve the park
  with a kind-mapped value, arm a follow-up), so the registry returns
  kernel `TransitionResult` commands executed by an injected runner.
  Timers/ids via kernel Clock/IdSource.
- **Keying:** requestId (minted by main's IdSource, kind-prefixed) primary;
  per-chat index for sweeps. Unknown requestIds are ignored with
  `"unknown-request"`, never auto-created.
- **NotFound semantics win.** integration_handlers.ts:14-22 is correct;
  plan_handlers.ts:199 is the bug (bug 3's positive-feedback lie). Unified
  `respond` dispatches `human-decided`; if the transition is ignored
  (`"already-settled"`/`"unknown-request"`) the handler throws
  `DyadErrorKind.NotFound`. Renderers show confirmation UI only on a
  successful respond; on NotFound they re-read the projection and toast
  "request expired".
- **Stream-end feeding (main-side, explicit mapping).** The five sweep call
  sites (chat_stream_handlers.ts:349, :2228; local_agent_handler.ts:141,
  :1274, :1792) all map to `chat-swept(chatId)` — they fire on cancel/
  abort/cleanup paths. `stream-finished(chatId)` is emitted from the
  handler's natural-completion unwind only. Armed entries on `chat-swept`
  settle as `swept` WITHOUT dispatch (a cancelled stream must not
  auto-continue); armed entries advance only on `stream-finished`.

Generic core (enumerated once). Per-request state:
`awaiting(classifier: none | racing | review)` → `armed(followUpPrompt)`
(follow-up kinds only) → `due(followUpPrompt)` (stream finished; dispatch
owed) | `settled(outcome: human | classifier-approved | timed-out | swept |
superseded | dispatched)`. Events: `requested(descriptor)`,
`human-decided(response)`, `classifier-decided(approved, reason)`
(classifier failure maps to `approved:false` — fail closed to review, as
today), `timed-out(requestId)`, `chat-swept(chatId)`,
`stream-finished(chatId)`, `follow-up-dispatched(requestId)`. Commands:
`broadcast-requested`, `broadcast-classified`, `broadcast-settled(outcome)`
(the every-settlement-path terminal event — rules/electron-ipc.md:93,
banked by 8ad56501c for consents; the machine generalizes it),
`broadcast-follow-up-due(chatId, prompt)`, `resolve-park(requestId, value)`,
`persist-always(kind payload)`, `schedule-deadline(requestId, ms)`,
`cancel-deadline(requestId)`. Deadlines stay per-kind (5 min consents/
questionnaire, 30 min integration) with exactly one source: the registry
clock. **Bug-4 window closed properly:** `armed → due` on stream-finished
(broadcasting `follow-up-due`); the entry settles as `dispatched` only when
the renderer acknowledges via the `follow-up-dispatched` respond leg — and
`getPending` returns `due` entries, so a renderer that reloads mid-dispatch
re-dispatches idempotently on remount.

Bug → design element map (Part 2 §1): (1) reload-invisible consent →
`getPending` + projection hydration on mount; (2) decline dropped after
classifier-approve → single settlement transition: `classifier-decided` and
`human-decided` are correlated events, first applied wins, the loser is
`ignore("already-settled")` surfaced via NotFound + trace observer — the
fake-decline injection ceases to exist; (3) answers lost with positive
feedback → one deadline source, `broadcast-settled(timed-out)` removes the
UI the moment main times out, confirmation renders only on successful
respond; (4) continuation stalls after reload → `armed`/`due` are main-owned
states returned by `getPending`, arming happens inside the respond
transition atomically before the park resolves.

1. **`src/user_input/` machine core + IPC contract** (large).
   - `state.ts`/`transition.ts` (pure, kind-discriminated descriptor union
     for `mcp-consent | agent-consent | questionnaire | integration`),
     `commands.ts` (types + main effects runner), `registry.ts` (explicitly
     constructed; injected Clock/IdSource/broadcast/runner;
     `park(requestId)` returns the promise the tool awaits;
     `request/respond/sweepChat/streamFinished/getPending/dispose` API;
     `dispose()` = abortAll for before-quit). Duplicate `requested` for a
     live requestId supersedes (old park resolves null, outcome
     `superseded` — matches user_input_resolver.ts:44-45).
   - New contract `src/ipc/types/user_input.ts`: `respond`
     (`user-input:respond`, throws NotFound on ignored decide), `getPending`
     (returns pending/armed/due descriptor snapshots incl. `deadlineAt` —
     precedent: connection_flow's `getStates`); events `requested`,
     `classified`, `settled`, `followUpDue`. Register in ipc_host; add
     `src/user_input/` to the boundaries inventory. No consumers wired yet.
   - Tests: transition totality via `exploreReachableStates` (all orderings
     of human/classifier/timeout/sweep); registry.test.ts with fake
     Clock/IdSource + recording runner (deadline single-source, cross-kind
     chat sweep, park/resolve mapping, supersede, due-entry idempotence,
     dispose).
   - Exit: machine + contract green with zero production callers.
2. **Consent port** (split into two PRs).
   **2a — main-side port** (medium): `requireMcpToolConsent`
   (mcp_consent.ts:98-198) becomes stored-consent check +
   `registry.request(...)`; the classifier hook dispatches
   `classifier-decided` — DELETE the Promise.race block (:135-197 collapses
   to ~20 lines). `requireAgentToolConsent` (tool_definitions.ts:260-312)
   likewise; DELETE both resolver instances (mcp_consent.ts:13-36,
   tool_definitions.ts:164-196); rewire the five sweep sites to
   `registry.sweepChat`. Legacy consent channels keep emitting (dual
   emission) until item 5. Race test: settle `classifier-decided(approved)`
   then invoke respond with Decline in the same tick — tool proceeds,
   respond rejects NotFound, observer logs `ignore("already-settled")`.
   Standalone-revertable.
   **2b — renderer projection + rehydration** (medium): one subscription in
   `src/user_input/projection.ts` (mounted from registerRendererIpcListeners)
   is the SINGLE writer of a new `userInputRequestsAtom`; on mount it calls
   `getPending` (merge: events during hydration win by requestId, per the
   Persistence rule). `pendingToolConsentsAtom` becomes a derived read-only
   view during migration; ChatInput's optimistic remove/rollback
   (ChatInput.tsx:227/233) moves into the adapter as a
   `respondingRequestIds` overlay so single-writer holds. DELETE the five
   consent listeners (registerRendererIpcListeners.ts:73-140) plus the
   consent leg of the stream-end sweep (:143-146). **Repoint
   useNotificationHandler's consent legs** (agent.onConsentRequest :340,
   mcp.onConsentRequest :354, mcp.onConsentClassified :369) at the new
   `requested`/`classified` events — OS notifications must keep firing.
   Rehydration test: unmount/remount the harness renderer mid-consent;
   `getPending` resurfaces the banner and clicking still resolves the park
   (extend src/ipc/handlers/**tests**/local_agent_consent.integration.test.tsx).
3. **Questionnaire port** (medium). planning_questionnaire.ts:149-153 parks
   on the registry (kind `questionnaire`); plan_handlers.ts:196-201's
   `respondToQuestionnaire` is DELETED in favor of unified respond (NotFound
   semantics — the bug-3 fix). DELETE the renderer 5-min timer
   (QuestionnaireInput.tsx:90-105), the nested fade timeouts (~:203), and
   `questionnaireSubmittedChatIdsAtom` (planAtoms.ts:37): the confirmation
   renders from a short-lived settled entry the projection adapter retains
   (`settledAt` + one adapter-owned timer + CSS transition).
   `pendingQuestionnaireAtom` becomes a derived view; DELETE the
   `plan:questionnaire` listener leg in usePlanEvents.ts:74-82 and the
   sweep leg (registerRendererIpcListeners.ts:147-152). Repoint
   useNotificationHandler's questionnaire leg (~:387) at the new events.
   Test: main times out → `settled(timed-out)` broadcast clears the panel;
   a subsequent submit gets NotFound and shows no confirmation.
4. **Continuation port** (medium; gated on Phase 1 PR 3). add_integration
   parks with `followUpPrompt`; respond transitions `awaiting → armed`
   atomically before the park resolves; the registry's own
   `stream-finished` (main-side, natural completion only — see the feeding
   decision) moves `armed → due` and broadcasts `follow-up-due`; the
   renderer adapter submits through the injected `chatStream` facade and
   acknowledges via `follow-up-dispatched`. DELETE
   useIntegrationContinuation.ts entirely and its mount site,
   `pendingContinuationProviderAtom`, the integration sweep leg
   (registerRendererIpcListeners.ts:153-158); `pendingIntegrationAtom`
   becomes a derived view — which requires deleting useIntegrationEvents.ts's
   atom write (:33-37) and re-homing its `showUserInputNotification` call
   (:39) onto the new `requested` event; useIntegrationContinue shrinks to
   a respond call + projection reads. Tests: respond → renderer remount →
   `getPending` returns the armed/due entry; stream end → follow-up
   submitted exactly once through a fake facade; reload between Continue
   and stream end no longer loses the message (bug 4).
5. **Deletion + hardening sweep** (small). DELETE: userInputResolvers.ts,
   src/ipc/utils/user_input_resolver.ts + test (the registry's park
   absorbed it), the superseded contracts/events (agent.ts:160/:176/:182,
   mcp.ts:267 + events :325-336, plan.ts:110/149, integration.ts:28-36) and
   their preload channels, and the compatibility views once all readers
   migrated. Migrate the e2e fake sends
   (e2e-tests/chat_completion_notifications.spec.ts:365-497) to the new
   channels — useNotificationHandler is the production counterpart those
   specs assert on. Wire `registry.dispose()` into before-quit next to the
   stream abort (chat_stream_handlers.ts:554); wire the trace observer.
   Exit greps cover both the old atoms AND the old channel names.

Phase 3 exit criteria:

- [x] All four flows round-trip through `src/user_input/`; the resolver
      instances and legacy consent paths deleted.
- [x] `Promise.race`/fake-decline gone; the race is a transition-matrix
      test.
- [x] One writer for the projection; the eight legacy mutation sites
      deleted; `getPending` rehydrates after reload (integration-tested);
      OS notifications still fire (useNotificationHandler on new events).
- [x] One deadline source; stale responds throw NotFound uniformly;
      confirmation UI cannot play on a dead request.
- [x] useIntegrationContinuation.ts and useIntegrationEvents' atom write
      deleted; follow-ups dispatch exactly once, survive reload, and never
      fire into a cancelled chat.
- [x] boundaries inventory covers `src/user_input/`; verification block
      green plus `npm test -- src/user_input/` and the consent integration
      suite.

Sequencing within Phase 3: item 1 gates everything. 2a → 2b → 3 (item 3
rebases on 2b's projection plumbing); item 4 additionally waits on Phase 1
PR 3 and can land any time after that gate opens; item 5 strictly last.
Items 2–4 may interleave with Phase 4 work.

### Phase 4 — stream protocol spec + co-simulation (STAGE 1 DONE)

Landed as: PR A → #4027 (driver), PR B → #4031 (protocol + model + suite +
tripwire + compaction scenarios). Stage 2 (item 7) remains unscheduled —
but note both of its entry gates are NOW SATISFIED (cosim suite green;
streamId echo landed as #4023), so opening it is a decision to make, not a
dependency to wait on. Still open from item 6's audit: the two compaction
chores (thread the abort signal into `performCompaction`; single-flight
the `pendingCompaction` flag).

Build the cross-process stream protocol as a checked artifact instead of
comments: a pure shared protocol module, a pure model of main's stream
lifecycle grounded line-by-line in chat_stream_handlers.ts, and an
interleaving co-simulation harness that drives that model against the
renderer's real `transition()` — reproducing the #4008 deadlock class
before review instead of after release. **Stage 1 requires zero production
behavior changes** (the one allowed edit is type-only, item 1); stage 2 is
specified only as a gated follow-on (item 7). The co-simulation harness is
a pre-authorized named facility under the Risks section's kernel-freeze
guardrail.

Entry criteria: none. Stage 1 does not depend on Phase 1 — the driver
detects ignores structurally (same reference + zero commands) and consumes
the machine's local `TransitionResult`; Phase 1's kernel-types migration
changes neither the state/event alphabet nor the harness API (only the
suite's ignore assertions may tighten once reasons exist).

1. **`src/chat_stream/protocol.ts` — shared protocol module** (small).
   - Pure, types-plus-constants: wire event names, payload types aliased
     from `@/ipc/types` (type-only imports keep it pure), the FIFO delivery
     assumption (Electron delivers `webContents.send` in order — an
     explicit protocol assumption the co-sim encodes as single-queue
     delivery), and the invariants I1-I4 as named doc-commented constants.
   - **Per-generation emission contract, stated faithfully to current
     behavior** (a naive "exactly one terminal" contract is falsified by
     three reachable paths and would force an unfaithful model):
     `cancelTrackedStreams` is the SOLE `wasCancelled:true` sender
     (chat_stream_handlers.ts:370, grep-pinned); the handler emits at most
     one non-cancelled end, and MAY emit error+end together on the
     apply-error path (:2174-2190); the handler's `!aborted` guard at :2122
     is not re-checked before its end emission, so a cancel landing during
     the post-:2122 awaits legally yields cancel's early terminals PLUS a
     late handler end; the outer catch emits error even when aborted
     (:2202-2208). Late/duplicate handler terminals after cancel are LEGAL
     protocol behavior — the renderer machine is explicitly built to
     tolerate them (finalizing/errored ignore stream-ended,
     transition.ts:311/:337).
   - Layout decision: protocol + model live in `src/chat_stream/`, NOT the
     kernel — the kernel-purity test forbids kernel files importing
     `@/ipc/types` (boundaries.test.ts:84-87), while main handlers importing
     `src/chat_stream/protocol.ts` is legal (handlers aren't a policed
     machine dir; precedent connection_flow_handlers.ts:11-16).
   - The one production edit: chat_stream_handlers.ts adopts type-only
     imports from protocol.ts so its emissions typecheck against the shared
     contract (the `satisfies ChatResponseEnd` pattern already exists at
     :371/:2190/:2196).
   - Exit: protocol.ts merged; handler emissions typecheck; zero runtime
     diff.
2. **`src/chat_stream/main_model.ts` — the pure main-side model** (medium).
   - Per-stream states, each grounded in the handler: `tracked` (completion
     registered :587, controller + admission marker :601-602, before the
     first await at :616) → `admission-pending` (the while-loop :632) ↔
     `waiting-chat-barrier` (:633-644) ↔ `waiting-app-barrier` (:657-669,
     re-loops) → `admitted` (barrier-check + marker-clear + start-emit is
     ONE atomic model action — :685-692 has no intervening await) →
     `streaming` (each await an interleaving point; abort observed at
     :537/:2102/:2122 — plus the post-:2122 awaits as explicit points, per
     item 1's contract) → `unwinding-completed | unwinding-errored |
unwinding-aborted` → `finalized` (finally :2211-2236: untrack,
     `chat:stream:end` iff not aborted :2223-2225,
     resolve-completion-before-untrack :2231-2236).
   - Abstraction recorded in the module header: completion registration and
     controller tracking are collapsed into `tracked`, though validation
     failure (:592-597) leaves a completions-only entry — with the two
     call-site asymmetries noted (cancelTrackedStreams includes
     completions-only chats :329-338; cancelActiveStreamsForApp excludes
     them :409-415).
   - Events: `request-received`, `barrier-installed{scope}` /
     `barrier-released{scope}`, `cancel-chat` (compound, modeling
     cancelTrackedStreams :325-382: abort every tracked controller of the
     chat INCLUDING admission-pending ones, emit end{wasCancelled}+stream:end
     immediately :366-373, then block on completions), `cancel-app`
     (**chat-granularity**, modeling :409-415 + :346-353: select the app's
     chats having ≥1 non-admission-pending controller, then abort ALL
     controllers of the selected chats — pending included; chats whose
     controllers are all admission-pending, and completions-only chats, are
     skipped), `llm-settled{completed|errored|aborted}`, `handler-unwound`,
     `quit` (:554-566).
   - The four invariants as executable assertions, stated checkably:
     **I1** (admission atomicity, transition-scoped): the admission action
     never FIRES while a covering barrier count > 0 — streams already past
     admission when a barrier installs are unaffected (that is I3's
     territory; the restore sequence legally installs barriers before
     cancelling, version_handlers.ts:1024-1026). **I2** (sole-sender):
     `wasCancelled:true` is emitted only by the cancel action, and
     `finalized` never emits `chat:stream:end` for an aborted stream —
     duplicate non-cancelled handler terminals stay legal per item 1.
     **I3** (early-notify safety): after cancel's early terminals, no
     stream reaches `admitted` for a barred scope until release. **I4**
     (barrier hygiene, stated as its checkable consequence): given all
     injected barriers released, at quiescence both block-count maps are
     empty and no stream is parked in `waiting-*` (exercises the
     waiter-wakeup logic :219-234/:253-258 and the re-loop); bracket
     placement in callers is out of model scope — covered by
     version_handlers' try/finally and item 5's tripwire.
   - Tests: main_model.test.ts — totality via `exploreReachableStates`, one
     scenario per invariant, quit-at-every-state smoke.
   - Exit: model merged, all invariant assertions passing standalone.
3. **`src/state_machines/cosim.ts` — generic interleaving driver** (medium).
   - Kernel extension in the testing.ts mold: domain-free, imports only
     `./types`, passing the kernel boundary check. API:
     `runCosim({ participants, channels, scenario, assertions,
maxSchedules })` — participants are structural
     `(state, event) => { state, commands }` (compatible with kernel and
     local result shapes; ignores detected structurally); channels are FIFO
     queues; the scheduler enumerates interleavings by DFS over enabled
     actions (advance a participant, deliver a channel head, inject a
     scenario action) with a seen-set on (state keys, channel contents), a
     `maxSchedules` bound, and shortest-failing-schedule reporting (the
     failing trace as an ordered action list a reviewer replays by hand).
   - Justification for kernel placement: named facility in Risks;
     process_manager.ts is the recorded second consumer if the pattern
     proves out.
   - Tests: cosim.test.ts — a toy two-party protocol with a seeded lost-ack
     bug the driver must find; determinism of trace minimization;
     boundaries suite stays green.
   - Exit: driver merged; toy-bug detection proven.
4. **The co-simulation suite** (large):
   `src/chat_stream/__tests__/cosim.chat_stream.test.ts`.
   - Binds the item-2 model to the REAL `transition()` with the adapter's
     event mapping replicated exactly: `chat:stream:start` → `registered`;
     chunk → `chunk-received{streamId}`; end → `stream-ended{streamId}`;
     error → `stream-errored{streamId}`; `finalize-complete{ok}` scheduled
     by the driver as a separate step after `run-end-side-effects` (its
     delivery position is itself an interleaving point — submits during
     `finalizing` must enqueue). Renderer commands feed back into the
     model: `start-stream` → `request-received`, `request-abort` →
     `cancel-chat`, `dispatch-next-queued` → counted, `enqueue-message` →
     scenario queue.
   - Interleaving generation: abort injected before every model
     await-point; barrier install/release bracketed around every step
     boundary (chat and app scopes); FIFO delivery. Scenario alphabet
     bounded to one chat, ≤2 sequential submits + 1 queued message, 1
     cancel, 1 barrier pair, 1 quit — small enough to exhaust, large enough
     to cover the queue-dispatch and cancel races.
   - Assertions per schedule: (a) the renderer reaches a terminal state at
     quiescence and `isStreamActive` is false; (b) at most one
     `dispatch-next-queued` per generation (the finalizing→idle
     single-dispatch guarantee); (c) **the FIRST terminal carrying the
     current generation must advance the machine; subsequent
     same-generation terminals must be ignored with no state change** (the
     legal-duplicates contract from item 1, as a positive assertion);
     (d) model invariants I1-I4 hold.
   - First regression case — #4008: the scripted schedule submit → cancel
     in `cancelling{registered:false}` → model cancel path emits
     end{wasCancelled} with `chat:stream:start` never sent → renderer must
     finalize (transition.ts:235-259). Paired with a harness self-test: a
     deliberately mutated transition that waits for `registered` before
     finalizing (the pre-3ac500962 bug) must be reported as a deadlock with
     a minimal trace — proving the harness detects the incident class.
   - Exit: suite exhausts the bounded alphabet green; the mutant self-test
     fails as designed.
5. **Gating: drift tripwire + suite naming** (small).
   - Decision: no bespoke CI job — the suite lives under
     `src/chat_stream/__tests__/cosim.*.test.ts`, so the plan's standard
     verification command and default CI already run it.
   - Enforcement that handler changes can't outrun the model:
     `src/ipc/handlers/__tests__/chat_stream_protocol_drift.test.ts`,
     AST-based source assertions (boundaries.test.ts already parses
     production sources with the TS compiler API), pinning: (a) no `await`
     between the app-barrier check and `admissionPendingStreams.delete`
     (:657-686); (b) `wasCancelled: true` appears in exactly one production
     emission site (:370); (c) the finally-block `chat:stream:end` is
     guarded by `!abortController.signal.aborted` (:2223-2225). Each
     failure message names main_model.ts and the cosim suite as the things
     to update in the same PR. A banner comment on the four grounded
     handler regions points at the model.
   - Exit: tripwire red under a synthetic violation of each pinned fact.
6. **Compaction interleaving checklist** (small). Compaction runs inside
   the stream body post-admission (local_agent_handler.ts:568-585), so it
   inherits `streaming` — no new model states. Two scenarios encoded, two
   findings recorded as NEW chores (not stage-1 code changes):
   - Cancel-during-compaction: `performCompaction` receives no abort signal
     (compaction_handler.ts:189-210, loop :220-223), so an aborted stream
     keeps summarizing and broadcasts completion after the renderer was
     told the stream ended. Model as legal (the handler's completion
     resolves only after unwind, so restore/delete stay safe); record the
     UX gap (Stop latency = full summary generation) as a chore: thread
     `abortController.signal` into `performCompaction`.
   - Double-compaction: two concurrent streams on one chat can both read
     `pendingCompaction=true` (local_agent_handler.ts:574) before either
     clears it, inserting two summaries. Encoded as a model scenario
     documenting current behavior; chore candidate:
     clear-flag-before-summarize or single-flight per chat.
   - Everything else in src/ipc/handlers/compaction/ examined clean.
7. **Stage 2 — main-side machine extraction (gated follow-on; NOT
   scheduled)** (large, later). Entry gates, recorded verbatim: (1) the
   stage-1 model reproduces current behavior — cosim suite green AND the
   timing-sensitive suites green without expectation changes
   (cancelled_message, local_agent_cancel_todos,
   chat_stream_message_projection, queued_message, pause_queue,
   streaming_renderer); (2) Phase 1 PR 5's streamId echo landed — main
   keys streams by AbortController identity today (activeStreams :162,
   partialResponses :308) and a real machine needs the generation as its
   key. Scope when it opens: the admission/cancel/end-emission core only,
   as an explicitly constructed registry per the connection_flow precedent,
   making I1-I4 unrepresentable; the LLM body (retry loops :1941-2010 and
   :2028-2060, consent parking, compaction) stays imperative, invoked as a
   command. This deliberately revisits more-state-machines.md:112-118's
   "main stays the engine" decision, per Part 3.1.

Phase 4 exit criteria:

- [ ] protocol.ts merged with the faithful emission contract; handler
      emissions typecheck; zero runtime diff.
- [ ] main_model.ts encodes the states/events/emissions with I1-I4 (as
      restated) passing.
- [ ] cosim.ts merged; kernel boundary green; toy-bug detection proven.
- [ ] Co-sim suite exhausts the bounded alphabet green; #4008 regression
      passes; the mutant self-test fails with a minimal trace.
- [ ] Drift tripwire pins the three source facts.
- [ ] Compaction scenarios encoded; the two findings recorded as chores.
- [ ] Stage 2 unstarted, both entry gates recorded.

Sequencing within Phase 4: item 1 first (everything imports it); items 2
and 3 in parallel; item 4 gates on both and is the bulk; items 5 and 6
branch off item 4's skeleton. Item 7 is a recorded gate, not work. Nothing
here blocks or is blocked by Phases 1–3.

### Phase 5 — big renderer machines + triggered tail (NEXT — nothing landed)

Both entry criteria are now met (#4025 folded the merge-conflict stream;
#4029/#4026 landed Clock/IdSource and the trace observer). Every item below
remains to do.

The two large renderer machines (github_ops; preview iframe
identity/navigation/picker), the screenshot machine sharing the iframe's
postMessage adapter, an honestly re-scoped Neon item, and the
trigger-gated tail. Phase 0 already banked the biggest §6/§8 symptoms:
PreviewIframe is keyed `${selectedAppId}-${key}` (PreviewPanel.tsx:230), so
the cross-app leaks (picker state, history, preserved-route bleeding into
app B) are FIXED — only same-app `reloadKey` leaks remain;
`pendingScreenshotAppIdsAtom` is per-app; and the five Neon mutation
handlers are whole-op serialized via `createAppMutationLock`
(neon_handlers.ts:51-63), demoting the Neon machine to UI consolidation.
These specs are written against that reality.

Entry criteria:

- Phase 1 PR 3 landed (the github_ops resolve-with-AI command routes
  through the `chatStream` facade; today useResolveMergeConflictsWithAI
  still streams directly).
- Phase 2 landed Clock/IdSource (screenshot settle delay + requestId
  minting) and `createTraceObserver` (wired into every machine built here).

1. **GitHub structured error codes through the IPC envelope** (small).
   - Root cause, sharper than §4 recorded: the renderer's structured checks
     are dead code by construction — `SerializedIpcError` has no `code`
     field (core.ts:167-172), `serializeIpcError` drops it (:214-233), and
     `deserializeIpcError` discards `name` for any error with a valid
     `DyadErrorKind` (:242-253), so `GitStateError.code`
     (git_utils.ts:2339-2350) never crosses the boundary and the `err?.code`
     checks (GitHubConnector.tsx:253-256, GithubBranchManager.tsx:205)
     always see undefined — which is why the probe and substring fallbacks
     always run.
   - Decision: extend the ENVELOPE, not the domain contracts — add
     `code?: string` to `SerializedIpcError`, copy it in serialize, restore
     both `name` and `code` in deserialize (every domain gains coded errors
     for free). Extend `GIT_ERROR_CODES` (git_utils.ts:2353-2357) with
     `MERGE_CONFLICT`, `NON_FAST_FORWARD`, `DIVERGENT_BRANCHES`,
     `UNCOMMITTED_CHANGES`; main parses git output once (the substring
     checks at github_handlers.ts:864-875 and git_branch_handlers.ts:218-230
     move into git_utils as coded throws).
   - Tests: envelope round-trip preserves name/code; handler tests assert
     coded throws.
   - Exit: a renderer test matches `error.code === "REBASE_IN_PROGRESS"`
     across a real round-trip.
2. **Widen main's per-app lock to whole GitHub mutations** (medium).
   - The lock-coverage call, resolved: **main widens; renderer machine
     serialization is UX, not correctness.** Current coverage is
     check-slices only (github_handlers.ts:198 auto-commit; :967-969 rebase
     clean-check) while `handlePushToGithub` runs setRemote+pull+push
     unlocked (:807-907) and git_branch_handlers locks the clean-check but
     runs gitCheckout/gitMerge outside it (:208/:211-215, :309/:312-316).
     Justification: version_handlers, chat_handlers, proposal_handlers, and
     app_handlers already take `withLock(appId)` for their git writes —
     main's lock is the only place UI ops, stream auto-commits, and restore
     barriers all meet; a renderer machine can never exclude the non-UI
     writers.
   - Mechanics: wrap the mutation handlers at registration with Phase 0's
     `createAppMutationLock` (Neon precedent, neon_handlers.ts:51-63):
     push, rebase, rebaseAbort/Continue, disconnect, createRepo,
     connectExistingRepo, mergeAbort, pull, fetch,
     create/delete/switch/rename/mergeBranch. **`withLock` is
     non-reentrant** (lock_utils.ts:29-48): every inner `withLock(appId)`
     reachable from a wrapped handler is removed in the same PR — all four:
     github_handlers.ts:198, github_handlers.ts:967-969,
     git_branch_handlers.ts:208, :309 — and `prepareLocalBranch` (called
     from the now-wrapped createRepo/connectExistingRepo) drops its
     internal lock. Reads (getGitState :992-1004, getConflicts, list\*)
     stay unlocked so reconcile probes never queue behind a long push.
     Cost accepted: a network push holds the app's lock for its duration —
     per-app only, the tradeoff Neon shipped.
   - Tests: concurrent push+switch interleaving asserts serialization; a
     wrapped handler calling prepareLocalBranch completes (deadlock guard).
   - Exit: no git mutation handler touches the working tree outside
     `withLock(appId)`.
3. **github_ops machine** (large; two PRs). New
   `src/github_ops/{state,transition,controller,commands}.ts` +
   `useGithubOps`, keyed by appId on a provider-owned host.
   - States: `idle | running(op, next?) | conflicted(files, origin) |
rebase-paused | switch-blocked(target, blockingOp, hasConflicts)`,
     with a `banner` context field (`{kind, code?, message} | null`)
     replacing syncSuccess/syncError/rebaseStatusMessage. `op` enumerates:
     `push(normal|force|lease) | pull | fetch | rebase | rebase-continue |
rebase-abort | merge-abort | merge(branch) | switch(branch) |
create-branch(name, from, thenSwitch) | delete-branch | rename-branch |
disconnect | connect-repo(create|existing, thenAutoPush)`.
   - Events: `OP_REQUESTED(op)`, `OP_SUCCEEDED(op)`, `OP_FAILED(op, {code?,
kind, message})`, `CONFLICTS(files)`, `GIT_STATE(mergeInProgress,
rebaseInProgress)` (the reconcile event — getGitState results become
     data, not control flow), `ABORT_AND_SWITCH_CONFIRMED`,
     `BLOCKED_DISMISSED`, `RESOLVE_WITH_AI_STARTED`, `BANNER_DISMISSED`,
     `RECONCILE_REQUESTED` (mount/app-focus; answered by `probe-git-state` - `probe-conflicts`). Commands: `run-op`, `probe-git-state`,
     `probe-conflicts`, `invalidate-branches`, `refresh-app`, `notify`,
     `start-conflict-resolution(files)` via the injected chatStream facade.
   - Decisions: (a) composites are transition-driven — `running(rebase,
next: push)` on OP_SUCCEEDED enters `running(push)`, deleting the
     mid-composite `isSyncing` clear (handleSyncToGithub's finally at
     GitHubConnector.tsx:294-296, reached mid-composite via the call at
     :365 inside handleRebaseAndSync :359-400); (b) OP_FAILED dispatches on
     `code` only (item 1); (c) **`OP_REQUESTED` while `running` →
     `ignore("op-in-flight")`**, surfaced as disabled buttons from the
     projection — `next` is reserved for transition-driven composites,
     never user-enqueued; (d) auto-sync-after-link is the `thenAutoPush`
     flag on connect-repo — deleting the `lastAutoSyncedAppIdRef`
     edge-detector (:117, :403-434) and the triggerAutoSync prop pair;
     (e) both components become projections of one snapshot; (f) branch
     inventory stays a TanStack query invalidated by `invalidate-branches`
     — the machine owns operation lifecycle, not data fetching; (g) the
     UnconnectedGitHubConnector device-flow + repo-setup form stays out
     (device flow is connection_flow's; the form is dialog-local state).
   - Fixes the two verified §4 bugs structurally: abort-and-switch
     transitions `conflicted → running(switch)` in one snapshot (no stale
     conflict store for Resolve-with-AI to read); `banner` clears on every
     history-invalidating OP_REQUESTED.
   - PR split, each standalone under the GitHub e2e characterization
     suites: **PR-A** machine + GitHubConnector projection (deletes
     githubSyncAtoms.ts + githubSyncAtoms.test.tsx + the auto-sync
     effect); **PR-B** GithubBranchManager projection (deletes its 8
     in-progress booleans :81-106, duplicate conflicts store :88, and
     abortConfirmation dialog state :100-105 → `switch-blocked`).
   - Disposal: `disposeKey` at BOTH app-deletion sites (apps.tsx:162-167
     and app-details.tsx:200-202).
   - Tests: transition totality via `exploreReachableStates`; recording
     runner; projection stability; e2e suites as characterization.
   - Exit: `grep -n 'includes("rebase\|divergent'` in src/components
     returns nothing; both components contain zero operation-lifecycle
     useState.
4. **Preview iframe identity/navigation/picker machine** (large). Scope
   discipline is the deliverable.
   - The machine (per-app, hosted at the app root) OWNS: `history`,
     `position`, `currentUrl`, `preservedUrl`, `iframeEpoch`,
     `selectorReady`, `picking`, `restoreQueued`. It EXCLUDES: the
     screenshot pipeline (item 5), visual-editing toolbar + AST state,
     annotator mode, cloud-sandbox banner, device-mode UI, console/network
     forwarding — all stay component-side.
   - Post-Phase-0 symptom re-validation (verified current): app switches
     now remount and reset everything (fixed by the key chore); the
     `reloadKey` remount STILL leaks — handleReload (:1455-1489) bumps
     reloadKey keying only the inner `<iframe>` (:2112), resetting neither
     `isPicking` (:287) nor `isComponentSelectorInitialized` (:881, no
     reset), so a same-app reload shows an active picker over a
     selector-less document (double-toggle to recover); the
     `isRestoringQueuedSelectionAtom` handshake still leaks (effect
     :720-746 early-returns at :722 without clearing); canGoBack/Forward:
     recompute effect :1279-1280 plus writers :1290-1291, :1369-1370,
     :1421-1422, :1527-1528; `currentIframeUrlRef` ~10 writers read inside
     the iframeSrc memo with pseudo-trigger deps (:286, :1582-1599); five
     copy-pasted preservedUrls blocks; `prevAppUrlRef` (:1284-1295)
     survives as a within-mount edge detector.
   - Decisions: (a) ONE epoch — `iframeEpoch` replaces `reloadKey`;
     `<iframe key={epoch} src={selectSrc(snapshot)}>`; the PreviewPanel
     `${appId}-${token}` key stays as component identity, and token bumps
     (producers: app_run/commands.ts:75,180,183; chat_stream/commands.ts:466)
     surface as `IFRAME_REPLACED{reason:"external"}` on mount;
     (b) **`IFRAME_REPLACED{reason:"external"}` truncates history to
     `[currentUrl]`** — recorded decision preserving today's semantics
     (history does NOT survive token remounts; only the current route is
     restored, as preservedUrls does now); (c) `RELOAD_REQUESTED` bumps the
     epoch and hard-resets `selectorReady` + `picking` — reload
     deliberately drops picking, matching remount semantics and killing the
     double-toggle bug; (d) canGoBack/Forward become selectors;
     (e) `restoreQueued` is machine state: dispatchable only when
     `selectorReady`, preserved across IFRAME_REPLACED, cleared only by
     SELECTION_RESTORED — the leak becomes unrepresentable;
     (f) `preservedUrl` is just `currentUrl` retained by the surviving
     controller — DELETE `previewCurrentUrlAtom` and all five mutation
     blocks, with the machine absorbing the per-app entry cleanup that
     `clearPreviewRuntimeForApp` does today (previewRuntimeAtoms.ts:367);
     (g) `APP_URL_CHANGED` (hook subscription) replaces `prevAppUrlRef`.
   - Events: `APP_URL_CHANGED(url), NAVIGATE(path), NAVIGATED_IN_APP(kind,
url), GO_BACK, GO_FORWARD, RELOAD_REQUESTED, IFRAME_REPLACED(reason),
IFRAME_LOADED, SELECTOR_READY, PICKER_TOGGLED,
SELECTION_RESTORE_QUEUED, SELECTION_RESTORED`. Commands:
     `post-to-iframe(msg)`, `clear-preview-error`. The window `message`
     listener becomes a thin adapter in the hook routing postMessage types
     to this machine and item 5's — no machine-to-machine import.
   - Disposal: `disposeKey` at both app-deletion sites (apps.tsx:162-167,
     app-details.tsx:200-202).
   - Deleted: `reloadKey`, `prevAppUrlRef`, `currentIframeUrlRef`, the
     iframeSrc memo, canGoBack/Forward state+effect, preservedUrls
     plumbing, `isRestoringQueuedSelectionAtom`.
   - Tests: transition totality (reachable-graph); reference stability;
     adapter tests with a fake contentWindow; PreviewPanel.test.tsx keeps
     the remount characterization.
   - Exit: PreviewIframe.tsx contains no navigation/picker useState/useRef;
     `grep -n reloadKey` returns nothing.
5. **Screenshot pipeline machine** (medium). Re-validated after the
   per-app-atom chore: still a real machine — the atom fixed clobbering,
   but the pipeline is still two mirrored refs (:307, :327-329), two
   hand-rolled requestId correlations (:310-315), a 3s setTimeout (:210,
   :396-451), a once-per-session fallback set (:322), and five clear sites.
   - Per-app machine: `idle → pending(source) → waitingSelectorReady →
settling → resolvingCommit → awaitingResponse(requestId) → saving →
idle`; events `CAPTURE_REQUESTED(source), SELECTOR_READY,
SETTLE_ELAPSED` (injected Clock), `COMMIT_RESOLVED(hash),
RESPONSE(requestId, ok, dataUrl?)` (stale → `ignore("stale-request")`),
     `APP_HIDDEN` (keeps `pending`, preserving today's resume-on-return),
     `SAVED`. Commands: `resolve-commit-hash`, `post-capture-request`,
     `save-screenshot` + invalidations, `check-existing-screenshots`.
   - **Producer-path decision (composition):** `pendingScreenshotAppIdsAtom`
     stays as the producer-facing request INBOX — chat_stream/commands.ts:467
     and useCommitChanges keep writing it (no machine imports another's
     controller); the screenshot hook adapter subscribes, dispatches
     `CAPTURE_REQUESTED`, and clears the consumed entry. The atom's role
     changes from tracked state to consumed mailbox, documented in the
     machine header.
   - The annotator capture (requestAnnotatorScreenshot :465-476, response
     :1088-1099) stays OUT — a synchronous UI round-trip owned by the
     annotator; the shared postMessage adapter routes by requestId
     ownership. Consumes IFRAME_LOADED/SELECTOR_READY from item 4's
     adapter, never from its controller.
   - Disposal: `disposeKey` at both app-deletion sites.
   - Deleted: all screenshot refs, `captureTimeoutRef`, the
     SCREENSHOT_CAPTURE_DELAY_MS timeout plumbing.
   - Tests: transition totality with FakeClock; adapter correlation (stale
     response ignored with reason).
   - Exit: zero screenshot-related refs in PreviewIframe.tsx.
6. **Neon linkage machine — re-scoped small, trigger-gated** (small).
   Honest re-validation: Phase 0's lock closed the §7 corruption trace, and
   main's compensation cascades are linear serialized try/catch —
   machine-ifying main buys nothing structural now. What remains is
   renderer consolidation: NeonConnector.tsx holds 8 booleans + a ref
   (:69-84, :110) for one lifecycle. Spec (when triggered): per-app
   renderer machine `unlinked → linking(create|connect) →
linked(activeBranch) → switching-branch | unlinking`; events
   LINK/SWITCH/UNLINK REQUESTED/SUCCEEDED/FAILED + RECONCILE(appRow);
   commands are the existing contract calls + invalidation. **Build
   trigger: the next scheduled Neon feature PR, or the first NeonConnector
   state bug.**
7. **Triggered tail** (small each).
   - _Chat-tab chore now:_ fix hydrate-as-merge —
     `hydrateChatTabSessionAtom` wholesale-replaces the tab sets
     (chatAtoms.ts:211-213), evicting chats opened before the initial query
     resolves; merge instead. (The notification-dot detector migration is
     Phase 1 PR 4's — handshake 2.) The full §10 machine waits for its
     trigger: first tab-session hydration bug after the merge fix, or when
     a persistence-convention reference implementation is wanted.
   - _FileEditor save/dirty (§9):_ 4-state machine keyed `appId:filePath`
     (`clean → dirty → saving → saving-dirty`); events CONTENT_LOADED,
     EDITED, SAVE_REQUESTED(blur|button), SAVE_SUCCEEDED(warning?),
     SAVE_FAILED; `enqueueFileSave` (fileSaveQueue.ts:7-27) stays the
     executor as a command runner; replaces the six refs + two mirrored
     useStates (FileEditor.tsx:143-154) and the re-dirty check (:291-296).
     **Trigger: next dirty/save bug, or the first second consumer of
     fileSaveQueue.**

Phase 5 exit criteria:

- [ ] IPC envelope carries `code` and restores `name`; git handlers throw
      coded errors; zero error-substring parsing in the two components.
- [ ] Every GitHub/git mutation handler whole-op locked per app; all four
      inner lock slices removed; reads unlocked; interleaving test green.
- [ ] github_ops landed (both PRs); githubSyncAtoms.ts + its test deleted;
      both components are projections; getGitState is a reconcile event.
- [ ] Iframe machine landed owning exactly the eight fields;
      reloadKey/prevAppUrlRef/currentIframeUrlRef/previewCurrentUrlAtom/
      isRestoringQueuedSelectionAtom deleted; disposal wired at both
      app-deletion sites for all three new machines.
- [ ] Screenshot machine landed with injected Clock; the pending atom is a
      consumed inbox; zero screenshot refs in PreviewIframe.tsx.
- [ ] boundaries inventory includes github_ops, preview_iframe, screenshot
      (and neon_link if triggered); all wired to the trace observer.
- [ ] Deferred-tier revisit notes re-confirmed: queue-persistence stays
      deferred (revisit on first hydration bug or once a
      persistence-reference machine exists); deep-link mailbox stays
      deferred (revisit on a fourth deep-link type or the next
      lost-deep-link report).

Sequencing within Phase 5: items 1 and 2 are independent, parallel, and
both gate item 3 (the machine dispatches on error codes and assumes
whole-op main-side exclusion). The GitHub track (1→2→3) goes first among
the big machines: its precursors are main-side and ready, it deletes the
most duplicated recovery logic, and it closes the remaining verified §4
bugs — the iframe machine's urgency dropped after Phase 0 killed the
cross-app leaks. Items 4 and 5 share one design doc and one postMessage
adapter (build 4, then 5 against 4's adapter); they can start in parallel
with the GitHub track once Phase 2's Clock/IdSource exists. Items 6 and 7
are trigger-gated and never block phase exit.

## Risks and mitigations

## Risks and mitigations

- **Framework pressure at machine #10.** The prior guardrail holds and
  hardens: the kernel is frozen; new shared code enters only via the named
  facilities here (trace observer, Clock/IdSource, co-simulation harness,
  projection helper), each justified by ≥3 consumers. No generic controller,
  no XState — the decision record in more-state-machines.md applies.
- **Churning a two-week-old machine (chat_stream).** Every Part 1 step is
  behavior-preserving under the existing unit + streaming-integration suites;
  the folding step adds characterization tests for plan-implementation and
  merge-conflict flows _before_ moving them. A step that has to change a
  transition test's expectations is out of scope by definition (same rule as
  machine-followup).
- **Candidate inflation.** Every candidate here survived adversarial
  verification, and the quick-fix-first discipline keeps machines honest: if
  the chore removes the pain, the machine waits. The deferred tier exists so
  surviving-but-marginal candidates don't leak into roadmaps as endorsed
  work.
- **Two audits, one file.** Candidates 6 and 8 share PreviewIframe.tsx;
  candidate 1 and Part 1 share the stream-finished signal; Part 1 item 7 and
  Part 3.1 share the streamId echo. The design docs must cross-reference;
  the "Cross-phase handshakes" subsection of the Phase plans records the
  adjudicated ownership for each shared item.

## Verification

Per phase, narrowest first, then the standard checks:

```sh
npm test -- src/chat_stream/ src/state_machines/
npm test -- src/plan_handoff/ src/app_run/ src/connection_flow/ src/version_preview/
npm test -- src/ipc/handlers/__tests__/queued_message.integration.test.tsx \
  src/ipc/handlers/__tests__/pause_queue.integration.test.tsx
npm run fmt && npm run lint && npm run ts
npm test
```

Machine PRs additionally follow rules/state-machines.md's test requirements
(totality, reference stability, fake runners, constructed-owner isolation);
Phase 4 adds the co-simulation suite as a required gate for any change to
chat_stream transitions or main's stream handlers.

## Definition of done

- chat_stream is convention-compliant: kernel types with ignore reasons,
  SnapshotStore, provider-owned host with `disposeKey` on chat deletion (plus
  documented quiescence GC), observer wired, zero external streams writing
  its projection, zero cross-machine module imports.
- The `stream-finished` signal exists and `prevStreamingRef` /
  `chatStreamCountByIdAtom` / the ChatPanel store.sub edge detector are gone.
- rules/state-machines.md has Composition, Projections, and
  Persistence/Hydration sections; the boundary test enforces kernel purity
  and machine-to-machine isolation.
- All seven Phase 0 chores shipped; each verified bug in this document is
  either fixed by a chore or covered by a landed machine's tests.
- Tier-1 machines (1, 2, 3) landed on their own design docs; the co-simulation
  harness reproduces current main↔renderer stream behavior and gates changes.
- Every machine (old and new) is observable through the shared trace
  observer.
- The deferred list and rejected list are recorded here with revisit
  triggers, and no deferred item ships without new evidence.
