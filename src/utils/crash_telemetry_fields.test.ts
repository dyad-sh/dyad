import { describe, it, expect } from "vitest";
import {
  ALLOWED_ANNOTATION_KEYS,
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
      diskTotalMB: 476000,
      diskUsedMB: 401000,
      diskAvailableMB: 51000,
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
      commitLimitMB: 73728,
      commitAvailableMB: 12288,
      pagefileMode: "fixed",
      pagefileMaxMB: 8192,
      processCommitMB: { browser: 350, tab: 800, zygote: 10 },
      uiRendererWorkingSetMB: 500,
      previewRendererWorkingSetMB: 400,
      uiRendererCommitMB: 450,
      previewRendererCommitMB: 350,
      mainExternalMB: 120,
      mainArrayBuffersMB: 40,
      rendererHeapUsedMB: 700,
      rendererHeapLimitMB: 4096,
      devServerCount: 2,
      devServerTotalMB: 1800,
      devServerMaxMB: 1200,
      devServerMaxProcessCount: 4,
      devServerSampledAt: 1751499800000,
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
    expect(fields.last_known_disk_total_mb).toBe(476000);
    expect(fields.last_known_disk_used_mb).toBe(401000);
    // Reported separately from used because space the platform withholds
    // sits between them: used + available is short of total.
    expect(fields.last_known_disk_available_mb).toBe(51000);
    // Machine-wide commit charge and whether its limit can grow. The
    // pagefile fields share their names with app:initial-load.
    expect(fields.last_known_commit_limit_mb).toBe(73728);
    expect(fields.last_known_commit_available_mb).toBe(12288);
    expect(fields.pagefile_mode).toBe("fixed");
    expect(fields.pagefile_max_mb).toBe(8192);
    // Dyad's share of the commit charge, per type, with the same "other"
    // bucket as the working sets.
    expect(fields.last_known_commit_browser_mb).toBe(350);
    expect(fields.last_known_commit_tab_mb).toBe(800);
    expect(fields.last_known_commit_other_mb).toBe(10);
    expect(fields.last_known_ui_renderer_working_set_mb).toBe(500);
    expect(fields.last_known_preview_renderer_working_set_mb).toBe(400);
    expect(fields.last_known_ui_renderer_commit_mb).toBe(450);
    expect(fields.last_known_preview_renderer_commit_mb).toBe(350);
    expect(fields.last_known_main_external_mb).toBe(120);
    expect(fields.last_known_main_array_buffers_mb).toBe(40);
    expect(fields.last_known_renderer_heap_used_mb).toBe(700);
    expect(fields.last_known_renderer_heap_limit_mb).toBe(4096);
    expect(fields.dev_server_count).toBe(2);
    expect(fields.dev_server_total_mb).toBe(1800);
    expect(fields.dev_server_max_mb).toBe(1200);
    expect(fields.dev_server_max_process_count).toBe(4);
    expect(fields.dev_server_sampled_at).toBe(1751499800000);

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
    expect(fields.last_known_disk_total_mb).toBeUndefined();
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

  it("drops keys outside the allowlist and reports only their count", () => {
    expect(
      crashAnnotationEventFields({
        "url-chunk": "https://example.com/secret",
        "switch-1": "--user-data-dir=/home/user",
        "oom-size": "4096",
      }),
    ).toEqual({
      crash_annotation_oom_size: "4096",
      crash_annotations_dropped: 2,
    });
  });

  it("omits the dropped count when nothing is dropped", () => {
    expect(crashAnnotationEventFields({ ptype: "browser" })).toEqual({
      crash_annotation_ptype: "browser",
    });
  });

  it("normalizes every allowlisted key to a distinct field name", () => {
    // Distinct field names are what lets the flattener assign without a
    // collision check; this guards additions to the allowlist.
    const fields = crashAnnotationEventFields(
      Object.fromEntries([...ALLOWED_ANNOTATION_KEYS].map((k) => [k, "v"])),
    );
    expect(Object.keys(fields)).toHaveLength(ALLOWED_ANNOTATION_KEYS.size);
  });

  it("passes the V8 heap keys through by exact name", () => {
    expect(
      crashAnnotationEventFields({
        "electron.v8-oom.heap.limit": "4144",
        "electron.v8-fatal.message":
          "MarkCompactCollector: young object promotion failed",
      }),
    ).toEqual({
      crash_annotation_electron_v8_oom_heap_limit: "4144",
      crash_annotation_electron_v8_fatal_message:
        "MarkCompactCollector: young object promotion failed",
    });
  });
});
