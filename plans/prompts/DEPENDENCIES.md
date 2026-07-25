# Dependency graph — cleanup-state-machines rollout

Companion to `plans/cleanup-state-machines.md` and this prompt library.
Statuses as of 2026-07-24: A1 done (#4090), A2 done (#4091), A3 in
flight (#4092), G1a decided. Update markers as PRs land (the plan's
status lines remain the source of truth; this file is the picture).

```text
        LEGEND   [x] merged   [~] in flight   ( ) pending   * gate/decision   = critical path

 PHASE A (ownership)                 DESIGN            PHASE B (window + actor infra)          PHASE C (host moves)              PHASE D
---------------------               --------          --------------------------------        ---------------------            ---------

 [x] A1 boundaries+bindings (#4090)
   |
   +------------+-----------------------------+
   v            v                             |
 [x] A2       [~] A3 stores (#4092)           |
 mirrors        |                             |
 (#4091)        | (rebase over)               |
   |            |                             |
   +------+-----+--+                          |
   v      |        v                          v
 ( ) A4 ==+=> ( ) A6a status        * G1a DECIDED (ok) --> (unblocks A6a)
 edges    |   kills #4077
   |      |        |                ( ) G1 chat study ---------------------------------+
   v      |        |                  (start now, no code)                             |
 ( ) A5 ==+        |                       |                                           |
 channels |        |                       v                                           |
   |      |        |                * G1 accepted? --> ( ) A6b chat storage ======+    |
   |      |        |                                        ^                     |    |
   |      |        +------------------------(A6a facade seam)---------------------+----+
   |      |                                                                       |    |
   |      +==(A4 preview_iframe facade seam)=====================+                |    |
   v                                                             |                |    |
 ( ) A7 compat removal <-----(after A2-A6 + relevant C waves)----+-----------+    |    |
                                                                 |           |    |    |
              ( ) GOLDEN SUITE ===+==> ( ) B1 window infra ======+==+        |    |    |
              (before ANY         |      registry/routing/       |  |        |    |    |
               B wiring)          |      coherence/harness       |  |        |    |    |
                                  |        |                     |  |        |    |    |
              ( ) B0 ADR ========-+--------+--> ( ) B2 kernel    |  |        |    |    |
              (matrix, intent,    |        |         |           |  |        |    |    |
               deletion lists)    |        +=====+   |           |  |        |    |    |
                                  |              v   v           |  |        |    |    |
                                  |        ( ) B3 transport      |  |        |    |    |
                                  |              |               |  |        |    |    |
                                  |              v               |  |        |    |    |
                                  |        ( ) B4 remote client  |  |        |    |    |
                                  |              |               |  |        |    |    |
                                  +==> ( ) AUDIT REWIRING <======+  |        |    |    |
                                         (parallel with B2-B4)      |        |    |    |
                                            | (pagehide item)       |        |    |    |
                                            v                       v        |    |    |
                                       ( ) C1 app_run pilot <=======+        |    |    |
                                            |                                |    |    |
                                            * C1 accepted?                   |    |    |
                                            +==> ( ) C2 github_ops           |    |    |
                                            |         |                      |    |    |
                                            |         v                      |    |    |
                                            |    ( ) C2 version_preview      |    |    |
                                            |         |                      |    |    |
                                            |         v                      |    |    |
                                            |    ( ) C2 image_generation     |    |    |
                                            |      (needs B0 ADR calls)      |    |    |
                                            +--> ( ) C2 main registries      |    |    |
                                            |      (conditional/docs-ok)     |    |    |
                                            |                                |    |    |
                                            +==> ( ) C3 chat wave <----------+----+----+
                                                      |   (3 gates: G1 go,   |
                                                      |    C1, A6b)          |
                                                      v                      |
                                                 ( ) C4 product surface      |
                                                      |                      |
                                                      v                      v
                                                 ( ) Phase D deletion <--- (A7, + soak)
```

## Critical path (double lines)

Golden suite / B0 -> B1 -> B3 -> B4 -> C1 -> C2 chain -> C3 -> C4 -> D.
Phase B is strictly serial in the middle (B1 -> B3 -> B4; B2 can start
alongside B1 since it only needs B0, but B3 needs both).

## Parallel-now set

After #4092 merges: A4, A6a, and the G1 study are three independent
tracks. The golden suite and B0 ADR are also startable immediately —
nothing in Phase A blocks them (golden must merely land before B1's
wiring; B0 is docs-only).

## Cross-phase edges easy to miss

- **A4 -> C1**: the app_run -> preview_iframe facade built in A4 is the
  seam C1 swaps to the remote read model; C1 assumes it exists.
- **A6a -> C3**: same pattern — the isIdle/watchIdle facade is what C3
  re-sources without touching callers.
- **Audit rewiring (pagehide item) -> C1**: the disposal/subscription
  split is a hard C1 prerequisite; the rest of that PR is merely
  parallel with B2–B4.
- **B0 -> C2 image_generation**: the ADR's app-quit and
  restart-persistence calls are binding inputs to that wave, made months
  earlier.
- **G1 study -> B0** (soft): the ADR's chat_stream lifecycle row and
  intent classes stay "study-pending" if B0 lands first; the B0 prompt
  handles it.
- **A7 sits late deliberately**: it cannot close until every boundary
  allowlist entry's owner has landed — including A6b and possibly
  C-wave deletions.

## Bottleneck note

G1 acceptance gates only A6b and C3. If the study drags, all of Phase B
and C1/C2 proceed unaffected — chat work is the only queue behind it.
That isolation is by design: the hardest decision blocks the least.
