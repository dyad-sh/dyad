# C3 — Chat-stream and plan-handoff execution

Implement C3 of plans/cleanup-state-machines.md. HARD GATES — verify all
three before starting: (1) plans/g1-chat-stream-study.md accepted with a
GO for the host move (if the study said no-go, this prompt is void — the
plan's C3 section says what happens instead); (2) C1 accepted (remote
hydration + multi-window dispatch proven); (3) A6b landed (or the study
folded A6b's items into this wave — check the plan status).

The study is the design of record; this prompt only carries the plan's
invariants:

- Existing batched chunk channels are PRESERVED — snapshots carry
  lifecycle, not stream bytes (converted to keyed interest fan-out by the
  audit-rewiring PR; verify that landed).
- This wave owns, as ONE reviewed protocol: durable acceptance
  (supersedes/absorbs the memory-only follow-up handoff and its
  structural-safety argument — the argument's documented upgrade trigger
  fires here if the study says so), editable queue semantics,
  notification routing (per decision 5 + the audit's notification item),
  window reload and window-close behavior for active streams.
- One command authority at every step; renderer optimistic state per the
  study's optimistic-vs-accepted design; callbacks become
  receipts/read-models per the study.
- plan_handoff rides the study's placement decision; the A6a facade's
  source swaps (callers unchanged — that was the point).

Deletion budget from the study is binding. Acceptance: the study's
migration sequence scenarios plus same-chat-two-windows,
close-initiating-window-mid-stream (continues per decision 2), reload
during active stream, notification targeting, queue edit from a second
window. Full streaming E2E suite + packaged two-window Electron tests.
Security review for the remote definition (B3 checklist). This is the
highest-blast-radius wave in the entire plan: /deep-review on every PR,
and land in the smallest reviewable steps the study's sequence allows.

Branch prefix c3-chat-\*; update plan status + matrix rows as reality
diverges; the study document gets a postmortem section noting where
implementation contradicted the design.

Trailing deletion (part of this wave, per the plan's rolling Phase D):
land the wave's adapter/channel deletion as a SEPARATE PR immediately
behind the cutover (same day is fine — no bake, no soak; per the plan's
recorded corrections: no update window, no runtime toggle, stragglers
are compile-time-detectable, and dead-code deletion cannot regress
runtime once typecheck/CI pass). The separation exists ONLY to keep the
high-scrutiny cutover diff pure for review; a later cutover revert
simply reverts both PRs. The wave is not complete until it lands.

Rebatch note (see DEPENDENCIES.md): C3 does NOT wait for C2 — design and
implementation prep start once C1 is accepted (and G1 is marked accepted),
parallel with C2 waves; only the C3 cutover staggers through the single
cutover slot.
