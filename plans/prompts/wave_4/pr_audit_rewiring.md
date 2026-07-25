# Single-window audit rewiring (golden-suite-guarded)

Implement the [Phase B] items of the "Single-window assumptions audit" in
plans/cleanup-state-machines.md that reroute EXISTING production paths
through B1 infrastructure. The plan wins over this prompt. Prereqs: B1
landed, golden suite landed (it is the regression gate for every item
here). Can run in parallel with B2–B4 (different surfaces).

Scope — one commit per item, each running the golden suite:

1. pagehide/disposal split: useManagerPagehideDisposal separates
   window-local machine disposal from subscription release. Main-hosted
   state is never disposed by a window's pagehide. Run the disposal
   conformance suite on every touched manager; golden teardown-order
   baselines must hold. (This item is also a C1 prerequisite.)
2. EntityDisposalRegistry scope: entity deletion disposes window-local
   controllers in ALL windows (broadcast via the B1 channel) and any main
   actor once. Two-window harness test: delete an app from window A while
   window B shows it.
3. event.sender audit: enumerate every sender-targeted emission; convert
   reads/status to broadcast where multi-window-correct; responses remain
   claimed by requestId. List every site and its disposition in the PR
   description.
4. React Query invalidation conversion: route the inventoried mutation
   paths through the B1 channel (origin-local calls KEPT, broadcast
   additive, epoch-deduped) — the golden refetch-count baselines catch
   double-invalidation; include the setQueryData inventory and its
   carve-out decisions.
5. High-volume channel conversion: app output/chat chunks/terminal to
   keyed interest fan-out; golden console first-line baseline must hold.
6. Trusted-main-frame verification: confirm per-window enforcement;
   test in the two-window harness.

Constraints: no behavior change beyond delivery mechanics — golden suite
diffs are the definition of regression; any intentional delta is
enumerated. Presentation-router conversion of toasts/notifications is
NOT in scope (it lands with C waves per flow, under the N=1 identity
rule).

Verify: typecheck, full tests, lint, golden suite green per commit,
two-window harness scenarios. /deep-review. Branch
cleanup-audit-rewiring; /pr-push; update the audit checklist items in
the plan with this PR number.
