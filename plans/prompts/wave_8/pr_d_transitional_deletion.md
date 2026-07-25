# Phase D — Delete transitional infrastructure

Implement Phase D of plans/cleanup-state-machines.md. The plan wins.
Gate: the C waves this deletes for have landed and soaked (at least one
release cycle since the last authority cutover — check release history);
A7 landed.

Scope, one commit per family:

1. Remove superseded renderer controllers/managers/registries that C
   waves replaced but retained as temporary adapters — and ONLY those
   actually replaced (the plan: documented resource registries may remain
   as an accepted end state; connection_flow/mcp_oauth per their C2
   disposition).
2. Remove remaining projection writers, atom mailboxes, and any legacy
   IPC channels the C waves narrowed — after the supported update window
   for transport compatibility branches (check the versioning policy in
   the B3/C1 contracts before deleting compatibility code; in-flight
   updates cross versions).
3. Remove temporary legacy adapters from C1 (the old app-run IPC handlers
   that dispatched the actor for legacy callers) if any callers remain,
   migrate them first.
4. Boundary additions per the plan: prevent reintroduction of lifecycle
   mirrors, untyped window routing, and module-global renderer stores.
5. Docs: rules/state-machines.md, rules/electron-ipc.md,
   rules/jotai-state.md, docs/why-state-machines.md describe the
   implemented architecture, not the transitional one. Update the plan's
   Status to reflect completion; run the end-state success-criteria list
   as a literal checklist in the PR description, marking each criterion
   met or naming the tracked exception.

Verify: typecheck, full tests, lint, golden suite green, packaged E2E
smoke (single- and two-window). /deep-review on the compatibility-branch
deletions (the riskiest part — update-window math). Branch
cleanup-d-transitional-deletion; /pr-push.
