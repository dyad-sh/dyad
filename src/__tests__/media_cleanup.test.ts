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

const dbMocks = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { select: mockSelect, from: mockFrom };
});

const mediaPathMocks = vi.hoisted(() => ({
  pruneAttachmentManifest: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: fsMocks,
  ...fsMocks,
}));

vi.mock("electron-log", () => ({
  default: {
    scope: vi.fn(() => logMocks),
  },
}));

vi.mock("@/paths/paths", () => ({
  getDyadAppPath: vi.fn((appPath: string) => {
    const path = require("node:path");
    if (path.isAbsolute(appPath)) return appPath;
    return `/home/user/dyad-apps/${appPath}`;
  }),
}));

vi.mock("@/db", () => ({
  db: { select: dbMocks.select },
}));

vi.mock("@/db/schema", () => ({
  apps: { path: "path" },
}));

vi.mock("@/ipc/utils/media_path_utils", () => ({
  ATTACHMENTS_MANIFEST_FILE: "attachments-manifest.json",
  DYAD_MEDIA_DIR_NAME: ".dyad/media",
  pruneAttachmentManifest: mediaPathMocks.pruneAttachmentManifest,
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
    dbMocks.select.mockClear();
    dbMocks.from.mockReset();
    mediaPathMocks.pruneAttachmentManifest.mockReset();
    mediaPathMocks.pruneAttachmentManifest.mockResolvedValue(0);
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

    dbMocks.from.mockResolvedValue([{ path: "my-app" }]);

    fsMocks.readdir.mockImplementation((dirPath: string) => {
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
    expect(mediaPathMocks.pruneAttachmentManifest).toHaveBeenCalledWith(
      "/home/user/dyad-apps/my-app",
    );
    expect(logMocks.log).toHaveBeenCalledWith("Cleaned up 1 old media files");
    expect(logMocks.warn).not.toHaveBeenCalled();
  });

  it("should handle no apps in the database gracefully", async () => {
    dbMocks.from.mockResolvedValue([]);

    await expect(cleanupOldMediaFiles()).resolves.toBeUndefined();

    expect(logMocks.log).toHaveBeenCalledWith("Cleaned up 0 old media files");
    expect(logMocks.warn).not.toHaveBeenCalled();
  });

  it("should skip apps without .dyad/media directory", async () => {
    dbMocks.from.mockResolvedValue([{ path: "app-no-media" }]);

    fsMocks.readdir.mockRejectedValue(new Error("ENOENT"));

    await cleanupOldMediaFiles();

    expect(fsMocks.unlink).not.toHaveBeenCalled();
    expect(logMocks.log).toHaveBeenCalledWith("Cleaned up 0 old media files");
  });

  it("should not throw if a per-file operation fails (logs a warning)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    dbMocks.from.mockResolvedValue([{ path: "my-app" }]);

    fsMocks.readdir.mockResolvedValue(["broken-file.png"]);

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

    dbMocks.from.mockResolvedValue([{ path: "my-app" }]);

    fsMocks.readdir.mockResolvedValue(["some-subdir", "old-file.png"]);

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
    expect(mediaPathMocks.pruneAttachmentManifest).toHaveBeenCalledWith(
      "/home/user/dyad-apps/my-app",
    );
  });

  it("should keep cleanup going when attachment manifest pruning fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    const oldMtimeMs = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const pruneError = new Error("manifest busy");

    dbMocks.from.mockResolvedValue([{ path: "my-app" }]);
    fsMocks.readdir.mockResolvedValue(["old-file.png"]);
    fsMocks.stat.mockResolvedValue({ isFile: () => true, mtimeMs: oldMtimeMs });
    fsMocks.unlink.mockResolvedValue(undefined);
    mediaPathMocks.pruneAttachmentManifest.mockRejectedValue(pruneError);

    await cleanupOldMediaFiles();

    expect(fsMocks.unlink).toHaveBeenCalledTimes(1);
    expect(logMocks.warn).toHaveBeenCalledWith(
      "Failed to prune attachment manifest for /home/user/dyad-apps/my-app/.dyad/media:",
      pruneError,
    );
    expect(logMocks.log).toHaveBeenCalledWith("Cleaned up 1 old media files");
  });

  it("should keep the attachments manifest", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    const oldMtimeMs = Date.now() - 31 * 24 * 60 * 60 * 1000;

    dbMocks.from.mockResolvedValue([{ path: "my-app" }]);
    fsMocks.readdir.mockResolvedValue([
      "attachments-manifest.json",
      "old-file.png",
    ]);
    fsMocks.stat.mockResolvedValue({ isFile: () => true, mtimeMs: oldMtimeMs });
    fsMocks.unlink.mockResolvedValue(undefined);

    await cleanupOldMediaFiles();

    expect(fsMocks.unlink).toHaveBeenCalledTimes(1);
    expect(fsMocks.unlink).toHaveBeenCalledWith(
      expect.stringContaining("old-file.png"),
    );
  });

  it("should iterate over multiple apps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    const oldMtimeMs = Date.now() - 31 * 24 * 60 * 60 * 1000;

    dbMocks.from.mockResolvedValue([{ path: "app-1" }, { path: "app-2" }]);

    fsMocks.readdir.mockResolvedValue(["old.png"]);
    fsMocks.stat.mockResolvedValue({ isFile: () => true, mtimeMs: oldMtimeMs });
    fsMocks.unlink.mockResolvedValue(undefined);

    await cleanupOldMediaFiles();

    expect(fsMocks.unlink).toHaveBeenCalledTimes(2);
    expect(logMocks.log).toHaveBeenCalledWith("Cleaned up 2 old media files");
  });

  it("should handle apps with absolute paths (skipCopy imports)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    const oldMtimeMs = Date.now() - 31 * 24 * 60 * 60 * 1000;

    dbMocks.from.mockResolvedValue([
      { path: "/external/projects/my-imported-app" },
    ]);

    fsMocks.readdir.mockImplementation((dirPath: string) => {
      if (dirPath === "/external/projects/my-imported-app/.dyad/media") {
        return Promise.resolve(["old-image.png"]);
      }
      return Promise.reject(new Error("ENOENT"));
    });

    fsMocks.stat.mockResolvedValue({ isFile: () => true, mtimeMs: oldMtimeMs });
    fsMocks.unlink.mockResolvedValue(undefined);

    await cleanupOldMediaFiles();

    expect(fsMocks.unlink).toHaveBeenCalledTimes(1);
    expect(fsMocks.unlink).toHaveBeenCalledWith(
      "/external/projects/my-imported-app/.dyad/media/old-image.png",
    );
  });
});
