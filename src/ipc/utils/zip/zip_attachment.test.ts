import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendAttachmentManifestEntriesWithLogicalNames,
  getDyadMediaDir,
} from "../media_path_utils";
import { buildZip } from "./testing/zip_writer";
import {
  buildArchiveManifestEntries,
  describeSkippedArchiveEntries,
  extractZipAttachment,
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
      { name: ".env", data: "SECRET=1" },
    ]);
    const mediaDir = getDyadMediaDir(appPath);
    const summary = await extractZipAttachment({
      mediaDir,
      storedFileName: "abc123.zip",
      archive,
      excludeDotenvFiles: true,
    });
    expect(summary.extractedDirName).toBe("abc123");
    expect(summary.files.map((file) => file.relativePath)).toEqual(["a.txt"]);
    expect(summary.skipped).toEqual({ excluded: 1 });
    expect(fs.existsSync(path.join(mediaDir, "abc123", "a.txt"))).toBe(true);

    await expect(
      extractZipAttachment({
        mediaDir,
        storedFileName: "abc123.zip",
        archive,
        excludeDotenvFiles: false,
        limits: { maxTotalUncompressedBytes: 100 },
      }),
    ).rejects.toThrow(ZipLimitError);
    // The failed attempt leaves the earlier extraction untouched.
    expect(
      fs.readFileSync(path.join(mediaDir, "abc123", "a.txt"), "utf8"),
    ).toBe("x".repeat(600));
    // No staging or retired directories are left behind.
    expect(fs.readdirSync(mediaDir).sort()).toEqual(["abc123"]);
  });

  it("fails cleanly when there is no earlier extraction", async () => {
    const mediaDir = getDyadMediaDir(appPath);
    await expect(
      extractZipAttachment({
        mediaDir,
        storedFileName: "fresh.zip",
        archive: buildZip([{ name: "a.txt", data: "x".repeat(600) }]),
        excludeDotenvFiles: false,
        limits: { maxTotalUncompressedBytes: 100 },
      }),
    ).rejects.toThrow(ZipLimitError);
    expect(fs.readdirSync(mediaDir)).toEqual([]);
  });

  it("replaces an earlier extraction when a later attempt succeeds", async () => {
    const mediaDir = getDyadMediaDir(appPath);
    await extractZipAttachment({
      mediaDir,
      storedFileName: "shared.zip",
      archive: buildZip([{ name: "old.txt", data: "old" }]),
      excludeDotenvFiles: false,
    });
    await extractZipAttachment({
      mediaDir,
      storedFileName: "shared.zip",
      archive: buildZip([{ name: "new.txt", data: "new" }]),
      excludeDotenvFiles: false,
    });
    expect(fs.readdirSync(path.join(mediaDir, "shared"))).toEqual(["new.txt"]);
    expect(fs.readdirSync(mediaDir).sort()).toEqual(["shared"]);
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
          excludeDotenvFiles: false,
        }),
      ),
    );
    for (const run of runs) {
      expect(run.files).toEqual([{ relativePath: "a.txt", sizeBytes: 5 }]);
    }
    expect(fs.readFileSync(path.join(mediaDir, "same", "a.txt"), "utf8")).toBe(
      "alpha",
    );
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
