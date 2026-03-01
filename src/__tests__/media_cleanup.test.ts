import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fsMocks = vi.hoisted(() => {
  return {
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
  };
});

const logMocks = vi.hoisted(() => {
  return {
    log: vi.fn(),
    warn: vi.fn(),
  };
});

const pathsMocks = vi.hoisted(() => {
  return {
    getDyadAppsBaseDirectory: vi.fn(() => "/home/user/dyad-apps"),
  };
});

vi.mock("node:fs/promises", () => ({
  default: fsMocks,
  ...fsMocks,
}));

vi.mock("electron-log", () => ({
  default: {
    scope: vi.fn(() => logMocks),
  },
}));

vi.mock("@/paths/paths", () => pathsMocks);

vi.mock("@/ipc/utils/media_path_utils", () => ({
  DYAD_MEDIA_DIR_NAME: ".dyad/media",
}));

import {
  MEDIA_TTL_DAYS,
  cleanupOldMediaFiles,
} from "@/ipc/utils/media_cleanup";

describe("cleanupOldMediaFiles", () => {
  beforeEach(() => {
    fsMocks.readdir.mockReset();
    fsMocks.stat.mockReset();
    fsMocks.unlink.mockReset();
    logMocks.log.mockClear();
    logMocks.warn.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should use the expected TTL constant", () => {
    expect(MEDIA_TTL_DAYS).toBe(30);
  });

  it("should delete files older than the cutoff date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    const now = Date.now();
    const oldMtimeMs = now - 31 * 24 * 60 * 60 * 1000;
    const recentMtimeMs = now - 5 * 24 * 60 * 60 * 1000;

    fsMocks.readdir.mockImplementation((dirPath: string, options?: any) => {
      if (dirPath === "/home/user/dyad-apps" && options?.withFileTypes) {
        return Promise.resolve([{ name: "my-app", isDirectory: () => true }]);
      }
      if (dirPath === "/home/user/dyad-apps/my-app/.dyad/media") {
        return Promise.resolve(["old-image.png", "recent-image.png"]);
      }
      return Promise.reject(new Error("ENOENT"));
    });

    fsMocks.stat.mockImplementation((filePath: string) => {
      if (filePath.includes("old-image.png")) {
        return Promise.resolve({ isFile: () => true, mtimeMs: oldMtimeMs });
      }
      if (filePath.includes("recent-image.png")) {
        return Promise.resolve({
          isFile: () => true,
          mtimeMs: recentMtimeMs,
        });
      }
      return Promise.reject(new Error("ENOENT"));
    });

    fsMocks.unlink.mockResolvedValue(undefined);

    await cleanupOldMediaFiles();

    expect(fsMocks.unlink).toHaveBeenCalledTimes(1);
    expect(fsMocks.unlink).toHaveBeenCalledWith(
      "/home/user/dyad-apps/my-app/.dyad/media/old-image.png",
    );
    expect(logMocks.log).toHaveBeenCalledWith("Cleaned up 1 old media files");
    expect(logMocks.warn).not.toHaveBeenCalled();
  });

  it("should handle missing base directory gracefully", async () => {
    fsMocks.readdir.mockRejectedValueOnce(new Error("ENOENT"));

    await expect(cleanupOldMediaFiles()).resolves.toBeUndefined();

    expect(logMocks.log).toHaveBeenCalledWith(
      "No dyad-apps directory found, skipping media cleanup",
    );
    expect(logMocks.warn).not.toHaveBeenCalled();
  });

  it("should skip apps without .dyad/media directory", async () => {
    fsMocks.readdir.mockImplementation((dirPath: string, options?: any) => {
      if (dirPath === "/home/user/dyad-apps" && options?.withFileTypes) {
        return Promise.resolve([
          { name: "app-no-media", isDirectory: () => true },
        ]);
      }
      return Promise.reject(new Error("ENOENT"));
    });

    await cleanupOldMediaFiles();

    expect(fsMocks.unlink).not.toHaveBeenCalled();
    expect(logMocks.log).toHaveBeenCalledWith("Cleaned up 0 old media files");
  });

  it("should not throw if a per-file operation fails (logs a warning)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    fsMocks.readdir.mockImplementation((dirPath: string, options?: any) => {
      if (options?.withFileTypes) {
        return Promise.resolve([{ name: "my-app", isDirectory: () => true }]);
      }
      return Promise.resolve(["broken-file.png"]);
    });

    const statError = new Error("EPERM");
    fsMocks.stat.mockRejectedValueOnce(statError);

    await expect(cleanupOldMediaFiles()).resolves.toBeUndefined();

    expect(logMocks.warn).toHaveBeenCalledTimes(1);
    expect(logMocks.warn.mock.calls[0][0]).toContain(
      "Failed to process media file",
    );
    expect(logMocks.warn.mock.calls[0][1]).toBe(statError);
  });

  it("should skip subdirectories inside .dyad/media", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    const oldMtimeMs = Date.now() - 31 * 24 * 60 * 60 * 1000;

    fsMocks.readdir.mockImplementation((dirPath: string, options?: any) => {
      if (options?.withFileTypes) {
        return Promise.resolve([{ name: "my-app", isDirectory: () => true }]);
      }
      return Promise.resolve(["some-subdir", "old-file.png"]);
    });

    fsMocks.stat.mockImplementation((filePath: string) => {
      if (filePath.includes("some-subdir")) {
        return Promise.resolve({ isFile: () => false, mtimeMs: oldMtimeMs });
      }
      return Promise.resolve({ isFile: () => true, mtimeMs: oldMtimeMs });
    });

    fsMocks.unlink.mockResolvedValue(undefined);

    await cleanupOldMediaFiles();

    expect(fsMocks.unlink).toHaveBeenCalledTimes(1);
    expect(fsMocks.unlink).toHaveBeenCalledWith(
      expect.stringContaining("old-file.png"),
    );
  });

  it("should iterate over multiple app directories", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    const oldMtimeMs = Date.now() - 31 * 24 * 60 * 60 * 1000;

    fsMocks.readdir.mockImplementation((dirPath: string, options?: any) => {
      if (options?.withFileTypes) {
        return Promise.resolve([
          { name: "app-1", isDirectory: () => true },
          { name: "app-2", isDirectory: () => true },
        ]);
      }
      return Promise.resolve(["old.png"]);
    });

    fsMocks.stat.mockResolvedValue({ isFile: () => true, mtimeMs: oldMtimeMs });
    fsMocks.unlink.mockResolvedValue(undefined);

    await cleanupOldMediaFiles();

    expect(fsMocks.unlink).toHaveBeenCalledTimes(2);
    expect(logMocks.log).toHaveBeenCalledWith("Cleaned up 2 old media files");
  });
});
