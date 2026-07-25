# B0 — ADR, recorded decisions, deletion budgets (docs only)

Implement B0 of plans/cleanup-state-machines.md ("Phase B — B0"). The
plan wins over this prompt. Docs-only PR; no production code.

Deliverable: docs/adr/main-owned-state-machines.md (or the repo's ADR
convention) containing:

1. The five recorded product decisions copied verbatim from the plan's
   "Recorded product decisions" section, plus their two mandatory
   implementation consequences.
2. The architecture rules: one authoritative host per actor;
   commit-versus-completion; no multi-primary replication; location
   explicit (send vs dispatch+receipt); security model summary (static
   manifest, event codecs as allowlist, per-definition authorization,
   commands never cross from renderer, projections exclude main-only
   data).
3. The completed actor lifecycle matrix from the plan — RESOLVING the
   named open cells: image_generation app-quit policy and app-restart
   persistence decision (the plan says these do not survive B0 as TBD;
   make the calls, with one-line rationale each; if a call genuinely
   needs product input, get it before merging — do not write TBD).
4. The app_run pilot deletion list (from the plan's C1 section, expanded
   to concrete files/modules as they exist at time of writing).
5. The remote intent classification: for every event on the machines in
   the placement table's main rows, its intent class per the Remote
   intent policy (idempotent / state-sensitive / cancellation / durable
   handoff / presentation-only). Machines not yet designed for remote
   (chat_stream pre-G1) classify their current event unions
   provisionally, marked as such.
6. Why an actor runtime over incremental controller cleanup — one
   paragraph citing the multi-window forcing function; link the plan.

Cross-check against plans/g1-chat-stream-study.md if it exists (the
chat_stream lifecycle row and intent classes should agree; if the study
is not yet accepted, mark that row as study-pending).

Verify: internal consistency with the plan (no contradictions — fix the
plan in the same PR if drift is found and note it); lint/format for docs.
Branch cleanup-b0-adr; /pr-push; update plan status.
