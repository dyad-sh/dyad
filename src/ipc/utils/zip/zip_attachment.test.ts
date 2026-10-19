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

  it("restores the earlier extraction when the final swap fails", async () => {
    const mediaDir = getDyadMediaDir(appPath);
    await extractZipAttachment({
      mediaDir,
      storedFileName: "shared.zip",
      archive: buildZip([{ name: "old.txt", data: "old" }]),
    });
    const destinationDir = path.join(mediaDir, "shared-unpacked");
    const realRename = fsPromises.rename;
    const renameSpy = vi
      .spyOn(fsPromises, "rename")
      .mockImplementation(async (from, to) => {
        if (to === destinationDir && String(from).includes(".extracting-")) {
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
          storedFileName: "shared.zip",
          archive: buildZip([{ name: "new.txt", data: "new" }]),
        }),
      ).rejects.toThrow("simulated rename failure");
    } finally {
      renameSpy.mockRestore();
    }
    expect(fs.readdirSync(destinationDir)).toEqual(["old.txt"]);
    expect(fs.readdirSync(mediaDir)).toEqual(["shared-unpacked"]);
  });

  it("replaces an earlier extraction when a later attempt succeeds", async () => {
    const mediaDir = getDyadMediaDir(appPath);
    await extractZipAttachment({
      mediaDir,
      storedFileName: "shared.zip",
      archive: buildZip([{ name: "old.txt", data: "old" }]),
    });
    await extractZipAttachment({
      mediaDir,
      storedFileName: "shared.zip",
      archive: buildZip([{ name: "new.txt", data: "new" }]),
    });
    expect(fs.readdirSync(path.join(mediaDir, "shared-unpacked"))).toEqual([
      "new.txt",
    ]);
    expect(fs.readdirSync(mediaDir).sort()).toEqual(["shared-unpacked"]);
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
