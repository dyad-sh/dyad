# C2 — connection_flow / mcp_oauth common-contract exposure (conditional)

Implement the main-registries item of C2 in plans/cleanup-state-machines.md
— read its exact wording first: these two are ALREADY correctly
main-authoritative; they are NOT mechanical migrations, and documented
resource registries are an acceptable end state. The plan wins.

Scope, strictly conditional:

1. Expose connection_flow and mcp_oauth through the common remote
   reference/read-model contract ONLY where a renderer consumer needs it
   (audit first: what does the renderer actually read from each today,
   through which channels?). If existing hand-written IPC events are
   narrow and sufficient, record that as the documented deviation and
   STOP — do not build read models nobody consumes.
2. ActorHost adoption inside either registry only if it demonstrably
   deletes code or fixes a known deficiency (compare line counts and name
   the deficiency in the PR description — "consistency" is
   insufficient justification per the plan). The listener, timer, waiter,
   claim, and close-barrier internals stay intact regardless.
3. Whatever the outcome, update the plan's placement-table rows and the
   lifecycle matrix with the recorded decision (adopted / deviation
   documented), so the "remaining custom runtimes have narrow documented
   reasons" success criterion is auditable.

If both machines end as documented deviations with zero code change,
that is a VALID completion of this prompt — deliver the audit and the
plan updates as a docs PR.

Verify (if code changed): existing OAuth happy-path and flowId
correlation tests unchanged; golden suite green; /deep-review. Branch
c2-main-registries; /pr-push.
