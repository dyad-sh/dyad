# PR A6b — Chat storage implementation (GATED: do not start before G1 is accepted)

STOP unless plans/g1-chat-stream-study.md exists and its recommendations
have been accepted (check the plan's G1/A6b status lines). This PR
implements the STUDY'S design, not the appendix recipes — the appendix's
MessagesStore/QueueStore/accepted-plan-projection sections are evaluated
inputs the study may have amended or rejected. If the study routed any
item to the C3 host move instead, that item is out of scope here.

Read: plans/cleanup-state-machines.md (A6b section + rollout rules);
plans/g1-chat-stream-study.md (the design of record for this PR);
appendix recipes for chatMessagesByIdAtom, the queue pair, and
planStateAtom (reader inventories and regression-test lists remain valid
even where storage design changed). A6a has landed — status/error
selectors and the plan_handoff facade exist; build on them.

Scope (as approved by the study — likely shape):

1. Messages: the study-approved owner for renderer message state, with
   the write funnel covering streaming writes, the version_preview
   replaceChatMessages facade (WITH the stream-active guard — nothing
   guards that write-write conflict today), and the component hydrators
   via a hydrate path. Land the store behind the existing write pattern
   first, flip readers second, delete chatMessagesByIdAtom last. This is
   the highest-regression-risk change in Phase A: full streaming E2E
   suite required.
2. Queue pair: one store for queued+paused (atomic dequeue reads paused
   synchronously before pop — splitting reintroduces read-skew).
   Preserve: memory-only per-item callbacks, item object identity
   (WeakMap cache keys), write-before-poke ordering, restore-as-paused
   hydration.
3. planStateAtom split: acceptedChatIds → plan_handoff projection
   (+useIsPlanAccepted surviving return-to-idle); plansByChatId → the
   study-approved owner (renamed UI atom or React Query); inject
   getPlanData into PlanHandoffDeps; delete the mark-plan-accepted
   command. The usePlan/usePlanEvents dual-source race moves intact with
   a code comment (out of scope).

Rules: same-PR consumer migration + atom deletion per unit; allowlist
entries removed; behavior-preserving with enumerated deltas; transition
changes only where the study sanctioned them (isolated commits).

Verify: typecheck, full unit tests, lint, full streaming E2E. Suites per
recipes: chat_stream **tests** trio, useStreamChat.test.tsx,
useQueuePersistence.test.ts, version_preview/commands.test.ts, PlanPanel
coverage, hybrid harness. /deep-review. Branch cleanup-a6b-chat-storage;
/pr-push; update plan status.
