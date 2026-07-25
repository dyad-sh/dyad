# Phase D — Final transitional-infrastructure removal

Implement the FINAL Phase D of plans/cleanup-state-machines.md — read its
Phase D section first: deletion is ROLLING and immediate (each C wave
deletes its own temporary adapters in a separate PR landing right behind
its cutover; those PRs are part of the C-wave prompts' completion, not
this one). This prompt is the remainder. The plan wins.

Note the recorded correction: there is NO live-IPC version-skew window in
production (updates apply on restart; one bundle). Do not look for a
"supported update window" and no bake/soak of any kind before deleting
transport code — the rolling deletions land immediately behind their
cutovers; separation is for review clarity only. Persisted-state
schema/migration code is NOT transitional — keep it.

Gate: all C-wave trailing deletions landed; A7 landed.

Scope, one commit per family:

1. Remove any superseded renderer controllers/managers/registries the
   rolling deletions missed — and ONLY those actually replaced (documented
   resource registries may remain as an accepted end state;
   connection_flow/mcp_oauth per their C2 disposition).
2. Remove remaining projection writers, atom mailboxes, and legacy IPC
   channels the C waves narrowed.
3. Verify no temporary legacy adapters remain (each wave's trailing PR
   should have deleted its own; migrate any straggler callers first).
4. Boundary additions per the plan: prevent reintroduction of lifecycle
   mirrors, untyped window routing, and module-global renderer stores.
5. Docs: rules/state-machines.md, rules/electron-ipc.md,
   rules/jotai-state.md, docs/why-state-machines.md describe the
   implemented architecture, not the transitional one. Update the plan's
   Status to reflect completion; run the end-state success-criteria list
   as a literal checklist in the PR description, marking each criterion
   met or naming the tracked exception.

Verify: typecheck, full tests, lint, golden suite green, packaged E2E
smoke (single- and two-window). /deep-review. Branch
cleanup-d-transitional-deletion; /pr-push.
