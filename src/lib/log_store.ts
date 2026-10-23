/**
 * Central log store for console entries
 * This is the single source of truth for all logs (client, server, edge, network, build)
 */

import type { ConsoleEntry } from "@/ipc/types";

// In-memory log store (per app)
const logStore = new Map<number, ConsoleEntry[]>();

// Maximum logs per app (circular buffer)
export const MAX_LOGS_PER_APP = 1000;

/**
 * Add a log entry to the store
 */
export function addLog(entry: ConsoleEntry): void {
  addLogs([entry]);
}

/**
 * Add log entries to the store in order. Trims each app's buffer once per
 * call rather than once per entry, so a large batch stays cheap.
 */
export function addLogs(entries: readonly ConsoleEntry[]): void {
  const touched = new Set<ConsoleEntry[]>();
  for (const entry of entries) {
    let appLogs = logStore.get(entry.appId);
    if (!appLogs) {
      appLogs = [];
      logStore.set(entry.appId, appLogs);
    }
    appLogs.push(entry);
    touched.add(appLogs);
  }

  // Keep only recent logs (circular buffer)
  for (const appLogs of touched) {
    if (appLogs.length > MAX_LOGS_PER_APP) {
      appLogs.splice(0, appLogs.length - MAX_LOGS_PER_APP);
    }
  }
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
