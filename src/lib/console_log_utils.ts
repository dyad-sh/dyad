/**
 * Utility functions for console log management
 * This module provides shared utilities for propagating logs to both the central store and React state
 */

import { IpcClient } from "@/ipc/ipc_client";
import type { ConsoleEntry } from "@/ipc/ipc_types";

/**
 * Propagate a log entry to both the central log store and React state
 * @param logEntry The log entry to propagate
 * @param setConsoleEntries React state setter for console entries
 */
export function propagateLog(
  logEntry: ConsoleEntry,
  setConsoleEntries: (
    updater: (prev: ConsoleEntry[]) => ConsoleEntry[],
  ) => void,
): void {
  // Send to central log store (for read_logs tool)
  IpcClient.getInstance().addLog(logEntry);

  // Update React state (for UI)
  setConsoleEntries((prev) => [...prev, logEntry]);
}

/**
 * Create a log entry with common fields pre-filled
 * @param level Log level
 * @param type Log type
 * @param message Log message
 * @param appId Application ID
 * @param timestamp Optional timestamp (defaults to Date.now())
 */
export function createLogEntry(
  level: ConsoleEntry["level"],
  type: ConsoleEntry["type"],
  message: string,
  appId: number,
  timestamp: number = Date.now(),
): ConsoleEntry {
  return { level, type, message, appId, timestamp };
}
