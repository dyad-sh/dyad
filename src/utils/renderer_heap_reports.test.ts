import { describe, it, expect, beforeEach } from "vitest";
import {
  clearRendererHeapReport,
  getLatestRendererHeapReport,
  recordRendererHeapReport,
  resetRendererHeapReportsForTesting,
} from "@/utils/renderer_heap_reports";

describe("renderer heap reports", () => {
  beforeEach(() => {
    resetRendererHeapReportsForTesting();
  });

  it("returns null before any window has reported", () => {
    expect(getLatestRendererHeapReport(1000)).toBeNull();
  });

  it("returns the window with the most heap in use", () => {
    recordRendererHeapReport(1, { heapUsedMB: 300, heapLimitMB: 4096 }, 1000);
    recordRendererHeapReport(2, { heapUsedMB: 900, heapLimitMB: 4096 }, 1000);
    expect(getLatestRendererHeapReport(1000)).toEqual({
      heapUsedMB: 900,
      heapLimitMB: 4096,
    });
  });

  it("keeps only the latest report per window", () => {
    recordRendererHeapReport(1, { heapUsedMB: 900, heapLimitMB: 4096 }, 1000);
    recordRendererHeapReport(1, { heapUsedMB: 200, heapLimitMB: 4096 }, 2000);
    expect(getLatestRendererHeapReport(2000)).toEqual({
      heapUsedMB: 200,
      heapLimitMB: 4096,
    });
  });

  it("drops a window whose reports have stopped", () => {
    // A renderer that stopped reporting is hung, reloading, or gone; its
    // last figure must not read as current at crash time.
    recordRendererHeapReport(1, { heapUsedMB: 900, heapLimitMB: 4096 }, 0);
    recordRendererHeapReport(2, { heapUsedMB: 100, heapLimitMB: 4096 }, 95_000);
    expect(getLatestRendererHeapReport(100_000)).toEqual({
      heapUsedMB: 100,
      heapLimitMB: 4096,
    });
  });

  it("forgets a cleared window", () => {
    recordRendererHeapReport(1, { heapUsedMB: 900, heapLimitMB: 4096 }, 0);
    clearRendererHeapReport(1);
    expect(getLatestRendererHeapReport(0)).toBeNull();
  });
});
