import type { UserSettings } from "../lib/schemas";
import type { ActivitySnapshot } from "./memory_activity";

type PerformanceSnapshot = NonNullable<UserSettings["lastKnownPerformance"]>;

// Known Electron process types get their own telemetry field; anything else
// is summed into "other" so the set of PostHog columns stays stable.
const KNOWN_PROCESS_TYPES = new Set(["browser", "tab", "gpu", "utility"]);

/**
 * Flat telemetry fields for a performance snapshot, shared by
 * app:crash_detected and renderer:crash_detected. Everything is a scalar
 * because PostHog cannot easily filter or aggregate nested JSON.
 * time_since_last_heartbeat_ms is measured at send time, not crash time.
 */
export function crashPerformanceEventFields(
  perf: PerformanceSnapshot,
): Record<string, unknown> {
  return {
    last_known_memory_mb: perf.memoryUsageMB,
    last_known_cpu_pct: perf.cpuUsagePercent,
    last_known_system_memory_mb: perf.systemMemoryUsageMB,
    last_known_system_memory_total_mb: perf.systemMemoryTotalMB,
    last_known_system_cpu_pct: perf.systemCpuPercent,
    last_known_snapshot_timestamp: perf.timestamp,
    time_since_last_heartbeat_ms: Date.now() - perf.timestamp,
    last_known_heap_used_mb: perf.heapUsedMB,
    last_known_heap_limit_mb: perf.heapLimitMB,
    ...workingSetFields("last_known_working_set", perf.processWorkingSetsMB),
    ...activityFields("last_known", perf.activity),
    peak_heap_used_mb: perf.peakHeapUsedMB,
    peak_heap_pct: perf.peakHeapPct,
    peak_rss_mb: perf.peakRssMB,
    ...workingSetFields("peak_working_set", perf.peakProcessWorkingSetsMB),
    ...activityFields("peak", perf.peakActivity),
    peak_timestamp: perf.peakTimestamp,
  };
}

function workingSetFields(
  prefix: string,
  sets: Record<string, number> | undefined,
): Record<string, number> {
  if (!sets) {
    return {};
  }
  const fields: Record<string, number> = {};
  let other = 0;
  for (const [key, value] of Object.entries(sets)) {
    if (KNOWN_PROCESS_TYPES.has(key)) {
      fields[`${prefix}_${key}_mb`] = value;
    } else {
      other += value;
    }
  }
  if (other > 0) {
    fields[`${prefix}_other_mb`] = other;
  }
  return fields;
}

function activityFields(
  prefix: string,
  activity: ActivitySnapshot | undefined,
): Record<string, unknown> {
  if (!activity) {
    return {};
  }
  return {
    [`${prefix}_active_streams`]: activity.activeStreams,
    [`${prefix}_running_apps`]: activity.runningApps,
    [`${prefix}_extract_codebase`]: activity.extractCodebase,
    [`${prefix}_ts_utility_process`]: activity.tsUtilityProcess,
  };
}
