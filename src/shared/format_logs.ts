import type { ConsoleEntry } from "@/ipc/types";

function truncateMessage(message: string, maxLength: number = 1000): string {
  if (message.length <= maxLength) {
    return message;
  }

  // Check if it's a stack trace (lines starting with "    at " indicate stack frames)
  const lines = message.split("\n");
  const hasStackTrace = lines.some((line) => line.startsWith("    at "));

  if (hasStackTrace) {
    const errorMessage = lines[0];
    const stackFrames = lines
      .filter((line) => line.startsWith("    at "))
      .slice(0, 5);

    return (
      errorMessage +
      "\n" +
      stackFrames.join("\n") +
      "\n... [stack trace truncated]"
    );
  }

  // Regular truncation - preserve start and end
  const halfLength = Math.floor((maxLength - 20) / 2);
  return (
    message.slice(0, halfLength) +
    "\n... [truncated] ...\n" +
    message.slice(-halfLength)
  );
}

export function formatLogsForAI(
  logs: ConsoleEntry[],
  matchingLogCount: number = logs.length,
): string {
  const summary = `Found ${matchingLogCount} log${matchingLogCount === 1 ? "" : "s"}:\n\n`;

  const formatted = logs
    .map((log) => {
      const timestamp = new Date(log.timestamp).toISOString();
      if (log.runtimeBoundary) {
        const action = {
          start: "App start initiated",
          restart: "App restart started",
          rebuild: "App rebuild started",
        }[log.runtimeBoundary];
        return `--- [${timestamp}] ${action} ---`;
      }
      const level = log.level.toUpperCase();
      const type = log.type;
      const source = log.sourceName ? ` [${log.sourceName}]` : "";
      const message = truncateMessage(log.message);

      return `[${timestamp}] [${level}] [${type}]${source} ${message}`;
    })
    .join("\n");

  return summary + formatted;
}
