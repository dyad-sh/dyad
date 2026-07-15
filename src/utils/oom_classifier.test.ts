import { describe, it, expect } from "vitest";
import { classifyOom } from "@/utils/oom_classifier";
import type { MinidumpSummary } from "@/utils/minidump_summary";

const baseDump: MinidumpSummary = { exceptionCode: 0xc0000005 };

describe("classifyOom", () => {
  it("returns none when there is nothing to classify", () => {
    expect(classifyOom({ nativeCrash: null, performance: null })).toEqual({
      verdict: "none",
      signals: [],
    });
  });

  it("declares native_oom for the Windows OOM exception code", () => {
    // Matched on the raw code, so no crashReason is needed.
    const result = classifyOom({
      nativeCrash: { exceptionCode: 0xe0000008 },
      performance: null,
    });
    expect(result.verdict).toBe("native_oom");
    expect(result.signals).toContain("oom_exception_code");
  });

  it("declares native_oom for a recorded allocation size", () => {
    const result = classifyOom({
      nativeCrash: { ...baseDump, oomAllocationSizeBytes: 4096 },
      performance: null,
    });
    expect(result.verdict).toBe("native_oom");
    expect(result.signals).toContain("oom_allocation_size");
  });

  it("treats a zero-byte allocation failure as an OOM", () => {
    const result = classifyOom({
      nativeCrash: { ...baseDump, oomAllocationSizeBytes: 0 },
      performance: null,
    });
    expect(result.verdict).toBe("native_oom");
    expect(result.signals).toContain("oom_allocation_size");
  });

  it("declares native_oom for the oom-size crash key", () => {
    const result = classifyOom({
      nativeCrash: { ...baseDump, annotations: { "oom-size": "4096" } },
      performance: null,
    });
    expect(result.verdict).toBe("native_oom");
    expect(result.signals).toEqual(["oom_size_annotation"]);
  });

  it("declares native_oom for V8's heap OOM crash key", () => {
    const result = classifyOom({
      nativeCrash: {
        exceptionCode: 5,
        crashReason: "SIGTRAP",
        annotations: { "electron.v8-oom.is_heap_oom": "1" },
      },
      performance: null,
    });
    expect(result.verdict).toBe("native_oom");
    expect(result.signals).toEqual(["v8_heap_oom_annotation"]);
  });

  it("declares native_oom for other v8-oom crash keys", () => {
    const result = classifyOom({
      nativeCrash: {
        exceptionCode: 5,
        annotations: { "electron.v8-oom.location": "CodeRange setup" },
      },
      performance: null,
    });
    expect(result.verdict).toBe("native_oom");
    expect(result.signals).toEqual(["v8_oom_annotation"]);
  });

  it("suspects OOM from a peak heap near the limit when no dump exists", () => {
    const result = classifyOom({
      nativeCrash: null,
      performance: { timestamp: 0, memoryUsageMB: 100, peakHeapPct: 97 },
    });
    expect(result.verdict).toBe("suspected_oom");
    expect(result.signals).toEqual(["peak_heap_near_limit"]);
  });

  it("suspects OOM from exhausted system memory when no dump exists", () => {
    const result = classifyOom({
      nativeCrash: null,
      performance: {
        timestamp: 0,
        memoryUsageMB: 100,
        systemMemoryUsageMB: 15600,
        systemMemoryTotalMB: 16000,
      },
      platform: "win32",
    });
    expect(result.verdict).toBe("suspected_oom");
    expect(result.signals).toEqual(["system_memory_near_limit"]);
  });

  it("ignores system memory on macOS, where free memory reads low", () => {
    const result = classifyOom({
      nativeCrash: null,
      performance: {
        timestamp: 0,
        memoryUsageMB: 100,
        systemMemoryUsageMB: 15600,
        systemMemoryTotalMB: 16000,
      },
      platform: "darwin",
    });
    expect(result).toEqual({ verdict: "none", signals: [] });
  });

  it("fires the system memory signal at the ratio and not below it", () => {
    const perf = (usedMB: number) => ({
      timestamp: 0,
      memoryUsageMB: 100,
      systemMemoryUsageMB: usedMB,
      systemMemoryTotalMB: 1000,
    });
    const at = classifyOom({
      nativeCrash: null,
      performance: perf(950),
      platform: "win32",
    });
    expect(at.verdict).toBe("suspected_oom");

    const below = classifyOom({
      nativeCrash: null,
      performance: perf(949),
      platform: "win32",
    });
    expect(below).toEqual({ verdict: "none", signals: [] });
  });

  it("ignores system memory when the recorded total is zero", () => {
    const result = classifyOom({
      nativeCrash: null,
      performance: {
        timestamp: 0,
        memoryUsageMB: 100,
        systemMemoryUsageMB: 100,
        systemMemoryTotalMB: 0,
      },
      platform: "win32",
    });
    expect(result).toEqual({ verdict: "none", signals: [] });
  });

  it("keeps pressure signals without changing the verdict when a non-OOM dump exists", () => {
    const result = classifyOom({
      nativeCrash: { ...baseDump, crashReason: "ACCESS_VIOLATION" },
      performance: { timestamp: 0, memoryUsageMB: 100, peakHeapPct: 97 },
    });
    expect(result.verdict).toBe("none");
    expect(result.signals).toEqual(["peak_heap_near_limit"]);
  });

  it("fires the heap signal at the threshold and not below it", () => {
    const at = classifyOom({
      nativeCrash: null,
      performance: { timestamp: 0, memoryUsageMB: 100, peakHeapPct: 95 },
    });
    expect(at.verdict).toBe("suspected_oom");

    const below = classifyOom({
      nativeCrash: null,
      performance: { timestamp: 0, memoryUsageMB: 100, peakHeapPct: 94.9 },
    });
    expect(below).toEqual({ verdict: "none", signals: [] });
  });

  it("combines dump and pressure signals under a native_oom verdict", () => {
    const result = classifyOom({
      nativeCrash: { exceptionCode: 0xe0000008, crashReason: "OUT_OF_MEMORY" },
      performance: { timestamp: 0, memoryUsageMB: 100, peakHeapPct: 99 },
    });
    expect(result.verdict).toBe("native_oom");
    expect(result.signals).toEqual([
      "oom_exception_code",
      "peak_heap_near_limit",
    ]);
  });
});
