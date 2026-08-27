import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import { getDiskUsageMB } from "@/utils/disk_usage";

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

  it("logs a failure once rather than on every call", async () => {
    // Fresh module so the once-per-process flag starts unset.
    vi.resetModules();
    const { getDiskUsageMB: freshGetDiskUsageMB } =
      await import("@/utils/disk_usage");
    statfsSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    freshGetDiskUsageMB("/missing");
    freshGetDiskUsageMB("/missing");
    freshGetDiskUsageMB("/missing");

    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it("stays quiet on a later failure even after a reading succeeds", async () => {
    vi.resetModules();
    const { getDiskUsageMB: freshGetDiskUsageMB } =
      await import("@/utils/disk_usage");
    const throwENOENT = () => {
      throw new Error("ENOENT");
    };

    statfsSync.mockImplementation(throwENOENT);
    freshGetDiskUsageMB("/missing");
    statfsSync.mockReturnValue(statfsResult());
    freshGetDiskUsageMB("/some/path");
    statfsSync.mockImplementation(throwENOENT);
    freshGetDiskUsageMB("/missing");

    // A volume that flaps would otherwise re-arm the log on every recovery.
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});
