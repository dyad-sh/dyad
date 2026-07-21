# More state-machine candidates

## Status

Planning only. This document does not authorize implementation. It is a survey
of other workflows in the codebase that exhibit the same disease the Version
History preview plan ([version-preview-state-machine.md](./version-preview-state-machine.md))
was written to cure, ranked by expected value. Each candidate would get its own
design document (matching the depth of the version-preview plan) before any
implementation.

## The disease pattern (selection criteria)

A workflow qualifies when it is _orchestration_ — a multi-step process with
async boundaries where ordering matters — but is implemented as ordinary
component state. The tell-tale symptoms, all present in `VersionPane` before
the version-preview plan:

1. **Refs mirroring reactive state** so async callbacks can dodge stale
   closures (`fooRef` synced from `foo` by an effect).
2. **Request-id / generation counters** hand-rolled to reject stale async
   results.
3. **Boolean in-progress flags** (often duplicated in both a ref and a
   `useState`) standing in for unrepresented states.
4. **Effects inferring transitions from prop edges**
   (`prev !== current` ⇒ "a transition happened").
5. **Multiple independent writers** to the same status flag, with last-writer-
   wins semantics.
6. **Timing hacks** (`setTimeout(…, 100)` "let state settle") papering over
   races.
7. **Overlap-prone mutations** with no serialization or exit-intent handling.

Not every ref-heavy file qualifies. Imperative-library handles (xterm,
Monaco, DOM nodes), "latest callback" refs, and virtualization/scroll
bookkeeping are legitimate plumbing — several files were examined and
explicitly rejected below so this survey doesn't get re-litigated.

The prescription is the one already decided for version preview: a **vanilla
TypeScript machine** — pure `transition(state, event) → { state, commands }`,
a small serial command executor, `useSyncExternalStore` binding — under the
same complexity budget and guardrails. No XState; the decision record in the
version-preview plan applies to all of these.

## Ranking summary

| #   | Workflow                             | Value           | Why                                                                                           |
| --- | ------------------------------------ | --------------- | --------------------------------------------------------------------------------------------- |
| 1   | Chat streaming + message queue       | **High**        | Worst concentration of the disease; 3 concrete reachable bugs                                 |
| 2   | OAuth / integration connection flows | **High**        | Real user-facing impossible states; team already firefighting races point-by-point (b05d2bb7) |
| 3   | Plan-mode implementation handoff     | **High**        | Textbook match, small surface, load-bearing sleeps                                            |
| 4   | App run / preview run-state core     | **Medium-high** | Real races but self-healing; extract only the run-state core                                  |
| 5   | FileEditor save/dirty lifecycle      | Medium          | Contained; double state-mirroring; do opportunistically                                       |
| 6   | Voice-to-text recording lifecycle    | Medium          | Contained; hand-rolled generation counter; do opportunistically                               |
| —   | Everything else examined             | Low / N.A.      | See "Examined and rejected"                                                                   |

---

## 1. Chat streaming + message queue (HIGH)

**Scope today:** `src/hooks/useStreamChat.ts` (~800 lines),
`src/hooks/useQueueProcessor.ts`, `src/hooks/useQueuePersistence.ts`,
`src/atoms/chatAtoms.ts`, `src/components/chat/ChatInput.tsx`,
`src/components/ChatPanel.tsx`, `src/ipc/contracts/core.ts`
(`createStreamClient`), main-process `src/ipc/handlers/chat_stream_handlers.ts`.

### Evidence

"Is this chat streaming" is represented redundantly in **five-plus places**
that must be manually kept coherent:

- module-level `pendingStreamChatIds: Set<number>` (`useStreamChat.ts:64`) —
  its own comment admits it exists to patch a race ("prevents race conditions
  when clicking rapidly before state updates");
- `isStreamingByIdAtom` (`chatAtoms.ts:44`) — the React-visible flag, set
  `false` from **six** independent code paths;
- `streamCompletedSuccessfullyByIdAtom` (`chatAtoms.ts:534`) — a success
  latch used as a covert event channel to the queue processor;
- main-process `activeStreams: Map<chatId, AbortController>`
  (`chat_stream_handlers.ts:175`);
- `chatStreamCountByIdAtom` / `recentStreamChatIdsAtom` (scroll triggers).

Other symptoms: `prevIsStreamingRef` edge-detection in `ChatPanel.tsx:95,185`;
the queue dispatcher (`useQueueProcessor.ts:32-90`) is an effect that ANDs
three atoms and clears a latch "first to prevent loops"; `useQueuePersistence`
coordinates hydrate→arm→persist through 8 refs including self-echo
suppression (`hydrationResultRef`); `createStreamClient` (`core.ts:446-535`)
keys callbacks by chatId and **overwrites them with no stream generation id**,
so stale end/error events are defended against by scattered
`store.get(isStreamingByIdAtom)` re-checks in `useStreamChat.ts:507` and
`resyncChat.ts`. Dead `chat:stream:start/end` channels (emitted by main,
zero renderer consumers) confirm accreted rather than designed lifecycle.

### Concrete reachable bugs (not just tidiness)

1. **Submit-window message drop.** `ChatInput.handleSubmit` branches on the
   `isStreaming` atom, which lags the module set. A message submitted in that
   window passes the queue check, is sent immediately, gets rejected by
   `pendingStreamChatIds`, and is silently dropped — input already cleared.
2. **Cancel-before-registration divergence.** Cancel fired before main
   registers the AbortController (`chat_stream_handlers.ts:344`) sends a
   synthetic `wasCancelled` end; the real stream runs to completion and
   applies file changes, but its end event is dropped because the renderer
   stream entry was already deleted. UI says cancelled; disk says applied.
3. **Queue double-dispatch.** Two near-simultaneous effect runs of
   `useQueueProcessor` can both pass the triple-flag guard before either
   clears the latch; `pendingStreamChatIds` is the only backstop.

### Sketch

Per-chat renderer machine: `idle → starting → streaming → finalizing → idle`,
plus `cancelling` and `errored`. `starting` is the currently-unrepresented
state behind bugs 1 and 2. Queue becomes an explicit
`FINALIZED → dispatch-next` command instead of a flag-scan effect. Main
process stays the engine but tags every lifecycle event with a monotonic
`streamId` so `createStreamClient` rejects stale events structurally —
repurpose the dead `chat:stream:start` channel as the registration
confirmation. Commands: convert-attachments, invoke-stream, request-abort,
resync-from-db, refresh-app, signal-queue, invalidate-queries.

**Deliberately out of scope:** the main-process multi-phase retry loops
(Turbo Edits, unclosed-write continuation, auto-fix) are inherent LLM
orchestration, not state-modeling debt. The machine owns lifecycle, not that.

**Why highest value:** most redundant state, only candidate with three
concrete user-reachable correctness bugs, and every future chat feature
(queueing, approvals, background streams) builds on this lifecycle.
**Effort:** large — spans renderer and main; needs its own design doc with
the same rigor as version preview (invariants, totality test, migration
phases).

---

## 2. OAuth / integration connection flows (HIGH)

**Scope today:** `src/contexts/DeepLinkContext.tsx`,
`src/components/{Supabase,Neon,GitHub}Connector.tsx`, `src/main.ts:1022-1179`
(deep-link routing), `src/main/deep_link_queue.ts`,
`src/ipc/handlers/github_handlers.ts:292-507` (device flow),
`src/supabase_admin/supabase_return_handler.ts`,
`src/neon_admin/neon_return_handler.ts`, `src/atoms/integrationAtoms.ts`,
`src/hooks/useIntegration{Events,Continue,Continuation}.ts`,
`src/pro/main/ipc/handlers/local_agent/userInputResolver.ts`.

### Evidence

Three different connection mechanisms, each with its own hand-rolled partial
state machine:

- **Deep-link returns (Supabase/Neon):** one global `lastDeepLink` broadcast;
  every mounted connector infers "a return happened" from a **timestamp
  edge** (`SupabaseConnector.tsx:85-96`, `NeonConnector.tsx:101-117`,
  `useAddPromptDeepLink.ts:13-26` — deps narrowed to `timestamp` with eslint
  disabled). Neon adds an `oauthTimeoutRef` + `isOpeningOauth` + hardcoded
  20s timer trio; double-click orphans a timer that later fires a spurious
  "timed out" toast (`NeonConnector.tsx:139-143`).
- **GitHub device flow:** `currentFlowState` is a **module-global singleton
  in main** (global across windows and apps), mirrored by six unsynced
  `useState` values in the renderer, with no cancel IPC — unmount resets the
  renderer copy while main keeps polling.
- **Agent continuation:** three maps (two renderer atoms + main resolver map)
  plus a `prevStreamingRef` edge-detector (`useIntegrationContinuation.ts:40`);
  the code's own comments (`useIntegrationContinue.ts:53-57`) document the
  ordering hazard where the continuation message is lost.

Commit `b05d2bb7` ("Fix Supabase OAuth token propagation race") is direct
evidence of point-by-point firefighting: a 401 retry ladder was added to
`listSupabaseOrganizations` only — the neighboring fresh-token calls
(`listAllProjects`, branch queries fired by the connector's refetch) have no
equivalent retry, and the fallback path can produce a
**"connected but no organizations"** state
(`supabase_return_handler.ts:66-81`).

### Impossible states reachable today

- Neon: "timed out" toast followed by "connected" success when auth completes
  at second 25.
- GitHub: token written to settings while the UI never reflects it (poll
  succeeds after unmount); connecting app A blocks app B via the
  process-global guard.
- A stale/replayed `dyad://…-return` link overwrites credentials with no
  pending flow to validate against; whichever mounted connector consumes the
  broadcast first wins.
- Supabase connect with no timeout at all: browser closed ⇒ silently stuck.

### Sketch

One **per-provider connection machine**, main-authoritative with a thin
renderer projection. Every start allocates a `flowId`; deep-link returns and
device-poll completions carry it, so a return with no matching pending flow
is ignored instead of blindly writing tokens. States: `disconnected →
starting → awaiting-return → exchanging-token → loading-resources →
connected | failed(reason) | cancelled`. Timeout and return become mutually
exclusive transitions; double-click is a no-op from `starting`. A second
small machine keyed by `requestId` replaces the three-map continuation flow
(`prompted → awaiting-user → responding → continuing → done | aborted |
timed-out`).

**Why high value:** these are credential-writing flows with user-visible
contradictory states, and the `flowId` correlation kills a whole class of
races the team is currently patching one 401-retry at a time. **Effort:**
medium-large; mostly main-process, which also aligns with the
version-preview plan's stated direction (main-process session ownership).
GitHub device flow is the best first slice — self-contained, worst offender.

---

## 3. Plan-mode implementation handoff (HIGH)

**Scope today:** `src/hooks/usePlanImplementation.ts`,
`src/hooks/usePlanEvents.ts`, `src/atoms/planAtoms.ts`.

### Evidence

The accept-plan → implement handoff is a textbook uncancellable saga:

- `wasStreamingRef` edge detection (`usePlanImplementation.ts:41,70-71`):
  `streamJustCompleted = wasStreaming && !isNowStreaming` — **two different
  code paths** decide when to start implementation depending on whether the
  streaming atom happened to update before or after `pendingPlan` was set.
- `hasTriggeredRef` one-shot latch (`:39`), reset only when `pendingPlan`
  nulls.
- `setTimeout(…, 100)` "small delay to let state settle" (`:86,214`) — a
  literal timing hack in the dispatch path.
- `usePlanEvents.onExit` (`:73-188`) is a multi-await saga — cancel stream →
  **hardcoded `sleep(2500)`** → persist plan → maybe create chat + navigate →
  queue implementation — with no re-entrancy guard, no keying by chat, and
  no recovery if a second exit or unmount lands mid-saga.
- `planStateRef` / `acceptInNewChatByChatIdRef` (`usePlanEvents.ts:42-47`)
  mirror atoms for the async handler.

### Sketch

Single machine: `plan-ready → accepted → cancelling-stream → transitioning →
persisting → creating-chat → queued → implementing → done | error`, with
commands `cancel-stream`, `create-plan`, `create-chat`, `navigate`,
`start-implementation-stream`. The stream-end signal becomes an event
(ideally from the chat-streaming machine in candidate 1), deleting both the
edge detector and the 100ms/2500ms sleeps.

**Why high value despite small size:** it has every symptom at once, the
sleeps are load-bearing, and the saga touches Git-adjacent state (creates
chats, fires streams). **Effort:** small — the best candidate for the
_second_ implementation of the pattern after version preview, to prove the
template generalizes before tackling chat streaming. Note the dependency:
it consumes stream-lifecycle events, so its final form is cleaner after (or
designed alongside) candidate 1.

---

## 4. App run / preview run-state core (MEDIUM-HIGH, scoped subset)

**Scope today:** `src/hooks/useRunApp.ts`,
`src/atoms/previewRuntimeAtoms.ts`, parts of
`src/components/preview_panel/PreviewIframe.tsx` and `PreviewPanel.tsx`,
main-process `src/ipc/handlers/app_handlers.ts` +
`src/ipc/utils/process_manager.ts`.

### Evidence

- Per-app run-state is a single `PreviewRunState | undefined` with **no
  operation identity**. `runApp`, `stopApp`, `restartApp`,
  `restartAppWithStore`, `useRebuildAppAfterPnpmInstall`, and the
  proxy-output handler all write it; a stale `finally` block can clear a
  newer operation's state (last writer wins).
- Two independent "run finished" signals — the `runApp` IPC promise settling
  and the `[dyad-proxy-server]started=` stdout regex
  (`useRunApp.ts:226-257`) — with no ordering guarantee: the loading screen
  can hide before the URL is set, or a re-emitted cached proxy line can
  clear a fresh restart's loading state.
- **Four copy-pasted restart/run bodies** (the uncommitted
  `restartAppWithStore` extraction makes it more visible, not less).
- Readiness and HMR are inferred from stdout substring matches
  (`PreviewIframe.tsx:352-357`), not typed events.
- The frontend re-implements the backend's generation guard
  (`process_manager.ts` `processCounter`/`removeAppIfCurrentProcess`) by hand
  in ~6 places: `selectedAppIdRef` bailouts, two screenshot request-id
  channels, `PreviewLoadingScreen` reconstructing session start by scanning
  console entries backwards.

### Sketch

Per-app machine with a `runId` epoch on every state: `idle → starting →
ready → reloading (hmr|manual) → stopping → stopped`, plus `errored`.
`PROXY_READY` / `RUN_IPC_RESOLVED` carrying a stale `runId` are dropped by
the executor, replacing the racing `finally` blocks. `loading` becomes
`state.type` membership instead of the derived
`currentPreviewLoadingAtom` boolean. The four duplicated restart bodies
collapse into commands.

**Why medium-high, not high:** unlike Git checkout or credential writes, the
worst outcomes are a loading flicker, a stale URL, or a double iframe
remount — annoying, not corrupting — and the backend's `withLock(appId)`
already serializes the dangerous half. But the run-state stomping and the
duplicated bodies are bugs-in-waiting, and the version-preview command
adapter (which restarts apps in cloud mode) will sit on top of this
lifecycle, so hardening it has compounding value.

**Explicitly excluded:** the in-iframe navigation/history/address-bar logic
and the screenshot pipeline in `PreviewIframe.tsx`. They are large but
event-driven UI concerns with their own working stale guards; folding them
in would bloat the machine. At most, give the screenshot pipeline a shared
epoch helper.

---

## 5–6. Contained medium candidates (do opportunistically)

Both are single-file lifecycles with the literal "flag mirrored in a ref and
a useState" smell. Neither justifies a standalone project; convert whenever
the file is next touched for a real bug or feature, reusing the
transition-function template.

**FileEditor save/dirty (`src/components/preview_panel/FileEditor.tsx`).**
`isSaving` state + `isSavingRef` (the real guard), `displayUnsavedChanges`
state + `needsSaveRef` (the real dirtiness), `originalValueRef` /
`currentValueRef` / `hasInitializedContentRef`, and a hand-rolled
`saving → saving-dirty → dirty` re-arm (`hasNewerEdits`, `:299`). A 4-state
machine (`clean → dirty → saving → saving-dirty`) collapses the four
mirrored fields. The external serial save queue (`fileSaveQueue.ts`) already
plays the executor role. The subtle case to preserve: a content-prop refetch
landing while dirty must not clobber edits.

**Voice-to-text recording (`src/hooks/useVoiceToText.ts`).**
`startAttemptRef` is a hand-rolled generation counter guarding
`getUserMedia` overlap; `isStartingRef` and the stopping phase are states
that exist in refs but not in the two `useState`s, so
`isRecording` and `mediaRecorderRef.current?.state` can disagree (the
OR-check at `:96` exists because of it). Machine: `idle → starting →
recording → stopping → transcribing → idle`, killing `startAttemptRef`,
`isStartingRef`, `skipOnStopProcessingRef`, and `stopReasonRef`.

---

## Examined and rejected (do not re-litigate without new evidence)

- **`useTerminalSession.ts` / `TerminalPanel.tsx`** — already half an FSM
  (`TerminalStatus` enum). Residual issues: a hidden `hydrating` substate
  living in closure vars and multiple imperative `setStatus` writers. Revisit
  only if terminal reconnect/hydration bugs actually occur; the panel's 9
  refs are xterm.js handles, not state.
- **`TestsPanel.tsx`** — run lifecycle is already a proper FSM
  (`TestRunPhase` in `testRuntimeAtoms.ts:26` with a reducer-style atom).
  This is the in-repo proof the pattern works; nothing to do.
- **`useNotificationHandler.ts`** — 11 refs but several independent
  listeners with idempotency latches and resource maps; no phases, no
  overlap. Plumbing, not orchestration.
- **`Console.tsx`**, **`useAttachments.ts`**, **`useAppBlueprintEvents.ts`**
  — scroll/virtualization bookkeeping, a DOM ref, and a cleanly
  event-sourced atom respectively.
- **Updater / in-app upgrades** — delegated to `update-electron-app`;
  `AppUpgrades.tsx` is clean React Query. Nothing to model.
- **`supabase_deploy_queue.ts`** — already a correct serial/concurrency
  executor. It is the good pattern, not a refactor target.
- **Vercel connector** — list/refresh via React Query plus a cosmetic
  min-loading timer. No lifecycle to model.

---

## Recommended sequencing

1. **Ship version preview first.** It is the template: transition-function
   conventions, totality tests, controller shape, complexity budget.
2. **Plan-mode handoff (candidate 3)** as the second implementation — small
   enough to validate that the template generalizes, and it deletes real
   timing hacks.
3. **GitHub device flow**, then the deep-link connection machine
   (candidate 2) — main-process-authoritative, which also pilots the
   main-process direction the version-preview follow-up wants.
4. **Chat streaming + queue (candidate 1)** — highest value, biggest lift;
   do it with the confidence of three prior machines and its own full design
   doc.
5. **App run-state core (candidate 4)** — can proceed in parallel with 3–4;
   it interacts with the version-preview command adapter, so coordinate the
   `runId` epoch design with that code.
6. FileEditor and voice-to-text whenever those files are next touched.

## Shared-infrastructure guardrail

After the second machine exists, expect pressure to extract a generic
`createMachine`/controller framework. Resist it until **three** machines are
in-tree and the duplication is demonstrably mechanical; then extract only
the smallest shared kernel (snapshot/subscribe contract, dev-mode
single-mutation assertion, ring-buffer debug log). The version-preview
plan's complexity budget applies per machine, and its rationale — the safety
comes from the model, not a library — applies doubly to an in-house library.
Each machine keeps its own `state.ts`/`transition.ts` with zero non-type
imports; that rule is what keeps every one of them portable to the main
process later.
