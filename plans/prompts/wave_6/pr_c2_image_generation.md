# C2 — image_generation host migration

Implement the image_generation wave of C2 in plans/cleanup-state-machines.md.
The plan wins. Prereqs: a prior C2 wave landed (pattern reuse); the B0
ADR resolved this machine's app-quit policy and app-restart persistence
decision — those calls are binding here.

Pre-code artifacts: lifecycle matrix row per the ADR; serializability
audit (job payloads and attachments — decide what crosses the wire vs
stays referenced); safe projection (job list is the read model — A3
already shaped the manager's snapshot/subscribe surface as exactly this;
publishing it remotely should be nearly mechanical); deletion budget
(renderer per-job dispatcher controllers, the provider's toast
orchestration moves to presentation events routed per decision 5 with
first-window semantics from the ADR).

Semantics to preserve: cancellation is best-effort with the main IPC
promise as terminal authority (this simplifies under main-hosting — the
authority and the machine are finally in the same process; note the
deletion of the late-cancel projection guard if it becomes structural);
lateAfterCancel exclusion from chat projection; cancelling presentation
state; terminal-job retention/pruning policy moves to the actor's
lifecycle policy. dismissedImageGenerationJobIdsAtom stays per-window UI
state composing with the remote read model.

Tests: existing image_generation suites ported to drive the actor; job
visible from a second window; window close mid-job (continues per
decision 2); chat-strip auto-attach behavior unchanged (the
lateAfterCancel regression class); quit/restart per the ADR decisions.
Golden suite green. /deep-review. Branch c2-image-generation; /pr-push;
update plan status + matrix.
