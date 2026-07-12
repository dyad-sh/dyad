import { describe, it, expect } from "vitest";
import { crashPerformanceEventFields } from "@/utils/crash_telemetry_fields";

describe("crashPerformanceEventFields", () => {
  it("flattens working sets and activity into scalar fields", () => {
    const fields = crashPerformanceEventFields({
      timestamp: 1751500000000,
      memoryUsageMB: 400,
      heapUsedMB: 512,
      heapLimitMB: 4144,
      processWorkingSetsMB: { browser: 400, tab: 900, zygote: 30, unknown: 20 },
      activity: {
        activeStreams: 1,
        runningApps: 2,
        extractCodebase: true,
        tsUtilityProcess: "tsc",
      },
      peakHeapUsedMB: 1024,
      peakHeapPct: 24.7,
      peakRssMB: 2048,
      peakProcessWorkingSetsMB: { browser: 900, utility: 800 },
      peakActivity: {
        activeStreams: 2,
        runningApps: 3,
        extractCodebase: false,
        tsUtilityProcess: null,
      },
      peakTimestamp: 1751499970000,
    });

    expect(fields.last_known_working_set_browser_mb).toBe(400);
    expect(fields.last_known_working_set_tab_mb).toBe(900);
    // Rare process types are summed into "other" to keep columns stable.
    expect(fields.last_known_working_set_other_mb).toBe(50);
    expect(fields.last_known_active_streams).toBe(1);
    expect(fields.last_known_extract_codebase).toBe(true);
    expect(fields.last_known_ts_utility_process).toBe("tsc");
    expect(fields.peak_working_set_browser_mb).toBe(900);
    expect(fields.peak_working_set_utility_mb).toBe(800);
    expect(fields.peak_working_set_other_mb).toBeUndefined();
    expect(fields.peak_active_streams).toBe(2);
    expect(fields.peak_ts_utility_process).toBeNull();
    expect(fields.peak_heap_used_mb).toBe(1024);

    // No object-valued properties: PostHog cannot filter nested JSON.
    for (const value of Object.values(fields)) {
      expect(typeof value === "object" && value !== null).toBe(false);
    }
  });

  it("omits working set and activity fields when absent", () => {
    const fields = crashPerformanceEventFields({
      timestamp: 1751500000000,
      memoryUsageMB: 400,
    });

    expect(fields.last_known_memory_mb).toBe(400);
    expect(fields.last_known_working_set_browser_mb).toBeUndefined();
    expect(fields.last_known_active_streams).toBeUndefined();
    expect(fields.peak_active_streams).toBeUndefined();
  });
});
