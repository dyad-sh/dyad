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

## Three findings shape this plan

1. **`chat_stream` is the new drift.** It landed in parallel with the kernel
   and satisfies none of the conventions the other four machines now follow:
   zero kernel imports, a module-global controller Map
   (`src/chat_stream/registry.ts:18`) directly violating
   rules/state-machines.md:30-32, no `dispose()`, reasonless local `ignore()`,
   hand-rolled listener plumbing, no telemetry. Worse, two chat streams still
   run _outside_ the machine and write its projection by hand. Part 1 is
   mostly a chat_stream convention-and-consolidation program.
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
   is the one that unifies them.

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
   item in Part 1). `startImplementationStream`
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
5. **Cross-machine facade** (small). plan_handoff deep-imports
   `chat_stream/registry`. Replace with a `chatStream` facade injected via
   `PlanHandoffDeps` — the reference implementation of Part 3's composition
   rule.
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

**Staging.** (a) Migrate both consent maps onto `userInputResolver` (small —
buys timeout/abort/quit-sweep immediately; the before-quit cleanup at
`chat_stream_handlers.ts:554-566` today aborts controllers but never resolves
MCP waiters); (b) build the machine; (c) port questionnaire and continuation
onto it, deleting `prevStreamingRef` (which requires Part 1 item 4's
`stream-finished` signal — **sequence after the chat_stream folding**, and
re-scope: the continuation machine consumes that signal rather than
re-implementing stream-end detection).

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
  and surface it).
- **Deep-link one-slot mailbox** (verifier 78). Real (Date.now()-stamped
  one-slot state, three edge-detecting consumers, verified lost-event paths —
  the cold-start queue flush broadcasts back-to-back and the second link
  overwrites the first; TitleBar clears other links after its awaited
  refetch). But three rare link types make this routing cleanup, not a
  machine: replace the slot with consume-once dispatch (typed handler
  registry + mount-time replay), and **delete the now-vestigial
  supabase/neon `deep-link-received` broadcasts in main.ts** (connection_flow
  has its own channel; no renderer consumer matches those types).

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

Ship independently; several close verified bugs:

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

## Sequencing

Phases gate on dependencies, not the calendar; items within a phase are
independent PRs.

- **Phase 0 — chores + doc rules (now).** All seven concurrency chores; add
  the composition (3.2), projection (3.3), and persistence (3.5) sections to
  rules/state-machines.md; boundary-enforcement test (3.7); testing-kit
  decision (3.8).
- **Phase 1 — chat_stream program (Part 1A).** Kernel types → SnapshotStore/
  dispose → host+disposal → external-stream folding (+facade, module-state
  cleanup). The folding is the gate for everything that consumes
  `stream-finished`.
- **Phase 2 — first new machines.** Image generation (3) and voice-to-text
  (9) as the small proofs on the frozen kernel; home saga (2); MCP OAuth
  loopback (5). Shared trace observer (3.4) and Clock/IdSource (3.6) land
  with whichever machine needs them first.
- **Phase 3 — the round-trip machine (1).** After Phase 1; consent-resolver
  migration may ship in Phase 0/2. Questionnaire + continuation port onto it.
- **Phase 4 — protocol spec + co-simulation (3.1 stage 1).** Can start
  anytime; benefits from Phase 1 item 7 (streamId echo). Stage 2 main-side
  machine only after the model reproduces current behavior.
- **Phase 5 — big renderer machines.** GitHub repo ops (4); iframe
  identity/navigation/picker (6); Neon linkage machine (7) when Neon work
  recurs. FileEditor, tab session opportunistically.

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
  the sequencing above is the deconfliction.

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
