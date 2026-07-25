# C2 — connection_flow / mcp_oauth boundary hardening

Implement the main-registries item of C2 in plans/cleanup-state-machines.md
— read its exact wording first: these two are ALREADY correctly
main-authoritative; they are NOT mechanical migrations, and documented
resource registries are an acceptable end state. The plan wins.

The audit is complete in the B0 ADR and the cleanup plan. It found that the
specialized registries remain the correct resource owners and must not be
mechanically replaced by ActorHost, but the current renderer boundaries are
not sufficient for the recorded multi-window contract. This implementation
wave therefore may not stop at a docs-only deviation.

Scope:

1. Keep `connection_flow`'s narrow lifecycle projection, but make remote
   admission multi-window-safe: revision-check `start`/`acknowledge`, require
   the exact typed `ConnectionFlowInvocationRef` for cancel, and replace the
   historical string `flowId` across every correlation boundary. Mint refs
   through the shared `IdSource`; use `InvocationRegistry` claims, including a
   documented structural claim for deep-link sources that cannot echo the ref.
   Replace the renderer
   `resources-loaded` barrier with a post-persistence provider-status
   invalidation consumed independently by every window.
2. Keep `mcp_oauth`'s internal lifecycle private. Preserve last-request-wins
   Connect with a renderer message ID for retry dedupe, distinct from the typed
   `McpOAuthInvocationRef` used across listener/waiter/timer/callback/exchange
   and settlement boundaries. After persisted settlement publish MCP
   server/tool scopes through the global epoch-keyed query-invalidation
   channel.
3. Add server-scoped OAuth cancellation/settlement and stale-write fencing.
   Deletion, disconnect, OAuth disable, and OAuth-relevant configuration
   changes must revoke the old flow's write authority before mutating the row.
4. Add explicit application-shutdown disposal for connection-flow watchdogs
   and provider work and wire the existing MCP registry disposer to the real
   shutdown boundary.
5. ActorHost adoption inside either registry only if it demonstrably
   deletes code or fixes a known deficiency (compare line counts and name
   the deficiency in the PR description — "consistency" is
   insufficient justification per the plan). The listener, timer, waiter,
   claim, and close-barrier internals stay intact regardless.

Verify: stale two-window cancellation; reload before OAuth settlement;
settlement invalidation gap recovery; delete/disable/disconnect/config-change
during callback wait and exchange; stale provider writes rejected; explicit
shutdown during pending setup; typed-ref stale/claim tests, including the
structural deep-link claim; existing OAuth happy paths unchanged; golden suite
green; /deep-review. Branch
c2-main-registries-hardening; /pr-push.
