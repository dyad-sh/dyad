import type { AgentContext } from "./types";

/** Production builds `run_build` may count within one user turn. */
export const MAX_BUILD_RUNS_PER_TURN = 3;

/** Pre-commit hook runs `run_pre_commit` may make within one user turn. */
export const MAX_PRE_COMMIT_RUNS_PER_TURN = 3;

/** Batches `run_tests` may start per turn, including infrastructure failures. */
export const MAX_TEST_RUNS_PER_TURN = 10;

/**
 * Whether this turn has used up a per-turn tool budget. Automatic same-turn
 * follow-up passes cannot restore these budgets, so retrying blocked work
 * would only hit the limit again.
 */
export function hasExhaustedTurnToolBudget(
  ctx: Pick<
    AgentContext,
    "buildAttemptState" | "preCommitRunCount" | "testRunCount"
  >,
): boolean {
  return (
    (ctx.buildAttemptState?.count ?? 0) >= MAX_BUILD_RUNS_PER_TURN ||
    (ctx.preCommitRunCount ?? 0) >= MAX_PRE_COMMIT_RUNS_PER_TURN ||
    (ctx.testRunCount ?? 0) >= MAX_TEST_RUNS_PER_TURN
  );
}
