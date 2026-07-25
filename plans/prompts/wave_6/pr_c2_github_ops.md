# C2 — github_ops host migration

Implement the github_ops wave of C2 in plans/cleanup-state-machines.md.
The plan wins. Prereq: C1 accepted (its pilot review is the go signal for
C2; check the plan status).

Before code, complete per the plan: (a) the actor lifecycle matrix row
(already drafted — verify against reality: active mutation retained on
no-subscribers; reattach on reload; continue while app alive; finish or
explicit recovery on quit; reconcile repo state on restart; dispose after
safe settlement on entity deletion); (b) a serializability audit of
GithubOpsState/events (callbacks, handles, non-encodable values OUT — the
conflict-resolution runner registration is the known renderer-coupled
piece: decide its receipt/event replacement); (c) the safe remote
projection (no tokens/paths); (d) the deletion budget (renderer
controller/manager, its hand-written event queue, any remaining
compensating plumbing).

Migration shape mirrors C1: main actor on ActorHost consuming git
services directly (no renderer-IPC round trips from command adapters);
renderer consumes the remote read model through the existing
useGithubOps/projectGithubOps surface (Phase A kept it projection-free —
the hook's source swaps, capability selectors and consistency tests run
UNCHANGED); one command authority at every step; branch-inventory query
invalidations ride the B1 channel.

Tests: capability consistency + branch-inventory integration unchanged;
crash/reload; mid-rebase window close (work continues, recovery controls
render in any window); same-entity-two-windows; stale-revision sync
request; conflict-resolution flow end-to-end (the runner replacement is
the riskiest seam — deep-review focus there). Golden suite green.

/deep-review before push. Branch c2-github-ops; /pr-push; update plan
status + matrix.

Trailing deletion (part of this wave, per the plan's rolling Phase D):
land the wave's adapter/channel deletion as a SEPARATE PR immediately
behind the cutover (same day is fine — no bake, no soak; per the plan's
recorded corrections: no update window, no runtime toggle, stragglers
are compile-time-detectable, and dead-code deletion cannot regress
runtime once typecheck/CI pass). The separation exists ONLY to keep the
high-scrutiny cutover diff pure for review; a later cutover revert
simply reverts both PRs. The wave is not complete until it lands.
