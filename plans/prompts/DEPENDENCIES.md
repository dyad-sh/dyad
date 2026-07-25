# Dependency graph and rebatched schedule — cleanup-state-machines rollout

Companion to `plans/cleanup-state-machines.md`. Statuses as of 2026-07-25:
A1 #4090, A2 #4091, A3 #4092, A4 #4093, A6b-safe-subset #4094 merged;
A6a in flight (#4095); G1a decided; G1 study written
(`plans/g1-chat-stream-study.md` — mark accepted in the plan to open the
C3 gate; remainder of A6b folded into C3 per its verdict). The plan's
status lines are the source of truth; this file is the picture.

## Two standing rules

1. **One-cutover rule.** Prep work (design, codecs, service extraction,
   read models, stores) parallelizes freely. At most ONE authority
   cutover is in flight at any time — cutovers are the only step where
   "which process owns X" can be ambiguous, and bisection must stay
   clean.
2. **Rolling deletion.** Every cutover wave lands its adapter deletion
   as a separate PR immediately behind the cutover (same day is fine —
   no bake, no soak; see the plan's Phase D corrections). The separation
   is for review clarity only: the cutover diff stays pure. A later
   cutover revert simply reverts both PRs.

## Rebatched schedule

| Batch   | Parallel items                                                                                                                                            | Waits on                               |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1 (now) | A5 · golden suite · B0 ADR · **C1.1 main app-runtime service extraction** · C2 main-registries audit (docs) · finish A6a                                  | nothing                                |
| 2       | B1 ∥ B2 · C1.2 (app_run codecs + safe projection design)                                                                                                  | golden+B0 → B1; B0 → B2, C1.2          |
| 3       | B3 (core against fake transport; B1-harness scenarios land last) ∥ audit-rewiring (pagehide item first — C1 prereq)                                       | B2 → B3; B1+golden → rewiring          |
| 4       | B4 (may begin against B3's envelope types during B3's tail)                                                                                               | B3                                     |
| 5       | **C1.3 app_run cutover** (the wave's only cutover slot)                                                                                                   | B4 + pagehide + C1.1/C1.2              |
| 6       | C2-github_ops (next cutover slot) ∥ C3 design→implementation prep ∥ C4a (window creation/session-restore/app surface)                                     | C1 accepted; C3 also needs G1 accepted |
| 7       | C2-version_preview ∥ C2-image_generation ∥ **C2 registry boundary hardening** — preps parallel, cutovers staggered through the single slot ∥ C3 continued | github_ops pattern set                 |
| 8       | C3 cutover → C4b (chat tab drag/transfer)                                                                                                                 | C3 gates (G1-go · C1 · A6b-subset ✓)   |
| rolling | each wave's deletion PR, immediately behind its cutover                                                                                                   | per wave                               |
| final   | A7 → Phase D remainder (docs, boundaries, leftovers)                                                                                                      | all allowlist owners landed            |

Key changes vs the original wave table: C1 is split (its longest step has
no transport dependency and starts NOW); B2 runs beside B1; B3/B4 overlap
tails; C2 fans out after github_ops instead of chaining; **C3 runs
parallel with C2** (they never depended on each other — only cutovers
serialize); C4 splits into a (after C1) and b (after C3).

## Graph

```text
 LEGEND  [x] merged  [~] in flight  ( ) pending  * gate  = critical path

 [x] A1 -> [x] A2 -> [x] A3    [x] A4    [x] A6b-subset    [~] A6a    [x] G1a    G1 study written -> * accept -> gates C3
 ( ) A5 (independent)          ( ) A7 (after all allowlist owners land)

 ( ) GOLDEN ==+==> ( ) B1 =========+============================+
 ( ) B0 ======+      |             | (harness-only scenarios)   |
      |              v             v                            |
      +=======> ( ) B2 =====> ( ) B3 =====> ( ) B4 =============+==> ( ) C1.3 cutover ==> * C1 accepted
      |          (beside B1)  (core on      (overlaps                     ^                     |
      |                       fake          B3 tail)                      |                     |
      |                       transport)                    C1.1 (START NOW) + C1.2 (<- B0)     |
      +--> ( ) audit-rewiring (<- B1+golden; pagehide item is a C1 prereq)                      |
                                                                                                v
   after C1 accepted, parallel:   C2-gh cutover --> preps: C2-vp || C2-ig || C2-registries      |
                                  (later cutovers staggered through the single cutover slot)    |
                                  C3 design/impl (needs * G1 accepted) ... C3 cutover <---------+
                                  C4a (app-window surface) ............... C4b (after C3)

   rolling: each cutover -> immediate trailing deletion PR (same day; no soak)
   final:   A7 -> D remainder (docs, boundary hardening, leftovers)
```

## Cross-phase edges easy to miss

- **A4 -> C1**: the app_run -> preview_iframe facade is the seam C1.3
  swaps to the remote read model.
- **A6a -> C3**: the isIdle/watchIdle facade is what C3 re-sources
  without touching callers.
- **Audit rewiring (pagehide) -> C1.3**: hard prerequisite; the rest of
  that PR is merely parallel.
- **B0 -> C1.2 and C2-image_generation**: intent classes feed the codecs;
  the ADR's app-quit/restart-persistence calls bind the image_generation
  wave.
- **G1 acceptance -> C3 only**: if it stalls, everything else proceeds;
  chat work is the only queue behind it.
- **A7 sits late**: it closes only when every boundary-allowlist entry's
  owner has landed, including C-wave deletions.

## Critical path

GOLDEN/B0 -> B1 -> B3(harness tail) -> B4 -> C1.3 -> C2-gh cutover ->
C3 cutover -> C4b -> final D. Everything else hangs off it in parallel;
the cutover slot is the scarce resource, not the code.
