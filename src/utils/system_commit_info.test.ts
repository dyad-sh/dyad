import { describe, it, expect } from "vitest";
import { getSystemCommitInfoMB } from "@/utils/system_commit_info";

describe("getSystemCommitInfoMB", () => {
  it("maps Chromium's swap fields to the Windows commit charge in MB", () => {
    expect(
      getSystemCommitInfoMB({
        platform: "win32",
        // KB, as process.getSystemMemoryInfo() reports them.
        getSystemMemoryInfo: () => ({
          swapTotal: 72 * 1024 * 1024,
          swapFree: 12 * 1024 * 1024,
        }),
      }),
    ).toEqual({ commitLimitMB: 73728, commitAvailableMB: 12288 });
  });

  it("reports nothing off Windows, where the fields really are swap", () => {
    for (const platform of ["darwin", "linux"] as const) {
      expect(
        getSystemCommitInfoMB({
          platform,
          getSystemMemoryInfo: () => ({ swapTotal: 1024, swapFree: 512 }),
        }),
      ).toBeNull();
    }
  });

  it("reports nothing when the reader fails or returns no limit", () => {
    expect(
      getSystemCommitInfoMB({
        platform: "win32",
        getSystemMemoryInfo: () => {
          throw new Error("unavailable");
        },
      }),
    ).toBeNull();
    expect(
      getSystemCommitInfoMB({
        platform: "win32",
        getSystemMemoryInfo: () => ({ swapTotal: 0, swapFree: 0 }),
      }),
    ).toBeNull();
  });
});
