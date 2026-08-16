import { type SystemDebugInfo } from "@/ipc/types";
import { type UserBudgetInfo } from "@/ipc/types/system";
import { type ModelSelection, type UserSettings } from "@/lib/schemas";
import { formatUpdaterLogsForIssueBody } from "@/lib/debugLogFormatting";

/**
 * What happened when we offered to take a screenshot. Recorded in the issue
 * body so a maintainer can tell an issue with no image from a reporter who
 * declined, and so the two cases can be counted separately after the fact.
 */
export type ScreenshotStatus = "captured" | "declined" | "capture-failed";

export interface ScreenshotOutcome {
  status: ScreenshotStatus;
  /** Failure message from takeScreenshot, only set for "capture-failed". */
  reason?: string;
}

/** Stable prefix so published issues can be counted with a GitHub search. */
const SCREENSHOT_STATUS_PREFIX = "Screenshot status:";

export function formatScreenshotStatusLine(outcome: ScreenshotOutcome): string {
  switch (outcome.status) {
    case "captured":
      return `${SCREENSHOT_STATUS_PREFIX} captured (reporter captured a screenshot in Dyad; if none appears above, ask them to paste it)`;
    case "declined":
      return `${SCREENSHOT_STATUS_PREFIX} declined`;
    case "capture-failed":
      return outcome.reason
        ? `${SCREENSHOT_STATUS_PREFIX} capture-failed (${outcome.reason})`
        : `${SCREENSHOT_STATUS_PREFIX} capture-failed`;
  }
}

export function formatSettingsLines(
  settings: UserSettings | null,
  selectedModel: ModelSelection | null,
): string {
  if (!settings) return "Settings not available";
  const model = selectedModel ?? settings.selectedModel;
  return [
    `- Selected Model: ${model.provider}:${model.name}`,
    `- Chat Mode: ${settings.selectedChatMode ?? "default"}`,
    `- Auto Approve Changes: ${settings.autoApproveChanges ?? "n/a"}`,
    `- Dyad Pro Enabled: ${settings.enableDyadPro ?? "n/a"}`,
    `- Effort Level: ${selectedModel?.effortLevel ?? "medium"}`,
    `- Runtime Mode: ${settings.runtimeMode2 ?? "n/a"}`,
    `- Release Channel: ${settings.releaseChannel ?? "n/a"}`,
  ].join("\n");
}

export function formatSystemInfoSection(
  debugInfo: SystemDebugInfo,
  userBudget: UserBudgetInfo | undefined,
): string {
  return `## System Information
- Dyad Version: ${debugInfo.dyadVersion}
- Platform: ${debugInfo.platform}
- Architecture: ${debugInfo.architecture}
- Node Version: ${debugInfo.nodeVersion || "n/a"}
- PNPM Version: ${debugInfo.pnpmVersion || "n/a"}
- Node Path: ${debugInfo.nodePath || "n/a"}
- Pro User ID: ${userBudget?.redactedUserId || "n/a"}
- Telemetry ID: ${debugInfo.telemetryId || "n/a"}
- Model: ${debugInfo.selectedLanguageModel || "n/a"}`;
}

export function formatLogsSection(debugInfo: SystemDebugInfo): string {
  // Keep the updater section small: the issue body travels in the GitHub URL.
  const updaterSection = debugInfo.updaterLogs
    ? `

## Auto-Updater Logs
\`\`\`
${formatUpdaterLogsForIssueBody(debugInfo.updaterLogs)}
\`\`\``
    : "";
  return `## Logs
\`\`\`
${debugInfo.logs.slice(-3_500) || "No logs available"}
\`\`\`${updaterSection}`;
}

interface CommonBodyParams {
  debugInfo: SystemDebugInfo;
  settings: UserSettings | null;
  /** Effort-aware model for this chat, falling back to the global setting. */
  selectedModel: ModelSelection | null;
  userBudget: UserBudgetInfo | undefined;
  screenshot: ScreenshotOutcome;
}

export function buildBugReportBody({
  debugInfo,
  settings,
  selectedModel,
  userBudget,
  screenshot,
}: CommonBodyParams): string {
  return `\
<!-- Please fill in all fields in English -->

## Bug Description (required)
<!-- Please describe the issue you're experiencing and how to reproduce it -->

## Screenshot (recommended)
<!-- Screenshot of the bug -->
${formatScreenshotStatusLine(screenshot)}

${formatSystemInfoSection(debugInfo, userBudget)}

## Settings
${formatSettingsLines(settings, selectedModel)}

${formatLogsSection(debugInfo)}
`;
}

export function buildSessionReportBody({
  debugInfo,
  settings,
  selectedModel,
  userBudget,
  screenshot,
  sessionId,
}: CommonBodyParams & { sessionId: string }): string {
  return `\
<!-- Please fill in all fields in English -->

Session ID: ${sessionId}
Session Schema: v2.0
Pro User ID: ${userBudget?.redactedUserId || "n/a"}

## Issue Description (required)
<!-- Please describe the issue you're experiencing -->

## Expected Behavior (required)
<!-- What did you expect to happen? -->

## Actual Behavior (required)
<!-- What actually happened? -->

## Screenshot (recommended)
<!-- Screenshot of the issue -->
${formatScreenshotStatusLine(screenshot)}

${formatSystemInfoSection(debugInfo, userBudget)}

## Settings
${formatSettingsLines(settings, selectedModel)}

${formatLogsSection(debugInfo)}
`;
}

/** Used when getSystemDebugInfo fails, so the session ID still reaches GitHub. */
export function buildSessionReportFallbackBody({
  userBudget,
  screenshot,
  sessionId,
}: {
  userBudget: UserBudgetInfo | undefined;
  screenshot: ScreenshotOutcome;
  sessionId: string;
}): string {
  return `Session ID: ${sessionId}
Session Schema: v2.0
Pro User ID: ${userBudget?.redactedUserId || "n/a"}
${formatScreenshotStatusLine(screenshot)}`;
}
