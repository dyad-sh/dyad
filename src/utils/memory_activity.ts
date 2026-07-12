// Tracks memory-heavy work in flight in the main process, so performance
// snapshots and crash reports can say what was running at the time.
// This module must stay free of runtime imports to avoid dependency
// cycles: it is imported both by the tracked operations and the monitor.

import type { TypeScriptUtilityProcessKind } from "../ipc/processors/typescript_utility_process_scheduler";

export interface ActivitySnapshot {
  activeStreams: number;
  runningApps: number;
  extractCodebase: boolean;
  // The scheduler serializes these processes, so at most one kind runs.
  tsUtilityProcess: TypeScriptUtilityProcessKind | null;
}

let extractCodebaseCount = 0;

export function extractCodebaseStarted(): void {
  extractCodebaseCount++;
}

export function extractCodebaseFinished(): void {
  extractCodebaseCount = Math.max(0, extractCodebaseCount - 1);
}

export function isExtractCodebaseActive(): boolean {
  return extractCodebaseCount > 0;
}

// For tests.
export function resetExtractCodebaseCount(): void {
  extractCodebaseCount = 0;
}
