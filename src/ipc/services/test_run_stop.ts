import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { TestRunInfraError } from "@/ipc/types/tests";
import { getCancellationInfo } from "@/shared/cancellation_reason";
import {
  describeTestRunStop,
  type TestRunStopReason,
} from "@/shared/test_run_stop";

/**
 * The structured result for a stopped run. Every stop site uses this so the
 * panel, the chat queue card, and the agent all see the cause the queue
 * recorded instead of a bare "Test run stopped.".
 */
export function testRunStopInfraError(
  stopReason: TestRunStopReason | undefined,
  options: { beforeExecution?: boolean } = {},
): TestRunInfraError {
  return {
    message: describeTestRunStop(stopReason, options),
    ...(stopReason && { stopReason }),
  };
}

/** {@link testRunStopInfraError} for a run whose signal aborted. */
export function testRunStoppedInfraError(
  signal: AbortSignal | undefined,
): TestRunInfraError {
  return testRunStopInfraError(getCancellationInfo(signal?.reason));
}

/** Thrown by setup steps that observe the abort before a result exists. */
export function testRunStoppedError(
  signal: AbortSignal | undefined,
): DyadError {
  return new DyadError(
    describeTestRunStop(getCancellationInfo(signal?.reason)),
    DyadErrorKind.UserCancelled,
  );
}
