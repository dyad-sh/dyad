# PR A6a — Streaming status and error retirement

Implement PR A6a of plans/cleanup-state-machines.md, unblocked by design
gate G1a — read the "G1a — DECIDED" section first; it is the contract
this PR implements and wins over both this prompt and the appendix.
Prereqs: A2 (#4091) landed; rebase over A3 (#4092) (shared files:
useStreamChat, DyadMarkdownParser, chat_stream/commands.ts). Update the
plan's A6a status; remove the atoms' A1 allowlist entries.

Appendix recipes: "chat_stream: isStreamingByIdAtom (L)" and
"chat_stream: chatErrorByIdAtom (M)" carry the verified reader-by-reader
map.

Scope — the ordered stack:

1. isStreamActive-family selectors over StreamState; migrate useStreamChat
   first (~15 components follow), then direct readers (ChatPanel,
   PromoMessage, DyadOutput, DyadMarkdownParser). Every hook read uses
   the ?? {type:"idle"} fallback (G1a: no controller means idle).
2. ChatTabs aggregate: per-tab keyed subscriptions (G1a decision 1); no
   manager index unless an existing perf test fails.
3. plan_handoff facade per G1a decision 2, exactly: isIdle(chatId);
   watchIdle(chatId, cb) — at most once, check-subscribe-recheck,
   delivery ALWAYS async via microtask even when already idle, and
   observing controller disposal (unify subscribeStreamFinished + errored
   - a disposeKey hook — subscribeStreamFinished alone does not fire on
     disposeKey). Injected via PlanHandoffDeps. Replace watch-stream-idle's
     Jotai subscription; preserve TaskScope watcher disposal on
     supersession.
4. resyncChat: inject getIsStreaming(chatId) through chat_stream command
   deps.
5. chatErrorByIdAtom per G1a decision 3: readers → machine errored state
   via selectStreamError; ChatInput consent-failure writes route through
   the new additive `external-error` event — the ONE sanctioned
   transition delta (isolated commit, exhaustive matrix updated, called
   out in PR description). Last-error durability: bounded
   lastErrorByChatId map on the manager, cleared on next submit and chat
   deletion.
6. Tests/harness drive the machine, never the atoms (recipe lists every
   site). REQUIRED beyond the recipe: (a) watched chat's controller
   disposed mid-stream → watchIdle fires exactly once, asynchronously;
   (b) a watchIdle callback synchronously calling chatStream.submit is
   safe — the re-entry lands as a fresh send, not mid-setState.
7. Delete: both atoms, syncProjection + AtomProjectionWriter plumbing,
   the disposeKey projection write, and BOTH #4077 protective comments
   (chat_stream/controller.ts ORDERING INVARIANT block + the plan_handoff
   companion). Verify nothing else depends on the accidental ordering
   before removing the comments — the invariant text lists what it
   protected.

Verify: typecheck, full unit tests, lint, then the full streaming E2E
suite locally (widest reader blast radius in Phase A). /deep-review; fix
confirmed findings. Branch cleanup-a6a-streaming-status; /pr-push. PR
description: G1a contract implemented, sanctioned transition delta,
disposal-observation test, #4077 deletion rationale.
