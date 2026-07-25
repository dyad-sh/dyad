# A7 — Compatibility infrastructure removal

Implement A7 of plans/cleanup-state-machines.md ("A7 — after A2–A6 and
relevant C waves"). The plan wins. Gate: every allowlisted violation's
owner PR has landed — run the A1 boundary test and enumerate remaining
entries; each must map to a landed PR (stale entry = this PR removes it)
or a documented deliberate keep. If any entry's owner is unlanded, this
prompt is early — stop.

Scope:

1. Delete registerAtomWriter/projectToAtom from
   src/state_machines/projection.ts if no production caller remains; if
   an allowlisted cross-process projection still uses a variant, move a
   narrowed private copy beside it and delete the shared export.
2. Remove all temporary boundary-test allowlist entries; convert the
   documented deliberate keeps (plan_handoff navigation writes,
   first_prompt post-submit clears, isPreviewOpenAtom writes) into a
   permanent, commented allowlist section — each write site carries its
   one-line comment naming the plan.
3. Add the no-return test: retired lifecycle atom names (the plan's
   success-criteria list: isStreamingByIdAtom, previewRuntimeAtoms
   family, firstPromptSaga pair, store/appAtoms, the mailbox atoms)
   asserted absent from src/.
4. Update rules/state-machines.md and rules/jotai-state.md: projection
   rules become historical notes or deletions; the read-model,
   facade-intent, and per-window-Jotai rules become the documented
   convention. Update docs/why-state-machines.md's examples if they
   reference deleted atoms.
5. Sweep for dead exports/types orphaned by the retirements (knip or the
   repo's dead-code tooling if present).

Verify: typecheck, full tests, lint, boundary tests green with the
shrunk allowlist, golden suite green. Branch cleanup-a7-compat-removal;
/pr-push; update plan status.
