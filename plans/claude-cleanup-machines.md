# Projection Retirement: Machine-Written Jotai Atoms

## Status

Proposed follow-up to `plans/machine-followup.md` and the state-machine work
landed through #4077–#4086. All 13 machines (app_run, chat_stream,
github_ops, image_generation, preview_iframe, screenshot, version_preview,
first_prompt, voice_to_text, plan_handoff, connection_flow, mcp_oauth,
user_input) now run on SnapshotStore-based controllers that satisfy the
`useSyncExternalStore` contract — yet most of them still project state into
legacy Jotai atoms via `registerAtomWriter`/`projectToAtom`
(`src/state_machines/projection.ts`) or manual `store.set` calls. This plan
retires those projections.

Relationship to `plans/codex-cleanup-state-machines.md`: that plan covers
the same ground at domain level plus runtime consolidation
(TransactionalDispatcher migrations, boundary tests, provider conventions).
This plan is the atom-level execution companion for its projection-removal
half: a verified per-atom inventory with reader-by-reader migration
recipes. Where the two disagree on detail, this plan's file:line traces
supersede — notably: `chatMessagesByIdAtom` is a primary store with a
version_preview writer, not a simple chat_stream mirror; the
package-manager warning channel has four producers including the
entity-disposal path; and provider mount order constrains where the
screenshot and chat-stream facades can be injected. Runtime migrations
remain the other plan's scope; this plan is projection retirement only.

Inputs: a full classification of the 116 atoms in `src/atoms/*`,
`src/store/appAtoms.ts`, and the machine projection modules; per-atom
reader/writer traces; and an adversarial verification pass over the traces
(152 claims checked, 20 corrected). The corrections are folded in below.
The load-bearing ones:

- **Package-manager warning priority runs the opposite way from the trace's
  claim**: release-age (2) outranks pnpm-migration (1) — higher number wins
  (`src/atoms/previewRuntimeAtoms.ts:288-296`, test named "keeps release-age
  warnings ahead of pnpm migration warnings" at
  `previewRuntimeAtoms.test.ts:310`). Porting the rule as originally traced
  would silently invert product behavior.
- **Four missed preview-error writers** in `PreviewIframe.tsx` (runtime errors
  with source `dyad-app`, sync errors, sync-recovery clear, and dismiss-any). `dyad-app` errors
  are therefore _not_ exclusively the app_run machine's, and
  `useAppRunState` alone cannot replace the reader.
- **Mount-order reality for facade injection**: `ChatStreamProvider` mounts
  above the router (`renderer.tsx:141`); chat*stream's runtime deps are
  registered late by `useChatStreamRuntime()` at `layout.tsx:133`, which
  runs \_under* `AppRunProvider` (`layout.tsx:75`) but _above_
  `ScreenshotProvider` (`layout.tsx:202`). The AppRunManager facade injects
  cleanly; the screenshot facade needs wiring restructured or buffering.
- **`subscribeStreamFinished` is already microtask-deferred**
  (`chat_stream/manager.ts:235-249`) but is _not_ a drop-in for
  watch-stream-idle: it does not fire on `disposeKey`, so a `watchIdle`
  facade must also observe controller disposal.
- **`syncChatFromDb` itself** guards its post-fetch write on
  `isStreamingByIdAtom` at `src/lib/resyncChat.ts:59` — a third guard site
  beyond ChatPanel's two.
- `currentPreviewRunStateAtom` and `currentPreviewLoadingAtom` have **zero
  production readers** (test-only); the run-state derived trio is cheaper
  than traced.
- `planStateAtom`'s machine read at `plan_handoff/commands.ts:114` is
  **not** a cross-machine edge — the field it reads is written only by
  non-machine hooks.

Decision recorded here: **retire category-2 (machine-mirror) and category-3
(cross-machine) atoms; keep category-1 (UI-only) atoms as Jotai.**
Cross-machine communication moves to explicit facades or owned stores, with
microtask-deferred delivery wherever a call would otherwise run inside
another machine's dispatch. Every migration is behavior-preserving; known
intentional deltas are enumerated per PR and flagged in PR descriptions.

## The three atom populations

Counts: 69 UI-only (keep), 32 machine-mirror, 12 cross-machine, 3
mixed-ownership resolved by this plan. "Prod readers" counts production
read/consume sites; test sites are enumerated in the recipes.

### Population 1 — UI-only (69 atoms, keep)

No machine owns this state; Jotai is the right tool. Grouped by family:

| Atoms                                                                                                                                                                                                                                                                                                                                                                                          | Module                 | Writer                                                                  | Readers                                                          | Difficulty                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| selectedAppIdAtom                                                                                                                                                                                                                                                                                                                                                                              | appAtoms               | UI hooks/pages                                                          | machines read it as input (version_preview sub, chat_stream get) | keep                                                                                        |
| previewModeAtom, selectedChatIdAtom                                                                                                                                                                                                                                                                                                                                                            | appAtoms/chatAtoms     | UI navigation; plan_handoff writes each once as a navigate side effect  | UI                                                               | keep (documented machine write)                                                             |
| appBlueprintStateAtom                                                                                                                                                                                                                                                                                                                                                                          | appBlueprintAtoms      | IPC event hook                                                          | UI                                                               | keep                                                                                        |
| chatInputValuesById, chatInputValue, hasManuallySelectedChatMode, scrollToBottomRequestedChatIds, needsFreshPlanChat                                                                                                                                                                                                                                                                           | chatAtoms              | UI                                                                      | UI                                                               | keep                                                                                        |
| homeChatInputValue, homeSelectedApp, attachments                                                                                                                                                                                                                                                                                                                                               | chatAtoms              | UI; first_prompt clears after submit                                    | UI                                                               | keep (documented machine write)                                                             |
| Tab family (16): recentViewedChatIds, closedChatIds, sessionOpenedChatIds, chatTabSessionStorage, groupTabsByApp, closedTabHistory, hydrateChatTabSession, persistChatTabSession, popClosedTab, setRecentViewedChatIds, ensureRecentViewedChatId, pushRecentViewedChatId, removeRecentViewedChatId, pruneClosedChatIds, addSessionOpenedChatId, closeMultipleTabs, removeChatIdFromAllTracking | chatAtoms              | UI                                                                      | UI                                                               | keep                                                                                        |
| agentTodosByChatIdAtom                                                                                                                                                                                                                                                                                                                                                                         | chatAtoms              | renderer IPC listeners                                                  | UI                                                               | keep                                                                                        |
| helpDialogAtom, dropdownOpenAtom                                                                                                                                                                                                                                                                                                                                                               | helpDialogAtom/uiAtoms | UI                                                                      | UI                                                               | keep                                                                                        |
| dismissedImageGenerationJobIdsAtom                                                                                                                                                                                                                                                                                                                                                             | imageGenerationAtoms   | UI                                                                      | UI                                                               | keep (composes with new machine hooks)                                                      |
| integrationProviderSelection, pendingIntegration                                                                                                                                                                                                                                                                                                                                               | integrationAtoms       | UI                                                                      | UI                                                               | keep (former composes into new usePendingIntegrations hook)                                 |
| planAcceptInNewChatByChatId, pendingQuestionnaire, planAnnotations                                                                                                                                                                                                                                                                                                                             | planAtoms              | UI                                                                      | plan_handoff reads planAcceptInNewChat at handoff time           | keep                                                                                        |
| Visual-editing family: selectedComponentsPreview, visualEditingSelectedComponent, currentComponentCoordinates, previewIframeRef, annotatorMode, screenshotDataUrl, pendingVisualChanges                                                                                                                                                                                                        | previewAtoms           | UI                                                                      | preview_iframe reads selectedComponentsPreview as input          | keep                                                                                        |
| dismissPackageManagerWarnings, dismissedPackageManagerWarningAppIds                                                                                                                                                                                                                                                                                                                            | previewRuntimeAtoms    | UI                                                                      | —                                                                | **exception: retires with the warning channel** (the dismissed-guard lives in the set path) |
| lastLogTimestampAtom                                                                                                                                                                                                                                                                                                                                                                           | supabaseAtoms          | hook                                                                    | hook                                                             | keep                                                                                        |
| terminalOpenByChatId, terminalFontSize                                                                                                                                                                                                                                                                                                                                                         | terminalAtoms          | UI                                                                      | UI                                                               | keep                                                                                        |
| Test-runtime family (13): dismissedLegacyTestMigrationAppIds, testRunOutputByAppId, currentTestRunOutput, appendTestRunOutput, clearTestRunOutputForApp, testSpecsByAppId, testRunStateByAppId, currentTestSpecs, currentTestRunState, setTestSpecsForApp, setTestRunStateForApp, applyTestRunStarted, applyTestRunFinished, clearTestRuntimeForApp                                            | testRuntimeAtoms       | useTestRunEvents/TestsPanel                                             | UI                                                               | keep (no machine owns tests)                                                                |
| isPreviewOpenAtom                                                                                                                                                                                                                                                                                                                                                                              | viewAtoms              | UI; chat_stream (:528) and first_prompt (:157) write as UI side effects | UI                                                               | keep (documented machine writes)                                                            |
| isChatPanelHidden, selectedFile, stagedDiffFile, activeSettingsSection                                                                                                                                                                                                                                                                                                                         | viewAtoms              | UI                                                                      | UI                                                               | keep                                                                                        |

### Population 2 — machine-mirror (32 atoms, retire)

| Atom                                 | Writer                                                                                          | Prod readers              | Difficulty                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------- |
| chatCompletionEventAtom              | chat_stream commands.ts:520                                                                     | 1                         | S                                       |
| publishChatCompletionEventAtom       | chat_stream commands.ts:520 (sole caller)                                                       | 0                         | S                                       |
| chatErrorByIdAtom                    | chat_stream (commands :226/:636, manager :150) + rogue `useStreamChat.setError`                 | 2                         | M                                       |
| pendingToolConsentsAtom              | derived over userInputRequestsAtom                                                              | 1                         | S                                       |
| streamingPreviewByChatIdAtom         | chat_stream commands.ts:215/:328                                                                | 2                         | M                                       |
| imageGenerationJobsAtom              | image_generation provider projectToAtom                                                         | 6                         | M                                       |
| setImageGenerationJobsProjectionAtom | provider (sole)                                                                                 | 0                         | S                                       |
| pendingImageGenerationsCountAtom     | derived                                                                                         | 3                         | S                                       |
| chatImageGenerationJobsAtom          | derived                                                                                         | 2                         | S                                       |
| previewAppExitByAppIdAtom            | app_run commands :90/:155 clear; useRunApp :208 set (admission-gated)                           | 2                         | M                                       |
| setPreviewAppExitForAppAtom          | same                                                                                            | 0                         | S                                       |
| appUrlByAppIdAtom                    | app_run commands :65/:95/:159                                                                   | 4                         | M                                       |
| setAppUrlForAppAtom                  | app_run (sole)                                                                                  | 0                         | S                                       |
| consoleEntriesByAppIdAtom            | **reclassified: multi-producer log buffer** — app_run + useRunApp + useSupabase + PreviewIframe | 4                         | L                                       |
| setConsoleEntriesForAppAtom          | app_run + Console clear                                                                         | 0                         | S                                       |
| appendConsoleEntriesForAppAtom       | app_run + 3 legacy producers                                                                    | 0                         | L                                       |
| currentPreviewRunStateAtom           | derived                                                                                         | 2 (sibling deriveds only) | S                                       |
| currentPreviewLoadingAtom            | derived                                                                                         | 0 (test-only)             | S                                       |
| currentPreviewRunStartedAtAtom       | derived                                                                                         | 1                         | S                                       |
| currentPreviewErrorAtom              | derived                                                                                         | 1                         | L                                       |
| currentPreviewAppExitAtom            | derived                                                                                         | 1                         | M                                       |
| currentAppUrlAtom                    | derived                                                                                         | 3                         | M                                       |
| currentPreviewReloadTokenAtom        | derived                                                                                         | 1                         | M                                       |
| currentConsoleEntriesAtom            | derived                                                                                         | 3                         | L                                       |
| currentPackageManagerWarningAtom     | derived                                                                                         | 1                         | L                                       |
| clearPreviewRuntimeForAppAtom        | disposal action over 7 maps (renderer.tsx:153, harness:558)                                     | 2 callers                 | M (shrinks incrementally, deleted last) |
| firstPromptSagaProjectionWriteAtom   | FirstPromptProvider :226/:285                                                                   | 1 (alias)                 | S                                       |
| firstPromptSagaAtom                  | read-only alias                                                                                 | 4                         | S                                       |
| userInputRequestsAtom                | user_input projection adapter (sole, enforced)                                                  | 5                         | M                                       |
| respondingRequestIdsAtom             | same adapter                                                                                    | 3                         | S                                       |
| activeCheckoutCounterAtom            | version_preview commands :34/:38                                                                | 1                         | S                                       |
| isAnyCheckoutVersionInProgressAtom   | derived                                                                                         | 1                         | S                                       |

### Population 3 — cross-machine (12 atoms + 3 mixed, retire; worst first-class problem)

| Atom                                 | Writers                                                                                                                             | Prod readers | Difficulty |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------- |
| pendingScreenshotAppIdsAtom          | chat_stream commands.ts:532; useCommitChanges.ts:24 → consumed as mailbox by screenshot machine                                     | 2            | M          |
| previewRunStateByAppIdAtom           | app_run manager.ts:146-149 → observed by preview_iframe provider                                                                    | 2            | M          |
| setPreviewRunStateForAppAtom         | app_run (sole)                                                                                                                      | 0            | S          |
| previewErrorByAppIdAtom              | app_run sets, preview_iframe clears, useRunApp + PreviewIframe (6 sites incl. the 4 missed ones)                                    | 2            | L          |
| setPreviewErrorForAppAtom            | same channel                                                                                                                        | 0            | L          |
| previewReloadTokenByAppIdAtom        | app_run ×3; chat_stream commands.ts:531                                                                                             | 2            | L          |
| bumpPreviewReloadTokenForAppAtom     | same                                                                                                                                | 0            | M          |
| packageManagerWarningByAppIdAtom     | chat_stream sets, app_run clears, useRunApp sets, disposal path deletes                                                             | 2            | M          |
| setPackageManagerWarningForAppAtom   | chat_stream + useRunApp                                                                                                             | 0            | M          |
| clearPackageManagerWarningForAppAtom | app_run + banner                                                                                                                    | 0            | M          |
| chatMessagesByIdAtom                 | **reclassified from machine-mirror: primary renderer message store** — chat_stream ×4, version_preview :74, two component hydrators | 7            | L          |
| isStreamingByIdAtom                  | chat_stream syncProjection → plan_handoff subscribes (the ORDERING INVARIANT case)                                                  | 10           | L          |
| queuedMessagesByIdAtom               | mixed: chat_stream + useStreamChat + useQueuePersistence (primary storage, not a mirror)                                            | 2            | L          |
| queuePausedByIdAtom                  | mixed, same trio; chat_stream also reads it in a command                                                                            | 2            | L          |
| planStateAtom                        | mixed: plan_handoff writes acceptedChatIds; usePlanEvents/usePlan write plansByChatId (two states fused in one atom)                | 3            | L          |

## What stays and why

- **All 69 UI-only atoms stay as Jotai.** Selection, navigation, tabs,
  drafts, dismissals, visual editing, test runtime, layout. Moving them
  into machines would invert the ownership problem this plan fixes.
- **Documented deliberate keeps — machine writes into UI-owned atoms.**
  These are one-way fire-and-forget side effects into state the UI owns,
  not projections, and no machine reads them back:
  - plan_handoff → `previewModeAtom` (:106) and `selectedChatIdAtom` (:165)
    as navigation side effects;
  - first_prompt → clears `homeChatInputValueAtom`,
    `homeSelectedAppAtom`, `attachmentsAtom` after successful submit;
  - chat_stream (:528) and first_prompt (:157) → `isPreviewOpenAtom`.
    Each keep gets a one-line comment at the write site naming this plan.
- **Machine reads of UI atoms stay** (selectedAppIdAtom,
  planAcceptInNewChatByChatIdAtom, selectedComponentsPreviewAtom): the
  writer is the UI, so these are inputs, not projections. Out of scope.
- **One exception in the UI-only bucket**: the package-manager dismiss pair
  (`dismissPackageManagerWarningsAtom`,
  `dismissedPackageManagerWarningAppIdsAtom`) retires _with_ the warning
  channel — the dismissed-set guard is embedded in the channel's set path
  and moves into the new store's `dismiss()`.
- **The main-process user_input registry is untouched.** Only the renderer
  projection adapter changes shape.

## Retirement order

Rule: cross-machine edges first (they are live coupling hazards), then
machine-mirror atoms by ascending production reader count. Satellites
(`set*`/`bump*`/`clear*` action atoms and `current*` selectors) ride with
their base atom; families that share invariants retire as one unit.

Cross-machine, ascending readers (ties broken by dependency order the
traces establish):

1. **pendingScreenshotAppIdsAtom** (2) — purest mailbox, no deferral
   needed, best first target; establishes the producer-facade pattern.
2. **previewRunStateByAppIdAtom** (2) — establishes the
   app*run→preview_iframe \_deferred* facade pattern.
3. **previewReloadTokenByAppIdAtom** (2) — chat_stream writer migrates to
   the app_run `MANUAL_RELOAD` facade first (independently shippable).
4. **packageManagerWarningByAppIdAtom** (2) — owned store; priority rule
   must port un-inverted (release-age wins).
5. **previewErrorByAppIdAtom** (2) — hardest channel; deliberately last in
   the preview family so it reuses the facade and state-shape patterns
   from 2 and from the app-exit template.
6. **chatMessagesByIdAtom** (7) — new messages store +
   `replaceChatMessages` facade for version_preview.
7. **isStreamingByIdAtom** (10) — largest blast radius, last.
   **Retiring it deletes the synchronous re-entrancy hazard itself: the
   plan_handoff Jotai subscription firing inside chat_stream's
   `setState`/`syncProjection` is the only known re-entry vector, and both
   protective comments added in #4077 — the ORDERING INVARIANT block at
   `src/chat_stream/controller.ts:181-192` and its companion warning at
   the plan_handoff watch-stream-idle subscription — get deleted with it.**

Mixed-ownership design decisions ride the same wave: queue pair with the
chat_stream core work, planStateAtom split alongside plan_handoff's facade
migration.

Machine-mirror, ascending readers (family granularity):

8. publish/chatCompletionEventAtom (0/1) · activeCheckoutCounter pair (1) ·
   pendingToolConsentsAtom (1) · run-state derived trio (0–2, test-only
   plus one component)
9. previewAppExit family (2) — the template for the error channel ·
   streamingPreviewByChatIdAtom (2) — establishes the sidecar-store pattern
10. chatErrorByIdAtom (2) — ordered _with_ isStreamingByIdAtom despite low
    count: same files (useStreamChat, ChatPanel, manager cleanup, harness)
11. respondingRequestIdsAtom (3) + userInputRequestsAtom (5) — one unit,
    same adapter, same snapshot
12. image_generation family (2/3/6) — one unit
13. appUrl family (3/4) · firstPromptSaga pair (4)
14. console trio (4) — multi-producer, atomically
15. **clearPreviewRuntimeForAppAtom strictly last** — it is the leak guard
    for every previewRuntime map; shrink it map-by-map as each retires,
    delete when empty.

## Per-atom migration recipes

Corrections from verification are already applied. "New" marks code that
does not exist today.

### chat_stream: completion event (S)

- **Writers**: `commands.ts:520` (runEndSideEffects, `!wasCancelled`).
- `useNotificationHandler.ts:326` → `useStreamFinished`
  (`ChatStreamProvider.tsx:29`), filter `event.outcome === "completed"`
  (exactly matches the `!wasCancelled` guard). New: thread `chatSummary`
  through the finalizing StreamState (`state.ts:113`) into
  `StreamFinishedEvent` (`manager.ts:38`) so `notifyStreamFinished`
  (`manager.ts:206`) can emit it. Delivery is already microtask-deferred
  (`manager.ts:238`) — the sequence-counter bookkeeping in `chatAtoms.ts:23`
  disappears entirely.
- `publishChatCompletionEventAtom` has zero readers; delete both atoms +
  the `ChatCompletionEvent` type in the same PR.
- Behavioral delta (flag): event fires after finalize-complete plus a
  microtask instead of during runEndSideEffects — a few ms, irrelevant for
  OS notifications.

### chat_stream: isStreamingByIdAtom (L)

- **Writer**: syncProjection (`commands.ts:715-727`) via AtomProjectionWriter
  (`manager.ts:170-176`), invoked in lockstep from the controller
  `setState` callback (`controller.ts:195-206`); cleanup write in
  `disposeKey` (`manager.ts:153-155`).
- Readers → replacements:
  - `plan_handoff/commands.ts:188` → injected facade
    `deps.chatStream.isIdle(chatId)` backed by
    `!isStreamActive(manager.peek(chatId)?.getSnapshot() ?? {type:"idle"})`.
  - `plan_handoff/commands.ts:193` (store.sub) → new facade
    `watchIdle(chatId, cb)`. Build on `subscribeStreamFinished` — it
    already defers via queueMicrotask (`manager.ts:235-249`), so no new
    deferral code on that path — **but it only fires on finalizing→idle and
    →errored; the facade must additionally observe `disposeKey`**, or a
    watcher armed on a chat disposed mid-stream never fires (the atom
    watcher fires today because disposeKey writes the projection). If built
    on raw `controller.subscribe` instead, deferral must be added, since
    SnapshotStore notifies synchronously.
  - `ChatPanel.tsx:96` → `isStreamActive(useChatStreamState(chatId) ??
{type:"idle"})` (hook returns `StreamState | undefined` — every
    hook-based replacement below needs the same fallback).
  - `ChatPanel.tsx:271/:274` → call-time
    `isStreamActive(manager.peek(chatId)?.getSnapshot() ?? {type:"idle"})`
    via `useChatStreamManager()`.
  - `PromoMessage.tsx:155`, `DyadOutput.tsx:28`,
    `DyadMarkdownParser.tsx:132` → same hook + fallback.
  - `ChatTabs.tsx:245` (aggregate; per-tab lookups :607/:835) → new
    manager-level `useStreamingChatIds` selector, or per-tab child
    components with `useChatStreamState(chat.id)`.
  - `useStreamChat.ts:45` → derive `isStreaming` from
    `useChatStreamState`; this hook fans out to ~15 components — migrate it
    first and most component readers come free.
  - `resyncChat.ts:59` → inject `getIsStreaming(chatId)` from the
    chat_stream command deps (its only callers are `commands.ts:467/:653`).
  - Tests: `manager.test.ts:175/183/210/215`,
    `queue_dispatch.test.ts:89`, `plan_handoff/commands.test.ts:34`
    (fake chatStream facade), `DyadMarkdownParser.test.tsx:164`,
    `explore_chat_history_streaming.integration.test.tsx:78/140`,
    `hybrid_chat_harness.tsx:1053/1063` — drive the machine, not the atom.
- Order: useStreamChat + components → plan_handoff facade (with disposal
  observation) → resyncChat injection → tests/harness → delete atom,
  syncProjection, writer plumbing, **and both #4077 protective comments**.

### chat_stream: chatErrorByIdAtom (M)

- **Writers**: machine (`commands.ts:636` set, `:226` clear on start,
  `manager.ts:150` dispose) + rogue `useStreamChat.setError`
  (`useStreamChat.ts:302-307`, called from ChatInput consent failure paths
  `:709/:713/:742`).
- `ChatPanel.tsx:65` and `useStreamChat.ts:46` → machine `errored` state
  via `useChatStreamState`, **plus** a new `external-error`/`clear-error`
  machine event so the ChatInput consent errors flow through the machine
  (single owner) — or split consent errors into a legitimate UI-only atom.
- Durability caveat: an errored controller self-releases when its last
  subscriber unmounts (`manager.ts:252-262`); a lastError selector must pin
  errored controllers or store last-error at manager level.
- Bundle with isStreamingByIdAtom (same files). Tests:
  `manager.test.ts:174/182`, `queue_dispatch.test.ts:255`, harness
  `:1052/:1062`.

### chat_stream: chatMessagesByIdAtom (L — reclassified primary store)

- **Not a mirror**: StreamState carries zero message content; the atom IS
  the canonical renderer message store. Retirement requires first
  **building** a chat_stream-owned per-chat messages SnapshotStore + hooks
  (`useChatMessages`, `useChatMessageCount`, `useLastChatMessage`).
- Writers to funnel through the store: streaming
  (`commands.ts:127/:335/:499/:577`), version_preview
  (`version_preview/commands.ts:74`) via new facade
  `chatStreamManager.replaceChatMessages(chatId, messages)`, and the two
  component `fetchChatMessages` hydrators (`ChatPanel.tsx:275`,
  `ChatInput.tsx:379`, invoked at `:723/:747`) via a machine hydrate
  command.
- The version_preview write already sits behind the `ipc.chat.getChat`
  promise (`commands.ts:73`) — never synchronous inside a transition, so no
  deferral; the real hazard is write-write conflict with an active stream
  (nothing guards it today) — the facade must refuse/skip while a stream is
  active for that chat.
- Helper port: `applyStreamingPatch`, `mergeResyncMessages`,
  `syncChatFromDb`, `triggerResync` are written against the
  `Map<number, Message[]>` updater signature; **`syncChatFromDb` also
  carries its own isStreaming guard at `resyncChat.ts:59` which must become
  a machine-state check during the port** (in addition to ChatPanel's
  `:271/:274` guards).
- Readers: `ChatPanel.tsx:64` (+`:147/:196/:253`), `ChatInput.tsx:176`
  (+`:276/:288/:336` → fine-grained selectors), `PromoMessage.tsx:154`
  (count only), `ChatModeSelector.tsx:45` (count only). Tests:
  `chat_stream/__tests__/commands.test.ts:142/:160`,
  `version_preview/commands.test.ts:150/:197`.
- Land the store behind the same write pattern first, flip readers second,
  delete the atom last. Highest regression risk in the plan (streaming
  render is the most E2E-covered surface).

### chat_stream: queue pair (L — design decision, one PR)

- `queuedMessagesByIdAtom` + `queuePausedByIdAtom` are primary storage with
  three-way ownership (machine commands `commands.ts:425/:669/:512`,
  useStreamChat mutators, useQueuePersistence hydration). Move both into
  one chat_stream-owned QueueStore with a mutation facade — **same store**,
  because `dispatchNextQueued` reads paused synchronously before the atomic
  pop (`commands.ts:665/:669`); splitting would reintroduce read-skew.
- Preserve: non-serializable per-item callbacks (memory-only), item object
  identity (useQueuePersistence's WeakMap encode cache keys on it), atomic
  dequeue, write-before-poke ordering (`useStreamChat.ts:143/:348`),
  restore-as-paused hydration (`useQueuePersistence.ts:169-176`).
- Readers/mutators: `useStreamChat.ts:48/:51` + mutators →
  `useChatQueue(chatId)`/facade calls; `useQueuePersistence.ts:56/:140/
:167/:172/:176/:193` → store subscribe + `hydrateMerge` (atomically marks
  restored chats paused). Tests: `queue_dispatch.test.ts`,
  `manager.test.ts:172-181`, `useStreamChat.test.tsx`, harness
  `:1050/:1060`.

### chat_stream: streamingPreviewByChatIdAtom (M — sidecar pattern)

- **Writer**: `commands.ts:328` (applyPreviewChunk) and `:215` (clear on
  transport cleanup). The `streamingPreviewSync.ts:17-18` comment claiming
  plan_handoff also writes is stale — fix it.
- New per-chat preview sidecar SnapshotStore (NOT a StreamState field —
  that would re-notify all stream-state subscribers per chunk).
- `DyadMarkdownParser.tsx:248` → `useChatStreamPreview(chatId)`;
  `ChatMessage.tsx:131` → equality-gated `useChatStreamHasPreview(chatId)`
  replicating the selectAtom boolean-transition optimization (and the
  identity-stable no-op in applyPreviewChunk must carry over). Helpers are
  setter-injected — swap the setter, done. Test:
  `explore_chat_history_streaming.integration.test.tsx:82/:163/:186`.

### user_input: pendingToolConsentsAtom (S) then requests/responding pair (M)

- `pendingToolConsentsAtom`: sole reader `ChatInput.tsx:199` → new
  user_input-owned `usePendingToolConsents(chatId)` hook (move the
  descriptor mapping out of `chatAtoms.ts:565`, fold in the
  respondingRequestIds filter from `:200-204`). Retires first and
  independently; also fixes the inverted layering (atoms module importing a
  machine projection — same wart in `planAtoms.ts:46` and
  `integrationAtoms.ts:20`).
- `userInputRequestsAtom` + `respondingRequestIdsAtom`: the renderer atom
  IS the state (no SnapshotStore exists for user_input). Step 1: convert
  the projection adapter's state to a SnapshotStore holding **both** the
  requests map and the responding set in one snapshot (splitting them would
  reintroduce torn reads the single Jotai commit avoids today).
- Readers: `MessagesList.tsx:87` → `useUserInputRequests()` (or narrower
  `selectQuestionnaireSettledAt`); `useNotificationHandler.ts:83` → full
  snapshot hook; `planAtoms.ts:45-46` pendingQuestionnaireAtom →
  `selectPendingQuestionnaires(requests, respondingIds)`;
  `integrationAtoms.ts:20` → `usePendingIntegrations()` hook (composes the
  kept UI atom `integrationProviderSelectionAtom`); `ChatInput.tsx:200` and
  `useIntegrationContinue.ts:26` → responding selectors.
- Preserve: revision-race handling vs hydrate, tombstone cap, questionnaire
  cleanup timer, NotFound optimistic rollback. No cross-machine readers, no
  deferral concerns. Main cost: `projection.test.ts` (~830 lines, ~19
  assertion sites) ports behavior-preserving.

### first_prompt: saga pair (S)

- **Writer**: `FirstPromptProvider.tsx:285` subscribe effect (+ dispose
  reset at `:226`).
- New `useFirstPromptSaga()` = memoized
  `projectFirstPromptState(useControllerSnapshot(useFirstPromptController()))`
  — all building blocks exist; memoize on snapshot identity (projection
  allocates per call). Keep the pure `projectFirstPromptState` and its
  test.
- Readers: `TitleBar.tsx:35`, `SetupBanner.tsx:42`,
  `ProviderSettingsPage.tsx:132`, `home.tsx:45` — all under the provider.
  Tests: `home.test.tsx:33` (mock the hook instead of the debugLabel atom
  shim), `boundaries.test.ts:184` guard deleted. Dispose-reset semantics
  come free from useControllerSnapshot.

### version_preview: checkout counter pair (S)

- **Writer**: `version_preview/commands.ts:34/:38` around
  `ipc.version.checkoutVersion`.
- `ChatHeader.tsx:64` → it already computes
  `isMutatingState(versionPreviewState)` at `:79`; pass that to the
  LoadingBar. Scope choice: per-selected-app (sensible for ChatHeader) vs
  any-app parity (would need a small `useAnyVersionPreviewMutating` manager
  selector) — default per-app, decide in review.
- Delete the whole `src/store/appAtoms.ts` module; drop the assertion at
  `version_preview/commands.test.ts:107`.
- Behavioral delta (flag): loading bar spans post-effects and restores too
  — arguably more correct.

### plan_handoff: planStateAtom (L — split, not retire-as-unit)

- Two states with different owners fused: plan_handoff writes
  `acceptedChatIds` (`commands.ts:80` via `:50`); `plansByChatId` is
  written by `usePlanEvents.ts:43` (IPC) and `usePlan.ts:39` (disk load).
- The machine read at `commands.ts:114` is **not cross-machine**
  (correction): plansByChatId has no machine writer. Still remove it —
  inject `getPlanData(chatId)` into PlanHandoffDeps (`commands.ts:29`,
  mirroring the chatStream facade); lazy pull, no deferral.
- `PlanPanel.tsx:33` → split: acceptedChatIds (`:48`) → new retained
  accepted-chats set on the plan_handoff projection +
  `useIsPlanAccepted(chatId)` (must survive return-to-idle; HandoffState
  has no terminal accepted state today); plansByChatId (`:44`) → renamed
  `planDocumentsAtom` (category-1 keep) or React Query.
- `usePlan.ts:18` → the split-out documents atom / query-cache presence.
- Order: inject getPlanData → accepted-chats projection → migrate PlanPanel
  → rename remainder, delete planStateAtom and the mark-plan-accepted
  command (`state.ts:107`). The usePlan/usePlanEvents dual-source race
  persists wherever plansByChatId lands — out of scope here, note in code.

### screenshot: pendingScreenshotAppIdsAtom (M — first cross-machine target)

- **Producers**: chat_stream `commands.ts:532` (async end-of-stream
  command); `useCommitChanges.ts:24`.
- Delete the mailbox consume loop
  (`ScreenshotProvider.tsx:35-51`); producers call a
  `requestCapture(appId, source)` facade →
  `ScreenshotManager.send(appId, {type:"CAPTURE_REQUESTED", source})`
  (exists, `manager.ts:31`).
- **Wiring correction**: chat*stream's deps are registered by
  `useChatStreamRuntime()` at `layout.tsx:133`, which runs \_above*
  `ScreenshotProvider` (`layout.tsx:202`) — `useScreenshotManager()` is not
  in scope there. Options: hoist ScreenshotManager creation into layout
  (createMachineProvider accepts an injected manager), register the facade
  from a child below the provider, or buffer inside the facade. Late
  binding is fine — deps are read lazily via `registerRuntimeDeps`
  (`manager.ts:116`) and the facade fires only from the async end-of-stream
  command. The commit producer needs nothing (its consumers render below
  the provider).
- No deferral: the write runs in the command drain loop after
  setState/syncProjection complete, and screenshot never calls back into
  chat_stream. Migrate both producers + delete the atom in one change (no
  double-delivery window). Coalescing loss is benign (supersede/queue
  policy lives in `screenshot/state.ts:10-17`); delete the mailbox doc
  sentence in `state.ts:4-8` and the inbox comment at
  `previewAtoms.ts:26-27`. Test: `ScreenshotProvider.test.tsx` rewritten to
  drive `manager.send`.

### app_run: previewRunStateByAppIdAtom + derived trio (M)

- **Writer**: `AppRunManager.onStateChange → writeProjection`
  (`manager.ts:47-54, 146-149`), shaped by `projectRunState`
  (`transition.ts:402`); disposal delete via clearPreviewRuntimeForAppAtom.
- `PreviewIframeProvider.tsx:23` (cross-machine) → new AppRunManager facade
  (`onRunStateChanged` or edge-triggered `onRestartStarted`). **Delivery
  MUST be microtask-deferred**: onStateChange fires inside AppRunController
  setState; app_run buffers re-entry into itself
  (`controller.ts:250-277`) but preview_iframe has no such buffer, and the
  callback would run mid-notify on app_run's stack. The current React
  effect path is already async, so deferral preserves semantics. Keep the
  `handledRestartStartedAt` dedupe or make the facade edge-triggered.
- Derived trio (correction: cheaper than traced —
  currentPreviewRunStateAtom and currentPreviewLoadingAtom have **zero
  production readers**): `PreviewLoadingScreen.tsx:162` →
  `projectRunState(useAppRunState(selectedAppId))?.startedAt ?? null`
  (selectedAppId already in scope at `:163`); delete all three deriveds.
- Tests: `app_run/manager.test.ts:58-88` (dispose-blocks-late-writes
  becomes a facade-listener test), `usePreviewIframe.test.tsx:58-63` (also
  a direct writer — drive via facade), `useRunApp.test.tsx:337/342/362/
649/711/738` (assert machine snapshots; useRunApp's own `loading` is
  already machine-derived at `useRunApp.ts:315`),
  `previewRuntimeAtoms.test.ts`. Also update stale comments at
  `transition.ts:398` and `testRuntimeAtoms.ts:118`.
- Disposal: AppRunProvider already registers
  `useRegisterEntityDisposer("app", manager.disposeKey)` — drop this map
  from clearPreviewRuntimeForAppAtom.

### app_run: appUrl family (M)

- **Writer**: `commands.ts:65` (applyUrl), `:95`/`:159` (clears). State
  already lives on RunState (`url` on ready/reloading) — no new machine
  state, just a convenience hook `useCurrentAppUrl`.
- `PreviewIframe.tsx:219` → `useAppRunState(selectedAppId)`, url from
  ready/reloading (identical `appUrl/originalUrl/mode` shape,
  `state.ts:40`); `TestsPanel.tsx:477` and `RuntimeModeSelector.tsx:43` →
  ready/reloading-with-url boolean. Semantics verified: machine drops the
  URL on stop/errored where the atom retained it — all readers treat it as
  a "dev server running" signal, strictly more correct; `pendingUrl` during
  starting stays hidden. Tests: `useRunApp.test.tsx:355/650/658`,
  `previewRuntimeAtoms.test.ts:186/212/223` deleted.
- Coupling: the applyUrl executor also bumps the reload token
  (`commands.ts:74`) — full deletion of that branch lands with the token
  retirement; keep bump-after-url ordering.

### app_run: previewAppExit family (M — template for the error channel)

- **Writers**: app_run clears (`commands.ts:90/:155`); the value write at
  `useRunApp.ts:208` is a hand-rolled projection already gated on the
  machine admitting APP_EXIT (`:199-207`) — moving the projection into the
  transition removes the dual writer entirely.
- New: extend RunState `stopped` with `timestamp` (the APP_EXIT event
  already carries it; transition currently drops it) + `selectAppExit`
  selector — `didPreviewCommandFail` (`PreviewLoadingScreen.tsx:106-136`)
  needs appId, exitCode, and timestamp.
- `PreviewLoadingScreen.tsx:161` → `selectAppExit(useAppRunState(appId))`.
  Clearing parity holds: START/RESTART replaces `stopped` exactly when the
  executor clears the atom today; verify reload/HMR paths. Migrate the
  component, delete the `useRunApp.ts:208` write, and update
  `useRunApp.test.tsx:258/316` in one change (no window of disagreement).

### app_run: reload token family (L)

- **Writers**: app_run `commands.ts:74/:205/:208`; chat_stream
  `commands.ts:531` — in **runEndSideEffects** (the `run-end-side-effects`
  command; correction: not "handleStreamResponse", and gated on
  `response.updatedFiles && targetAppId !== null`, not on wasCancelled).
- Step 1 (independently shippable): migrate the chat_stream bump to
  `appRunManager.send(targetAppId, {type:"MANUAL_RELOAD"})`. Injection:
  add the manager (or a narrow `requestPreviewReload` callback) to
  ChatStreamRuntimeDeps (`commands.ts:103-108` — currently store,
  queryClient, getSettings, getPosthog). **Wiring works**: deps register
  late via `useChatStreamRuntime()` at `layout.tsx:133`, under
  AppRunProvider (`layout.tsx:75`), so `useAppRunManager()` is in scope —
  despite ChatStreamProvider itself mounting above the router
  (`renderer.tsx:141`). Mirror the wiring in `hybrid_chat_harness.tsx`
  (`:572`, AppRunProvider `:990`). Deferral not strictly required (async
  executor after snapshot commit; app_run never calls back) — add
  queueMicrotask only if routing ever moves into a subscription.
  Semantic delta (flag): MANUAL_RELOAD in `ready` passes through the
  transient `reloading` state; outside `ready` it is the same unconditional
  bump (`transition.ts:309-338`). Alternatively add a dedicated
  BUMP_RELOAD_TOKEN event.
- Step 2: machine-own the counter — per-app monotonic counter store on
  AppRunManager/controller, bumped where the executor bumps today, reset in
  `disposeKey` (parity with the disposal delete; PreviewPanel's key is
  already composite `${selectedAppId}-${key}`, `PreviewPanel.tsx:230`).
- Step 3: `PreviewPanel.tsx:89` → `usePreviewReloadToken(appId)`; re-mock
  in `PreviewPanel.test.tsx:10-11/42/59`; retarget
  `useRunApp.test.tsx:335/361/632/664`; delete the three atoms and their
  clearPreviewRuntimeForAppAtom branch (also touched by
  `previewRuntimeAtoms.test.ts:219`).

### app_run/preview_iframe: previewError channel (L — do last in the preview family)

- **No machine owns the full state**: three sources across six writer
  sites. app_run `commands.ts:57-62` (`dyad-app`); preview_iframe
  `commands.ts:45` clear (cross-machine, runs in beforeNotify —
  synchronous facade calls forbidden); `useRunApp.ts:175-186/:191-195`
  (`dyad-sync`, priority-merge updaters); PreviewIframe `setErrorMessage`
  (`:223-231`) with call sites `:884/:901` (`preview-app`) **plus the four
  the trace missed**: runtime errors with source `dyad-app` (so app_run state
  alone can never replace the reader), sync errors (`dyad-sync`, same clobber
  guard), sync-recovery clear, and user dismiss (clears any source).
  clearPreviewRuntimeForAppAtom and the harness also write the base atom
  directly.
- Owner decision: **preview_iframe** — it already issues both clears and
  hosts the only reader. Extend PreviewIframeState with
  `{message, source}`; new events for set/clear (IFRAME_ERROR, SYNC_ERROR,
  SYNC_RECOVERED, DISMISS, plus a facade for app_run's setError/clearError
  commands, **microtask-deferred** since those execute inside app_run's
  command pipeline).
- Encode in transitions: source-priority updater semantics (dyad-sync must
  not clobber preview-app/dyad-app; only-clear-own-source on recovery),
  dismiss-clears-any, and define the app_run-sets/preview_iframe-clears
  race explicitly (Jotai serializes it today).
- Reader `PreviewIframe.tsx:221` → `selectPreviewError(iframeState)` (it
  already holds iframeState from usePreviewIframe); the source discriminant
  is load-bearing (`:1515` hasStartupError only for `dyad-app`).
- All writer sites land in one change or via temporary dual-write —
  anything else silently desyncs banners. Tests:
  `preview_iframe/commands.test.ts:167-176` (facade mock or own-state
  assert), `useRunApp.test.tsx:174/207/739`,
  `previewRuntimeAtoms.test.ts:255-273` (deleted), harness `:1071/:1081`
  (seed via controller events).

### app_run: console trio (L — reclassified multi-producer buffer)

- **Producers (five)**: app_run executor (`commands.ts:99` clear, `:110`
  start banner, `:163` clear), `useRunApp.ts:277/:303`,
  `useSupabase.ts:204`, PreviewIframe client bridge
  (`:624/:647/:681/:713/:897/:920`), Console clear button (`:73/:116`).
- New keyed PreviewConsoleStore (append/clear facade on or beside
  AppRunManager) preserving `createPreviewConsoleTail` ring-buffer
  semantics (`src/lib/preview_console_buffer.ts`); disposal via
  `disposeKey`.
- Migrate all producers **atomically** (interleaved dual-write forks the
  buffer), then readers: `Console.tsx:72` → `useConsoleEntries(appId)`;
  `PreviewPanel.tsx:90` → narrower `useLatestConsoleEntry(appId)` (kills
  re-render-per-log); `PreviewLoadingScreen.tsx:160` → entries hook. The
  replacement hook takes appId from the caller (the old selector composed
  selectedAppIdAtom).
- Tests: `previewRuntimeAtoms.test.ts` buffer/tail cases → store unit
  tests; `useRunApp.test.tsx:178/209/263/502/509/550`;
  `PreviewPanel.test.tsx:45` re-mock.
- Cheaper fallback if PR 4 runs hot: recategorize as a legitimate shared
  UI log buffer and only remove app_run's machine writes through the
  facade (S). Default is full retirement.

### app_run/chat_stream: package-manager warning unit (M)

- **Producers (four)**: chat_stream `commands.ts:196` (showWarningMessage,
  called from runEndSideEffects `:552` and runErrorSideEffects `:633`;
  settings gating stays in chat_stream); app_run clear `commands.ts:93`
  (**keep the rebuild exception** — banner survives pnpm rebuild);
  `useRunApp.ts:225` (a writer, not a reader; **pnpm-migration bypasses the
  settings gate** — condition is `warningKind === "pnpm-migration" ||
(hasSettings && showWarning)`, preserve the bypass); entity-disposal
  path `renderer.tsx:153` / harness `:558` via
  clearPreviewRuntimeForAppAtom `:363` (the producer the trace missed —
  part of the same migration unit).
- New standalone PackageManagerWarningStore (keyed SnapshotStore, **new
  code**) with setWarning/clear/dismiss/clearAllForApp. Port the two
  business rules verbatim: the dismissed-set guard
  (`previewRuntimeAtoms.ts:284`), and the priority rule **with the correct
  direction — release-age (2) beats pnpm-migration (1); existing warning
  kept only when strictly higher; equal kind is last-write-wins**
  (`:288-296`; characterization test `previewRuntimeAtoms.test.ts:310-341`
  must be ported, not just deleted).
- Reader: `PackageManagerWarningBanner.tsx:43` →
  `usePackageManagerWarning(selectedAppId)`; its clear/dismiss (`:64-65`,
  `:112`) → store methods.
- No machine subscribes — synchronous React notification is safe; if a
  machine ever subscribes, defer per the ORDERING INVARIANT discipline.
- Retirement unit (all in one PR): base atom, set/clear action atoms,
  dismiss pair, currentPackageManagerWarningAtom, banner, the four
  producers, and the warning line in clearPreviewRuntimeForAppAtom. Tests:
  `previewRuntimeAtoms.test.ts` warning cases,
  `useRunApp.test.tsx:387-557`, `PackageManagerWarningBanner.test.tsx`;
  `e2e-tests/package_manager.spec.ts` is behavioral and survives unchanged.

### image_generation: projection family (M, one unit)

- **Writer**: provider `projectToAtom` (`ImageGenerationProvider.tsx:37-46`),
  sole-writer-enforced by `boundaries.test.ts:157-172`.
- Prereq: move `ImageGenerationJob`/`ImageGenerationStatus` types from the
  atom module into `src/image_generation/state.ts`.
- New hooks: `useImageGenerationJobs()` (useSyncExternalStore over
  `manager.subscribeProjection`/`getProjection` — names don't match
  `useControllerSnapshot`'s contract, hence a bespoke hook);
  `useChatImageGenerationJobs()` (**cached** filter keyed on
  projection-array identity — a bare `.filter()` per getSnapshot would
  loop); `useImageGenerationPendingCount()`.
- Readers: `ImageGenerationProgressButton.tsx:12-13`,
  `ImageGenerationProgressDialog.tsx:246`, `ChatInput.tsx:232`,
  `ChatImageGenerationStrip.tsx:21` (both keep composing the kept UI atom
  `dismissedImageGenerationJobIdsAtom`); `ImageGenerationToast.tsx:18` —
  the one module-level `getDefaultStore().get()` escape hatch — inject a
  `getPendingCount` callback from the provider's toast orchestration (the
  manager is provider-owned, not module-global); provider self-read
  (`:53`) → compute from the manager snapshot in scope.
- Retire all four atoms together (jobs, set-projection, pending-count,
  chat-jobs); delete/repoint the boundaries sole-writer guard. Tests:
  `ImageGenerationProvider.test.tsx`, `imageGenerationAtoms.test.ts` →
  plain selector unit tests, `ImageGenerationProgressDialog.test.tsx`.

### clearPreviewRuntimeForAppAtom (retire last)

- Fan-out disposal action over all seven previewRuntime maps
  (`previewRuntimeAtoms.ts:330-367`), called from `renderer.tsx:153` and
  harness `:558`. It is the only per-app leak guard until each map
  retires. Shrink it map-by-map as PRs land (each replacement store
  registers its own `disposeKey` cleanup on the existing entity-disposal
  path, as AppRunProvider already does); delete the atom, the renderer
  wiring, and `previewRuntimeAtoms.test.ts:219-226` when empty.

## PR breakdown

Rule for every PR: behavior-preserving under the existing test suites;
any intentional delta is listed in the PR description (the known set:
notification timing +1 microtask, checkout loading-bar span, MANUAL_RELOAD
transient `reloading` state, machine URL dropping on stop). A PR that has
to change a transition test to pass is out of scope by definition.

### PR 1 — S-tier mirrors, no new stores

Completion-event pair (with chatSummary plumbing), firstPromptSaga pair,
checkout counter pair (delete `src/store/appAtoms.ts`),
pendingToolConsentsAtom, run-state derived trio
(currentPreviewLoading/RunState/RunStartedAt + PreviewLoadingScreen
one-liner). Prereqs: none. Regression tests: `src/pages/home.test.tsx`,
`src/state_machines/boundaries.test.ts` (first_prompt guard),
`src/version_preview/commands.test.ts`, `src/hooks/useRunApp.test.tsx`
(loading assertions → machine snapshots), `src/atoms/previewRuntimeAtoms.test.ts`,
notification smoke via `src/hooks/useNotificationHandler` coverage.

### PR 2 — single-machine store conversions

image_generation family (types move + 3 hooks + toast callback), user_input
family (adapter → SnapshotStore; userInputRequests + respondingRequestIds +
the planAtoms/integrationAtoms deriveds), streamingPreviewByChatIdAtom
sidecar store (establishes the sidecar pattern), previewAppExit family
(timestamp on `stopped` + selectAppExit — the template for PR 4's error
work). Prereqs: none (parallel with PR 1). Regression tests:
`ImageGenerationProvider.test.tsx`, `imageGenerationAtoms.test.ts` (ported
to selector tests), `ImageGenerationProgressDialog.test.tsx`,
`src/user_input/projection.test.ts` (full port),
`explore_chat_history_streaming.integration.test.tsx`,
`useRunApp.test.tsx:258/316`.

### PR 3 — cross-machine signal edges into app_run and screenshot

pendingScreenshotAppIds facade (both producers + wiring restructure in one
change), previewRunStateByAppId + setter (preview_iframe deferred facade),
reload-token family (chat_stream → MANUAL_RELOAD facade, then
manager-owned counter), appUrl family. Prereqs: PR 1 (derived trio gone).
Regression tests: `ScreenshotProvider.test.tsx` (rewritten),
`src/preview_iframe/usePreviewIframe.test.tsx`,
`src/app_run/manager.test.ts`, `useRunApp.test.tsx`
(url/token/run-state assertions), `PreviewPanel.test.tsx` (re-mock),
harness wiring check for the AppRunManager dep.

### PR 4 — multi-producer channels get owned stores

previewError channel (preview_iframe owner; all six writer sites including
the four missed PreviewIframe ones, deferred app_run facade), console trio
(PreviewConsoleStore, five producers atomically), package-manager warning
unit (store with **release-age-wins** priority, dismiss pair folded in,
all four producers). clearPreviewRuntimeForAppAtom reaches empty and is
deleted here along with `src/atoms/previewRuntimeAtoms.ts`. Prereqs: PR 3
(facade pattern, applyUrl/token coupling resolved, app-exit template).
Regression tests: `preview_iframe/commands.test.ts`,
`useRunApp.test.tsx:174/207/739` and `:178-550` console cases and
`:387-557` warning cases, `PackageManagerWarningBanner.test.tsx`
(including the ported priority-direction test),
`e2e-tests/package_manager.spec.ts` (behavioral, unchanged).

### PR 5 — chat_stream / plan_handoff core (internally stacked series)

Lands as an ordered stack behind one umbrella: (a) isStreamingByIdAtom —
useStreamChat + component readers, ChatTabs aggregate selector,
plan_handoff isIdle/watchIdle facade **with disposal observation**,
resyncChat injection, delete atom + syncProjection + **both #4077
protective comments**; bundle chatErrorByIdAtom (external-error event,
lastError durability) in the same stack; (b) queue pair → QueueStore, one
PR; (c) chatMessagesByIdAtom — messages store landed behind existing write
pattern, version_preview `replaceChatMessages` facade (stream-active
guard), hydrate command, readers flipped, atom deleted last; (d)
planStateAtom split (getPlanData dep → accepted-chats projection →
planDocumentsAtom rename). Prereqs: PRs 1–2 (completion event and sidecar
patterns; shared files with useStreamChat settled). Regression tests:
`chat_stream/__tests__/{manager,queue_dispatch,commands}.test.ts`,
`plan_handoff/commands.test.ts` (fake facade),
`useStreamChat.test.tsx`, `DyadMarkdownParser.test.tsx`,
`explore_chat_history_streaming.integration.test.tsx`,
`src/testing/hybrid_chat_harness.tsx` seed/assert helpers,
`version_preview/commands.test.ts:150/:197` — plus the full E2E streaming
suite, since streaming render is the most E2E-covered surface in the app.

## Non-goals

- **Moving UI-only atoms into machines.** Category 1 stays Jotai; this
  plan removes machine-owned state from Jotai, not UI state from Jotai.
- **Rewriting consumers' UX or component structure.** Readers swap their
  subscription source; render output is unchanged. Known micro-deltas are
  flagged, not designed around.
- No XState or generic pub/sub bus; facades are narrow, typed,
  per-edge methods on existing managers.
- The main-process user_input registry, connection_flow, github_ops,
  voice_to_text, and mcp_oauth are untouched (they project nothing).
- Not redesigning reload-as-remount (the preview_iframe `iframeEpoch`
  alternative changes remount semantics — out of scope).
- Not fixing the usePlan/usePlanEvents dual-source write race for plan
  documents; it moves intact and gets a comment.
- Not retiring machine _reads_ of UI-owned atoms (selectedAppIdAtom etc.);
  input-dependency cleanup is a separate discussion.

## Success criteria

- **Zero machine-written Jotai atoms** except the documented deliberate
  keeps (plan_handoff navigation writes to previewModeAtom /
  selectedChatIdAtom; first_prompt's post-submit clears of
  homeChatInputValue / homeSelectedApp / attachments; chat_stream and
  first_prompt writes to isPreviewOpenAtom), each carrying a comment
  naming this plan. `registerAtomWriter`/`projectToAtom` have no remaining
  production callers and are deleted from `src/state_machines/projection.ts`.
- **Cross-machine communication happens only through facades or owned
  stores**, with microtask-deferred delivery on every edge that would
  otherwise run inside another machine's dispatch (app_run→preview_iframe
  run-state and error edges; plan_handoff watchIdle inherits deferral from
  subscribeStreamFinished and additionally observes disposal). No machine
  `store.get`/`store.sub`s an atom written by another machine.
- **The #4077 protective comments are deleted** — the ORDERING INVARIANT
  block at `src/chat_stream/controller.ts:181-192` and its companion at the
  plan_handoff watch-stream-idle site — because the re-entrancy vector they
  guard no longer exists, not because they were suppressed.
- `src/atoms/previewRuntimeAtoms.ts`, `src/store/appAtoms.ts`,
  `src/first_prompt/projection.ts`'s atoms, and the projection atoms in
  `src/user_input/projection.ts` are gone;
  `clearPreviewRuntimeForAppAtom` and its renderer/harness wiring are gone;
  per-app/per-chat cleanup rides `useRegisterEntityDisposer` +
  `disposeKey` everywhere.
- Behavior parity: all listed unit/integration suites pass ported (not
  weakened); `e2e-tests/package_manager.spec.ts` and the streaming E2E
  suite pass unchanged; the priority-direction characterization test
  (release-age over pnpm-migration) exists against the new store.
- The boundaries tests that enforced sole-writer atom discipline are
  deleted or inverted to assert the atoms no longer exist.
