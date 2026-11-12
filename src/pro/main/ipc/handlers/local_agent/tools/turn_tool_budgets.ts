import type { AgentContext } from "./types";

/** Production builds `run_build` may count within one user turn. */
export const MAX_BUILD_RUNS_PER_TURN = 10;

/** Pre-commit hook runs `run_pre_commit` may make within one user turn. */
export const MAX_PRE_COMMIT_RUNS_PER_TURN = 3;

/** Batches `run_tests` may start per turn, including infrastructure failures. */
export const MAX_TEST_RUNS_PER_TURN = 10;

/** Fix attempts allowed per spec per turn before `run_tests` refuses to rerun it. */
export const MAX_TEST_ATTEMPTS_PER_SPEC = 4;

/**
 * Whether this turn has used up a per-turn tool budget. Automatic same-turn
 * follow-up passes cannot restore these budgets, so retrying blocked work
 * would only hit the limit again.
 */
export function hasExhaustedTurnToolBudget(
  ctx: Pick<
    AgentContext,
    | "buildAttemptState"
    | "preCommitRunCount"
    | "testRunCount"
    | "testRunAttempts"
  >,
): boolean {
  if (
    (ctx.buildAttemptState?.count ?? 0) >= MAX_BUILD_RUNS_PER_TURN ||
    (ctx.preCommitRunCount ?? 0) >= MAX_PRE_COMMIT_RUNS_PER_TURN ||
    (ctx.testRunCount ?? 0) >= MAX_TEST_RUNS_PER_TURN
  ) {
    return true;
  }
  for (const state of ctx.testRunAttempts?.values() ?? []) {
    if (state.attempts >= MAX_TEST_ATTEMPTS_PER_SPEC) return true;
  }
  return false;
}
