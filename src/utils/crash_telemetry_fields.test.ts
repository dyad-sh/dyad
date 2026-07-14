import { describe, it, expect } from "vitest";
import {
  crashAnnotationEventFields,
  crashPerformanceEventFields,
} from "@/utils/crash_telemetry_fields";

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

describe("crashAnnotationEventFields", () => {
  it("prefixes and snake-cases annotation keys", () => {
    expect(
      crashAnnotationEventFields({
        "electron.v8-oom.is_heap_oom": "1",
        "lsb-release": "Linux Mint 22.3",
        ptype: "utility",
      }),
    ).toEqual({
      crash_annotation_electron_v8_oom_is_heap_oom: "1",
      crash_annotation_lsb_release: "Linux Mint 22.3",
      crash_annotation_ptype: "utility",
    });
  });

  it("keeps the leading underscore of Electron's internal keys", () => {
    // _productName and friends come from Electron's crashReporter; the
    // double underscore marks them apart from same-named plain keys.
    expect(crashAnnotationEventFields({ _productName: "dyad" })).toEqual({
      crash_annotation__productname: "dyad",
    });
  });

  it("lowercases and collapses runs of special characters", () => {
    expect(crashAnnotationEventFields({ "GPU  Status?!": "ok" })).toEqual({
      crash_annotation_gpu_status_: "ok",
    });
  });

  it("lets the first key win when sanitized names collide", () => {
    expect(
      crashAnnotationEventFields({ "oom-size": "1", oom_size: "2" }),
    ).toEqual({ crash_annotation_oom_size: "1" });
  });
});
