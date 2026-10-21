import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendAttachmentManifestEntriesWithLogicalNames,
  getDyadMediaDir,
} from "../media_path_utils";
import { buildZip } from "./testing/zip_writer";
import {
  buildArchiveManifestEntries,
  describeSkippedArchiveEntries,
  extractZipAttachment,
  toZipExtractionErrorMessage,
  withFinalizedEntryNames,
  type ExtractedArchiveSummary,
} from "./zip_attachment";
import { ZipLimitError } from "./zip_extract";

describe("withFinalizedEntryNames", () => {
  const summary: ExtractedArchiveSummary = {
    extractedDirName: "hash",
    files: [
      { relativePath: "docs/{slug}.md", sizeBytes: 1 },
      { relativePath: "a:b.txt", sizeBytes: 2 },
      { relativePath: "plain.txt", sizeBytes: 3 },
    ],
    skipped: {},
    strippedRootDir: null,
    totalBytes: 6,
    entryCount: 3,
  };

  it("advertises the names the manifest registered", async () => {
    const appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-zip-names-"));
    try {
      const finalized = await appendAttachmentManifestEntriesWithLogicalNames(
        appPath,
        buildArchiveManifestEntries(
          "proj.zip",
          summary,
          "2026-01-01T00:00:00Z",
        ),
      );
      const named = withFinalizedEntryNames(summary, "proj.zip", finalized);
      expect(named.files.map((file) => file.relativePath)).toEqual([
        "docs/_slug_.md",
        "a_b.txt",
        "plain.txt",
      ]);
      // Sizes and everything else are untouched.
      expect(named.files.map((file) => file.sizeBytes)).toEqual([1, 2, 3]);
      expect(named.totalBytes).toBe(6);
    } finally {
      fs.rmSync(appPath, { recursive: true, force: true });
    }
  });

  it("keeps the original path when no finalized entry exists", () => {
    const named = withFinalizedEntryNames(summary, "proj.zip", []);
    expect(named.files).toEqual(summary.files);
  });
});

describe("extractZipAttachment", () => {
  let appPath: string;

  beforeEach(() => {
    appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-zip-attach-"));
    fs.mkdirSync(getDyadMediaDir(appPath), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(appPath, { recursive: true, force: true });
  });

  it("unpacks next to the stored file and honors a caller-supplied byte budget", async () => {
    const archive = buildZip([
      { name: "a.txt", data: "x".repeat(600) },
      { name: "__MACOSX/._a.txt", data: "noise" },
    ]);
    const mediaDir = getDyadMediaDir(appPath);
    const summary = await extractZipAttachment({
      mediaDir,
      storedFileName: "abc123.zip",
      archive,
    });
    expect(summary.extractedDirName).toBe("abc123-unpacked");
    expect(summary.files.map((file) => file.relativePath)).toEqual(["a.txt"]);
    expect(summary.skipped).toEqual({ ignored: 1 });
    expect(fs.existsSync(path.join(mediaDir, "abc123-unpacked", "a.txt"))).toBe(
      true,
    );

    await expect(
      extractZipAttachment({
        mediaDir,
        storedFileName: "abc123.zip",
        archive,
        limits: { maxTotalUncompressedBytes: 100 },
      }),
    ).rejects.toThrow(ZipLimitError);
    // The failed attempt leaves the earlier extraction untouched.
    expect(
      fs.readFileSync(path.join(mediaDir, "abc123-unpacked", "a.txt"), "utf8"),
    ).toBe("x".repeat(600));
    // No staging or retired directories are left behind.
    expect(fs.readdirSync(mediaDir).sort()).toEqual(["abc123-unpacked"]);
  });

  it("fails cleanly when there is no earlier extraction", async () => {
    const mediaDir = getDyadMediaDir(appPath);
    await expect(
      extractZipAttachment({
        mediaDir,
        storedFileName: "fresh.zip",
        archive: buildZip([{ name: "a.txt", data: "x".repeat(600) }]),
        limits: { maxTotalUncompressedBytes: 100 },
      }),
    ).rejects.toThrow(ZipLimitError);
    expect(fs.readdirSync(mediaDir)).toEqual([]);
  });

  it("abandons an aborted extraction and keeps the earlier one", async () => {
    const mediaDir = getDyadMediaDir(appPath);
    await extractZipAttachment({
      mediaDir,
      storedFileName: "shared.zip",
      archive: buildZip([{ name: "old.txt", data: "old" }]),
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractZipAttachment({
        mediaDir,
        storedFileName: "shared.zip",
        archive: buildZip([{ name: "new.txt", data: "new" }]),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fs.readdirSync(path.join(mediaDir, "shared-unpacked"))).toEqual([
      "old.txt",
    ]);
    expect(fs.readdirSync(mediaDir)).toEqual(["shared-unpacked"]);
  });

  it("reports a shared entry budget distinctly", () => {
    const error = new ZipLimitError("archive declares 9 entries", "entries");
    expect(
      toZipExtractionErrorMessage("a.zip", error, {
        sharedBudgetEntries: 5000,
      }),
    ).toContain("hold more than the 5000 entries they can share");
    expect(toZipExtractionErrorMessage("a.zip", error)).toContain(
      "too large to extract",
    );
  });

  it("keeps an earlier extraction in place and refreshes its time", async () => {
    const archive = buildZip([{ name: "a.txt", data: "alpha" }]);
    const mediaDir = getDyadMediaDir(appPath);
    await extractZipAttachment({
      mediaDir,
      storedFileName: "shared.zip",
      archive,
    });
    const destinationDir = path.join(mediaDir, "shared-unpacked");
    const longAgo = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(destinationDir, longAgo, longAgo);
    const renameSpy = vi.spyOn(fsPromises, "rename");
    try {
      const summary = await extractZipAttachment({
        mediaDir,
        storedFileName: "shared.zip",
        archive,
      });
      expect(summary.files).toEqual([{ relativePath: "a.txt", sizeBytes: 5 }]);
      // The live directory is never renamed away.
      expect(
        renameSpy.mock.calls.some(
          ([from, to]) => from === destinationDir || to === destinationDir,
        ),
      ).toBe(false);
    } finally {
      renameSpy.mockRestore();
    }
    expect(fs.readdirSync(destinationDir)).toEqual(["a.txt"]);
    expect(fs.readdirSync(mediaDir)).toEqual(["shared-unpacked"]);
    expect(fs.statSync(destinationDir).mtimeMs).toBeGreaterThan(
      longAgo.getTime(),
    );
  });

  it("repairs an earlier extraction that is missing files", async () => {
    const archive = buildZip([
      { name: "a.txt", data: "alpha" },
      { name: "b.txt", data: "beta" },
    ]);
    const mediaDir = getDyadMediaDir(appPath);
    await extractZipAttachment({
      mediaDir,
      storedFileName: "shared.zip",
      archive,
    });
    const destinationDir = path.join(mediaDir, "shared-unpacked");
    fs.rmSync(path.join(destinationDir, "b.txt"));
    await extractZipAttachment({
      mediaDir,
      storedFileName: "shared.zip",
      archive,
    });
    expect(fs.readdirSync(destinationDir).sort()).toEqual(["a.txt", "b.txt"]);
    expect(fs.readdirSync(mediaDir)).toEqual(["shared-unpacked"]);
  });

  it("puts a damaged extraction back when its replacement cannot be installed", async () => {
    const archive = buildZip([
      { name: "a.txt", data: "alpha" },
      { name: "b.txt", data: "beta" },
    ]);
    const mediaDir = getDyadMediaDir(appPath);
    await extractZipAttachment({
      mediaDir,
      storedFileName: "shared.zip",
      archive,
    });
    const destinationDir = path.join(mediaDir, "shared-unpacked");
    fs.rmSync(path.join(destinationDir, "b.txt"));
    const longAgo = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(destinationDir, longAgo, longAgo);
    const realRename = fsPromises.rename;
    const renameSpy = vi
      .spyOn(fsPromises, "rename")
      .mockImplementation(async (from, to) => {
        if (to === destinationDir && String(from).includes(".extracting-")) {
          throw Object.assign(new Error("simulated install failure"), {
            code: "EPERM",
          });
        }
        return realRename(from, to);
      });
    try {
      await expect(
        extractZipAttachment({
          mediaDir,
          storedFileName: "shared.zip",
          archive,
        }),
      ).rejects.toThrow("simulated install failure");
    } finally {
      renameSpy.mockRestore();
    }
    // The files other chats could still read are back in place, and the
    // directory was not left looking expired to cleanup.
    expect(fs.readdirSync(destinationDir)).toEqual(["a.txt"]);
    expect(fs.readdirSync(mediaDir)).toEqual(["shared-unpacked"]);
    expect(fs.statSync(destinationDir).mtimeMs).toBeGreaterThan(
      longAgo.getTime(),
    );
  });

  it.skipIf(process.platform === "win32")(
    "replaces a symlink in place of the extraction with a real directory",
    async () => {
      const mediaDir = getDyadMediaDir(appPath);
      const elsewhere = path.join(appPath, "elsewhere");
      fs.mkdirSync(elsewhere);
      fs.writeFileSync(path.join(elsewhere, "a.txt"), "alpha");
      const longAgo = new Date("2020-01-01T00:00:00.000Z");
      fs.utimesSync(elsewhere, longAgo, longAgo);
      const destinationDir = path.join(mediaDir, "shared-unpacked");
      fs.symlinkSync(elsewhere, destinationDir);
      await extractZipAttachment({
        mediaDir,
        storedFileName: "shared.zip",
        archive: buildZip([{ name: "a.txt", data: "alpha" }]),
      });
      expect(fs.lstatSync(destinationDir).isDirectory()).toBe(true);
      expect(fs.readdirSync(destinationDir)).toEqual(["a.txt"]);
      // The link's target is never touched, not even its timestamps.
      expect(fs.readdirSync(elsewhere)).toEqual(["a.txt"]);
      expect(fs.statSync(elsewhere).mtimeMs).toBe(longAgo.getTime());
    },
  );

  it("removes the staged extraction when keeping the earlier one fails", async () => {
    const archive = buildZip([{ name: "a.txt", data: "alpha" }]);
    const mediaDir = getDyadMediaDir(appPath);
    await extractZipAttachment({
      mediaDir,
      storedFileName: "shared.zip",
      archive,
    });
    const utimesSpy = vi
      .spyOn(fsPromises, "utimes")
      .mockRejectedValue(
        Object.assign(new Error("simulated utimes failure"), { code: "EPERM" }),
      );
    try {
      await expect(
        extractZipAttachment({
          mediaDir,
          storedFileName: "shared.zip",
          archive,
        }),
      ).rejects.toThrow("simulated utimes failure");
    } finally {
      utimesSpy.mockRestore();
    }
    expect(fs.readdirSync(mediaDir)).toEqual(["shared-unpacked"]);
  });

  it("removes the staged extraction when the existing one cannot be checked", async () => {
    const mediaDir = getDyadMediaDir(appPath);
    const destinationDir = path.join(mediaDir, "fresh-unpacked");
    const realLstat = fsPromises.lstat;
    const lstatSpy = vi
      .spyOn(fsPromises, "lstat")
      .mockImplementation(async (target, ...rest) => {
        if (target === destinationDir) {
          throw Object.assign(new Error("simulated lstat failure"), {
            code: "EACCES",
          });
        }
        return realLstat(target, ...(rest as []));
      });
    try {
      await expect(
        extractZipAttachment({
          mediaDir,
          storedFileName: "fresh.zip",
          archive: buildZip([{ name: "a.txt", data: "alpha" }]),
        }),
      ).rejects.toThrow("simulated lstat failure");
    } finally {
      lstatSpy.mockRestore();
    }
    expect(fs.readdirSync(mediaDir)).toEqual([]);
  });

  it("removes the staged extraction when it cannot be moved into place", async () => {
    const mediaDir = getDyadMediaDir(appPath);
    const destinationDir = path.join(mediaDir, "fresh-unpacked");
    const realRename = fsPromises.rename;
    const renameSpy = vi
      .spyOn(fsPromises, "rename")
      .mockImplementation(async (from, to) => {
        if (to === destinationDir) {
          throw Object.assign(new Error("simulated rename failure"), {
            code: "EPERM",
          });
        }
        return realRename(from, to);
      });
    try {
      await expect(
        extractZipAttachment({
          mediaDir,
          storedFileName: "fresh.zip",
          archive: buildZip([{ name: "a.txt", data: "alpha" }]),
        }),
      ).rejects.toThrow("simulated rename failure");
    } finally {
      renameSpy.mockRestore();
    }
    expect(fs.readdirSync(mediaDir)).toEqual([]);
  });

  it("retries a move into place that is briefly blocked", async () => {
    const mediaDir = getDyadMediaDir(appPath);
    const destinationDir = path.join(mediaDir, "fresh-unpacked");
    const realRename = fsPromises.rename;
    let failures = 0;
    const renameSpy = vi
      .spyOn(fsPromises, "rename")
      .mockImplementation(async (from, to) => {
        if (to === destinationDir && failures < 2) {
          failures++;
          throw Object.assign(new Error("simulated scan lock"), {
            code: "EPERM",
          });
        }
        return realRename(from, to);
      });
    try {
      await extractZipAttachment({
        mediaDir,
        storedFileName: "fresh.zip",
        archive: buildZip([{ name: "a.txt", data: "alpha" }]),
      });
    } finally {
      renameSpy.mockRestore();
    }
    expect(failures).toBe(2);
    expect(fs.readdirSync(destinationDir)).toEqual(["a.txt"]);
    expect(fs.readdirSync(mediaDir)).toEqual(["fresh-unpacked"]);
  });

  it("keeps an extensionless upload of the same bytes intact", async () => {
    const archive = buildZip([{ name: "a.txt", data: "alpha" }]);
    const mediaDir = getDyadMediaDir(appPath);
    fs.mkdirSync(mediaDir, { recursive: true });
    // The same bytes uploaded without an extension are stored as "<hash>".
    fs.writeFileSync(path.join(mediaDir, "abc123"), archive);
    await extractZipAttachment({
      mediaDir,
      storedFileName: "abc123.zip",
      archive,
    });
    expect(fs.readFileSync(path.join(mediaDir, "abc123"))).toEqual(archive);
    expect(
      fs.readFileSync(path.join(mediaDir, "abc123-unpacked", "a.txt"), "utf8"),
    ).toBe("alpha");
  });

  it("serializes concurrent extractions of the same archive", async () => {
    const archive = buildZip([{ name: "a.txt", data: "alpha" }]);
    const mediaDir = getDyadMediaDir(appPath);
    const runs = await Promise.all(
      Array.from({ length: 4 }, () =>
        extractZipAttachment({
          mediaDir,
          storedFileName: "same.zip",
          archive,
        }),
      ),
    );
    for (const run of runs) {
      expect(run.files).toEqual([{ relativePath: "a.txt", sizeBytes: 5 }]);
    }
    expect(
      fs.readFileSync(path.join(mediaDir, "same-unpacked", "a.txt"), "utf8"),
    ).toBe("alpha");
  });
});

describe("describeSkippedArchiveEntries", () => {
  it("summarizes counts by reason", () => {
    expect(
      describeSkippedArchiveEntries({ encrypted: 2, "unsafe-path": 1 }),
    ).toBe("3 entries skipped (2 encrypted, 1 unsafe path)");
    expect(describeSkippedArchiveEntries({})).toBeNull();
  });
});
