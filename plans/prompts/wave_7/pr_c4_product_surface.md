# C4 — Multi-window product surface

Implement C4 of plans/cleanup-state-machines.md. The plan wins. Prereqs:
B1 (registry/harness), the audit-rewiring PR, and enough C waves that the
entities users will open in second windows are main-hosted (minimum: C1;
ideally C3 for chats). This is product work enabled by the architecture;
coordinate scope with product before building.

Scope per the plan's C4 section and recorded decisions 3–5:

1. Window creation + explicit "Open in New Window"/duplication (decision
   4: new tab instance over the same entity; independent presentation
   state).
2. Tab drag/transfer between windows: acknowledged adopt-then-remove —
   capture transferable presentation state (scroll anchor/position,
   selected file + cursor, preview history, open panels/modes, draft
   input, relevant selections), adopt in the destination, remove the
   source only on acknowledgement; adoption failure leaves the source
   intact. DOM-only resources (iframe, Monaco, terminal) recreate to
   equivalent visible state.
3. Per-window session restore: the chatTabSessionStorage schema migration
   to WindowSessionId + TabInstanceId (migrate-don't-replace; old key
   readable for a release; characterization test on a real captured
   blob — the golden suite has one).
4. Focus routing: presentation router goes live for the flows it hasn't
   already (notification click targets the window showing the chat or
   opens one — closing the audit's notification item). The N=1 identity
   rule stays permanently.
5. Platform lifecycle: last-window-close per decision 3 (macOS persists,
   Windows/Linux quits), wired to the actor lifecycle policies from the
   matrix.

Tests: B1 harness scenarios promoted to product paths; packaged
two-window E2E (open second window, drag a tab, close initiating window
mid-work, restore a two-window session); golden suite green (single
window unchanged). /deep-review on the tab-transfer protocol. Branch
prefix c4-\*; update plan status.
