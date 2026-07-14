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

// Only annotation keys known to hold diagnostic, non-sensitive values are
// exported to telemetry. Chromium can add new crash keys in future Electron
// versions, so unknown keys are dropped and only counted.
const ALLOWED_ANNOTATION_KEYS = new Set([
  // Our crashReporter globalExtra parameters.
  "app_version",
  "electron_version",
  "chrome_version",
  "os",
  "arch",
  // Electron's own crashReporter parameters.
  "_productName",
  "_companyName",
  "_version",
  // Crashpad and Electron process context.
  "ptype",
  "process_type",
  "platform",
  "plat",
  "prod",
  "ver",
  "pid",
  "osarch",
  "lsb-release",
  "service-name",
  "chrome-trace-id",
  "num-experiments",
]);

// Families of diagnostic keys: memory and GPU state.
const ALLOWED_ANNOTATION_PREFIXES = [
  "electron.", // e.g. electron.v8-oom.is_heap_oom
  "gpu", // gpu_webgl, gpu_compositing
  "oom-", // oom-size
  "total-", // total-discardable-memory-allocated
  "v8", // v8-oom variants outside the electron. namespace
];

function isAllowedAnnotation(key: string): boolean {
  return (
    ALLOWED_ANNOTATION_KEYS.has(key) ||
    ALLOWED_ANNOTATION_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

// Allowlisted crash annotations as flat telemetry fields, one property per
// key, because PostHog cannot easily filter nested JSON. Keys are sanitized
// to snake case. Dropped keys are reported only as a count.
export function crashAnnotationEventFields(
  annotations: Record<string, string>,
): Record<string, string | number> {
  const fields: Record<string, string | number> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(annotations)) {
    if (!isAllowedAnnotation(key)) {
      dropped++;
      continue;
    }
    const name = `crash_annotation_${key.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    // First writer wins on sanitized-name collisions, matching the
    // parser's precedence of the sources.
    if (Object.hasOwn(fields, name)) continue;
    fields[name] = value;
  }
  if (dropped > 0) {
    fields.crash_annotations_dropped = dropped;
  }
  return fields;
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
