import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import { getDiskUsageMB, isDiskSpaceExhausted } from "@/utils/disk_usage";

const { errorLog } = vi.hoisted(() => ({ errorLog: vi.fn() }));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ error: errorLog }) },
}));

vi.mock("node:fs", () => ({
  default: { statfsSync: vi.fn() },
}));

const statfsSync = vi.mocked(fs.statfsSync);

// 4KiB blocks: 262144 total = 1024MB, 65536 free = 256MB, 32768 available
// to non-root = 128MB. The gap between free and available is the reserve.
function statfsResult(overrides: Partial<fs.StatsFs> = {}): fs.StatsFs {
  return {
    type: 61267,
    bsize: 4096,
    blocks: 262144,
    bfree: 65536,
    bavail: 32768,
    files: 0,
    ffree: 0,
    ...overrides,
  } as fs.StatsFs;
}

describe("getDiskUsageMB", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts blocks to MB and reports used and available separately", () => {
    statfsSync.mockReturnValue(statfsResult());

    expect(getDiskUsageMB("/some/path")).toEqual({
      totalMB: 1024,
      // Every allocated block, including the root reserve.
      usedMB: 768,
      // Excludes the reserve, so used + available is short of total.
      availableMB: 128,
    });
    expect(statfsSync).toHaveBeenCalledExactlyOnceWith("/some/path");
  });

  it("scales with the filesystem's block size", () => {
    statfsSync.mockReturnValue(
      statfsResult({ bsize: 1024, blocks: 2048, bfree: 1024, bavail: 1024 }),
    );

    expect(getDiskUsageMB("/some/path")).toEqual({
      totalMB: 2,
      usedMB: 1,
      availableMB: 1,
    });
  });

  it("returns null when the path cannot be read", () => {
    statfsSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(getDiskUsageMB("/missing")).toBeNull();
  });

  it("logs every failure, not just the first", () => {
    statfsSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    getDiskUsageMB("/missing");
    getDiskUsageMB("/missing");

    // A repeating failure is itself diagnostic, and only a recent line
    // survives in the last-N-lines view that bug reports include.
    expect(errorLog).toHaveBeenCalledTimes(2);
  });
});

describe("isDiskSpaceExhausted", () => {
  it("returns true when no whole megabyte is available", () => {
    expect(
      isDiskSpaceExhausted({
        totalMB: 1024,
        usedMB: 1024,
        availableMB: 0,
      }),
    ).toBe(true);
  });

  it("returns false when space is available or capacity is unknown", () => {
    expect(
      isDiskSpaceExhausted({
        totalMB: 1024,
        usedMB: 1023,
        availableMB: 1,
      }),
    ).toBe(false);
    expect(isDiskSpaceExhausted(null)).toBe(false);
  });
});
