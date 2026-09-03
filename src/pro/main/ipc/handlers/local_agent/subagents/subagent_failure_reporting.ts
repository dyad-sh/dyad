import type { SubagentActivity, SubagentThreadSummary } from "@/ipc/types";
import { safeGithubOpsErrorMessage } from "@/ipc/services/github_ops_safe_error";

const MAX_FAILURE_DETAIL_CHARS = 1_200;
const HIDDEN_FAILURE_DETAIL = "Failure details were hidden for privacy.";

export type ImplementerJoinSummary = SubagentThreadSummary & {
  latestActivity: SubagentActivity | null;
};

export interface ProjectedFailureText {
  displayText: string;
  telemetrySafe: boolean;
}

/**
 * Stored sub-agent errors can contain arbitrary provider or tool output. Reuse
 * the main-process diagnostic sanitizer before crossing into chat/UI text, and
 * only mark unchanged, bounded text as eligible for PostHog.
 */
export function projectSubagentFailureText(
  value: string | null | undefined,
): ProjectedFailureText | null {
  const normalized = value
    ?.replaceAll(/\r\n?/g, "\n")
    .replaceAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim();
  if (!normalized) return null;

  const sanitized = safeGithubOpsErrorMessage(
    new Error(normalized),
    HIDDEN_FAILURE_DETAIL,
  );
  const displayText =
    sanitized.length <= MAX_FAILURE_DETAIL_CHARS
      ? sanitized
      : `${sanitized.slice(0, MAX_FAILURE_DETAIL_CHARS - 14)}… [truncated]`;

  return {
    displayText,
    telemetrySafe:
      normalized.length <= MAX_FAILURE_DETAIL_CHARS && sanitized === normalized,
  };
}

export function buildImplementerFailureReport(
  threads: ImplementerJoinSummary[],
): { displayMessage: string; telemetryMessage: string | null } {
  let telemetrySafe = true;
  const displayLines = threads.map((thread) => {
    const taskName = projectSubagentFailureText(thread.taskName);
    const threadError = projectSubagentFailureText(thread.error);
    const activityError = projectSubagentFailureText(
      thread.latestActivity?.error,
    );
    const details: string[] = [];

    if (threadError) details.push(threadError.displayText);
    if (thread.latestActivity) {
      let latest = `Latest action: ${thread.latestActivity.toolName} (${thread.latestActivity.status})`;
      if (
        activityError &&
        activityError.displayText !== threadError?.displayText
      ) {
        latest += `: ${activityError.displayText}`;
      }
      details.push(latest);
    }
    if (details.length === 0) {
      details.push("No additional failure details were recorded.");
    }

    telemetrySafe &&=
      (!threadError || threadError.telemetrySafe) &&
      (!activityError || activityError.telemetrySafe);
    return `- ${taskName?.displayText ?? "Implementer task"} (${thread.status}): ${details.join(" ")}`;
  });

  const telemetryLines = threads.map((thread) => {
    const threadError = projectSubagentFailureText(thread.error);
    const activityError = projectSubagentFailureText(
      thread.latestActivity?.error,
    );
    const details = [
      threadError?.displayText,
      thread.latestActivity
        ? `latest action ${thread.latestActivity.toolName} (${thread.latestActivity.status})${activityError && activityError.displayText !== threadError?.displayText ? `: ${activityError.displayText}` : ""}`
        : null,
    ].filter((value): value is string => Boolean(value));
    return `- status ${thread.status}: ${details.join(" ") || "no stored failure detail"}`;
  });

  return {
    displayMessage: `Implementer sub-agent did not complete successfully:\n${displayLines.join("\n")}`,
    telemetryMessage: telemetrySafe
      ? `Implementer sub-agent failure:\n${telemetryLines.join("\n")}`
      : null,
  };
}
