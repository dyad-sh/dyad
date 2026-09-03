import type { SubagentActivity, SubagentThreadSummary } from "@/ipc/types";
import { safeGithubOpsErrorMessage } from "@/ipc/services/github_ops_safe_error";

const MAX_FAILURE_DETAIL_CHARS = 1_200;
const MAX_TASK_NAME_CHARS = 200;
export const MAX_IMPLEMENTER_FAILURE_REPORT_CHARS = 4_000;
const HIDDEN_FAILURE_DETAIL = "Failure details were hidden for privacy.";

export type ImplementerJoinSummary = SubagentThreadSummary & {
  latestActivity: SubagentActivity | null;
};

export interface ProjectedFailureText {
  displayText: string;
}

/**
 * Stored sub-agent errors can contain arbitrary provider or tool output. Reuse
 * the main-process diagnostic sanitizer before crossing into chat/UI text.
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

  return { displayText };
}

export function projectSubagentThreadErrorForRenderer(
  status: SubagentThreadSummary["status"],
  error: string | null,
): string | null {
  if (status !== "failed" && status !== "entitlement_revoked") return error;
  return projectSubagentFailureText(error)?.displayText ?? null;
}

export function buildImplementerFailureReport(
  threads: ImplementerJoinSummary[],
): {
  displayMessage: string;
  telemetryProperties: Record<string, number> | null;
} {
  const displayLines = threads.map((thread) => {
    const taskName = boundDisplayText(
      thread.taskName.replaceAll(/\s+/g, " "),
      MAX_TASK_NAME_CHARS,
    );
    const threadError = projectSubagentFailureText(thread.error);
    const activityError = projectSubagentFailureText(
      thread.latestActivity?.error,
    );
    const details: string[] = [];

    if (threadError) details.push(threadError.displayText);
    if (
      thread.latestActivity &&
      ["error", "aborted"].includes(thread.latestActivity.status)
    ) {
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

    return `- ${taskName || "Implementer task"} (${thread.status}): ${details.join(" ")}`;
  });

  const failedThreads = threads.filter((thread) => thread.status === "failed");
  const displayMessage = boundDisplayText(
    `Implementer sub-agent did not complete successfully:\n${displayLines.join("\n")}`,
    MAX_IMPLEMENTER_FAILURE_REPORT_CHARS,
  );

  return {
    displayMessage,
    telemetryProperties:
      failedThreads.length === 0
        ? null
        : {
            failed_implementer_count: failedThreads.length,
            with_stored_thread_error_count: failedThreads.filter((thread) =>
              Boolean(thread.error),
            ).length,
            with_latest_activity_count: failedThreads.filter((thread) =>
              Boolean(thread.latestActivity),
            ).length,
            with_latest_activity_error_count: failedThreads.filter((thread) =>
              Boolean(thread.latestActivity?.error),
            ).length,
          },
  };
}

function boundDisplayText(value: string, maxChars: number): string {
  const normalized = value
    .replaceAll(/\r\n?/g, "\n")
    .replaceAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim();
  const notice = "… [truncated]";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - notice.length))}${notice}`;
}
