import type {
  CancellationCause,
  CancellationInfo,
} from "./cancellation_reason";

/** Why a test run stopped; absent when the canceller recorded no cause. */
export type TestRunStopReason = CancellationInfo;

const STOP_CAUSES: Record<CancellationCause, string> = {
  "tests-panel-stop": "from the Tests panel",
  "chat-stop": "because the chat response that started it was stopped",
  "chat-deleted": "because the chat that started it was deleted",
  "version-restored": "because an earlier version of the app was restored",
  "subagent-stopped": "because the sub-agent that started it was stopped",
  "pro-revoked":
    "because Dyad Pro is no longer active, which stopped the sub-agent that started it",
  "claude-code-call-abandoned":
    "because Claude Code stopped waiting for the run_tests call",
  "claude-code-session-ended":
    "because the Claude Code session ended before the tests finished",
  "agent-cancelled": "because the agent turn that started it was cancelled",
  "app-deleted": "because the app is being deleted",
  "app-quit": "because Dyad is quitting",
};

/**
 * The user- and agent-facing sentence for a stopped run. Without a recorded
 * cause it keeps the historical wording.
 */
export function describeTestRunStop(
  reason: TestRunStopReason | undefined,
  options: { beforeExecution?: boolean } = {},
): string {
  const prefix = options.beforeExecution
    ? "Test run stopped before execution"
    : "Test run stopped";
  if (!reason) return `${prefix}.`;
  const detail = reason.detail ? `: ${reason.detail}` : "";
  return `${prefix} ${STOP_CAUSES[reason.kind]}${detail}.`;
}
