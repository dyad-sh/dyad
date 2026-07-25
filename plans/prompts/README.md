# Cleanup-plan prompt library

One file per PR/work-item for the remaining waves of
`plans/cleanup-state-machines.md`. Written 2026-07-24 against the state:
A1 done (#4090), A2 done (#4091), A3 in flight (#4092), G1a decided.

Usage: paste a prompt into a fresh session when its wave is reached.
Every prompt carries the same contract:

- `plans/cleanup-state-machines.md` is the plan-of-record; where a prompt
  and the current plan disagree, **the plan wins**. Prompts written this
  far ahead go stale — the executor re-derives detail from the plan, the
  appendix (`plans/claude-cleanup-machines.md`), and the code as landed.
- Check the plan's status lines and `git log` for what has landed before
  starting; update the status line for your PR.
- Behavior-preserving rules, intent-class tagging, allowlist-entry
  removal, and /deep-review-before-push apply to every code PR.

Full dependency graph with cross-phase edges and the critical path:
`DEPENDENCIES.md` (in this directory).

Wave order and gates:

| Wave | Items                                                              | Gate                                              |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------- |
| 1    | A4, A6a, G1 study                                                  | A2 landed (✓); G1a decided (✓); rebase over #4092 |
| 2    | A5; A6b                                                            | A5: A4 landed. A6b: G1 study accepted             |
| 3    | Golden suite; B0 ADR; B1 window infra                              | Golden suite BEFORE any B wiring                  |
| 4    | B2 kernel; B3 transport; B4 remote client; audit rewiring          | Sequential B2→B3→B4; separate revert points       |
| 5    | C1 app_run pilot                                                   | B4 done; B0 deletion list                         |
| 6    | C2: github_ops, version_preview, image_generation, main registries | C1 accepted                                       |
| 7    | C3 chat wave; C4 product surface                                   | C3: G1 design + C1 proven. C4: B1 + product       |
| 8    | A7 compat removal; Phase D deletion                                | All owners gone                                   |
