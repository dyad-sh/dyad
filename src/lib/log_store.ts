/**
 * Central log store for console entries
 * This is the single source of truth for all logs (client, server, edge, network, build)
 */

import type { ConsoleEntry } from "@/ipc/types";

// In-memory log store (per app)
const logStore = new Map<number, ConsoleEntry[]>();

// Maximum logs per app (circular buffer)
const MAX_LOGS_PER_APP = 1000;

/**
 * Add a log entry to the store
 */
export function addLog(entry: ConsoleEntry): void {
  const appLogs = logStore.get(entry.appId) || [];
  appLogs.push(entry);

  // Keep only recent logs (circular buffer)
  if (appLogs.length > MAX_LOGS_PER_APP) {
    appLogs.shift();
  }

  logStore.set(entry.appId, appLogs);
}

/**
 * Get all logs for a specific app
 */
export function getLogs(appId: number): ConsoleEntry[] {
  return logStore.get(appId) || [];
}

/**
 * Clear all logs for a specific app
 */
export function clearLogs(appId: number): void {
  logStore.delete(appId);
}
