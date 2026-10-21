import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendAttachmentManifestEntriesWithLogicalNames,
  appendAttachmentManifestEntryGroups,
  createUniqueAttachmentLogicalName,
  getAttachmentsManifestPath,
  getDyadMediaDir,
  listAttachmentLogicalPaths,
  listStoredAttachments,
  pruneAttachmentManifest,
  removeUnreferencedMediaPaths,
  reserveMediaPath,
  resolveAttachmentLogicalPath,
  resolveStoredFilePath,
} from "./media_path_utils";

describe("createUniqueAttachmentLogicalName", () => {
  it("keeps a collision suffix within the segment limit", () => {
    const used = new Set<string>();
    const longName = `${"a".repeat(150)}.${"b".repeat(5)}.zip`;
    const first = createUniqueAttachmentLogicalName(longName, used);
    const second = createUniqueAttachmentLogicalName(longName, used);
    expect(first).toBe(longName);
    expect(second).toHaveLength(160);
    expect(second.endsWith("-2.zip")).toBe(true);
    // An archive's entries re-normalize the parent name; it must survive.
    expect(
      createUniqueAttachmentLogicalName(`${second}/a.txt`, new Set(), {
        nested: true,
      }),
    ).toBe(`${second}/a.txt`);
  });

  it("keeps a suffixed name within the limit even with a long extension", () => {
    const used = new Set<string>();
    const longExtension = `a.${"b".repeat(158)}`;
    createUniqueAttachmentLogicalName(longExtension, used);
    const second = createUniqueAttachmentLogicalName(longExtension, used);
    expect(second.length).toBeLessThanOrEqual(160);
    expect(used.has(second)).toBe(true);
    expect(
      createUniqueAttachmentLogicalName(`${second}/a.txt`, new Set(), {
        nested: true,
      }),
    ).toBe(`${second}/a.txt`);
  });

  it("hands out increasing suffixes and skips ones already taken", () => {
    const used = new Set(["notes-3.txt"]);
    const names = Array.from({ length: 5 }, () =>
      createUniqueAttachmentLogicalName("notes.txt", used),
    );
    expect(names).toEqual([
      "notes.txt",
      "notes-2.txt",
      "notes-4.txt",
      "notes-5.txt",
      "notes-6.txt",
    ]);
  });

  it("reduces upload names to their final segment", () => {
    expect(
      createUniqueAttachmentLogicalName("dir/sub/notes.txt", new Set()),
    ).toBe("notes.txt");
  });

  it("keeps directory segments for nested names", () => {
    expect(
      createUniqueAttachmentLogicalName("proj.zip/src/index.ts", new Set(), {
        nested: true,
      }),
    ).toBe("proj.zip/src/index.ts");
  });

  it("sanitizes every segment of a nested name", () => {
    expect(
      createUniqueAttachmentLogicalName(
        "a<b>.zip\\sub:dir/../x`y.ts",
        new Set(),
        {
          nested: true,
        },
      ),
    ).toBe("a_b_.zip/sub_dir/x_y.ts");
  });

  it("suffixes a nested name that collides", () => {
    const used = new Set(["proj.zip/src/index.ts"]);
    expect(
      createUniqueAttachmentLogicalName("proj.zip/src/index.ts", used, {
        nested: true,
      }),
    ).toBe("proj.zip/src/index-2.ts");
  });
});

describe("resolveStoredFilePath", () => {
  const mediaDir = path.join("/apps", "demo", ".dyad", "media");

  it("resolves plain and nested stored names inside the media directory", () => {
    expect(resolveStoredFilePath(mediaDir, "abc.png")).toBe(
      path.join(mediaDir, "abc.png"),
    );
    expect(resolveStoredFilePath(mediaDir, "abc/src/index.ts")).toBe(
      path.join(mediaDir, "abc", "src", "index.ts"),
    );
  });

  it("refuses names that could leave the media directory", () => {
    for (const name of [
      "../x",
      "a/../x",
      "/abs",
      "a//b",
      "a\\b",
      ".",
      "a/.",
      "a\u0000",
    ]) {
      expect(resolveStoredFilePath(mediaDir, name)).toBeNull();
    }
  });
});

describe("manifest with extracted archive entries", () => {
  let appPath: string;

  beforeEach(() => {
    appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-manifest-"));
  });

  afterEach(() => {
    fs.rmSync(appPath, { recursive: true, force: true });
  });

  function writeStored(relative: string, content: string) {
    const filePath = path.join(
      getDyadMediaDir(appPath),
      ...relative.split("/"),
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  it("resolves nested logical names to extracted files and prunes them when gone", async () => {
    writeStored("hash.zip", "zipbytes");
    writeStored("hash/src/index.ts", "export {};");
    const [archive] = await appendAttachmentManifestEntriesWithLogicalNames(
      appPath,
      [
        {
          requestedLogicalName: "proj.zip",
          originalName: "proj.zip",
          storedFileName: "hash.zip",
          mimeType: "application/zip",
          sizeBytes: 8,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    );
    expect(archive.logicalName).toBe("proj.zip");
    await appendAttachmentManifestEntriesWithLogicalNames(appPath, [
      {
        requestedLogicalName: "proj.zip/src/index.ts",
        nestedLogicalName: true,
        originalName: "src/index.ts",
        storedFileName: "hash/src/index.ts",
        mimeType: "text/typescript",
        sizeBytes: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        archiveLogicalName: "proj.zip",
      },
    ]);

    const resolved = await resolveAttachmentLogicalPath(
      appPath,
      "attachments:proj.zip/src/index.ts",
    );
    expect(resolved?.filePath).toBe(
      path.join(getDyadMediaDir(appPath), "hash", "src", "index.ts"),
    );
    expect(resolved?.archiveLogicalName).toBe("proj.zip");
    expect(
      (await listStoredAttachments(appPath)).map((a) => a.logicalName),
    ).toEqual(["proj.zip", "proj.zip/src/index.ts"]);

    fs.rmSync(path.join(getDyadMediaDir(appPath), "hash"), { recursive: true });
    expect(await pruneAttachmentManifest(appPath)).toBe(1);
    expect(
      (await listStoredAttachments(appPath)).map((a) => a.logicalName),
    ).toEqual(["proj.zip"]);
  });

  it("parses the manifest once while it is unchanged", async () => {
    writeStored("a.txt", "a");
    writeStored("b.txt", "b");
    const entry = (name: string) => ({
      requestedLogicalName: name,
      originalName: name,
      storedFileName: name,
      mimeType: "text/plain",
      sizeBytes: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await appendAttachmentManifestEntriesWithLogicalNames(appPath, [
      entry("a.txt"),
    ]);
    const manifestPath = getAttachmentsManifestPath(appPath);
    const readSpy = vi.spyOn(fsPromises, "readFile");
    const manifestReads = () =>
      readSpy.mock.calls.filter(([target]) => String(target) === manifestPath)
        .length;
    try {
      for (let i = 0; i < 3; i++) {
        expect(
          (await resolveAttachmentLogicalPath(appPath, "attachments:a.txt"))
            ?.logicalName,
        ).toBe("a.txt");
      }
      expect(manifestReads()).toBe(1);

      // A write through the manifest helpers is picked up.
      await appendAttachmentManifestEntriesWithLogicalNames(appPath, [
        entry("b.txt"),
      ]);
      expect(
        (await resolveAttachmentLogicalPath(appPath, "attachments:b.txt"))
          ?.logicalName,
      ).toBe("b.txt");

      // So is a change made to the file directly.
      fs.writeFileSync(manifestPath, "[]");
      expect(
        await resolveAttachmentLogicalPath(appPath, "attachments:a.txt"),
      ).toBeNull();
    } finally {
      readSpy.mockRestore();
    }
  });

  it("shares one manifest parse between concurrent lookups", async () => {
    writeStored("a.txt", "a");
    await appendAttachmentManifestEntriesWithLogicalNames(appPath, [
      {
        requestedLogicalName: "a.txt",
        originalName: "a.txt",
        storedFileName: "a.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const manifestPath = getAttachmentsManifestPath(appPath);
    const readSpy = vi.spyOn(fsPromises, "readFile");
    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          resolveAttachmentLogicalPath(appPath, "attachments:a.txt"),
        ),
      );
      expect(results.every((r) => r?.logicalName === "a.txt")).toBe(true);
      expect(
        readSpy.mock.calls.filter(
          ([target]) => String(target) === manifestPath,
        ),
      ).toHaveLength(1);
    } finally {
      readSpy.mockRestore();
    }
  });

  it("prunes entries whose archive is gone even if their files remain", async () => {
    writeStored("notes.txt", "n");
    writeStored("hash/a.txt", "a");
    await appendAttachmentManifestEntriesWithLogicalNames(appPath, [
      {
        requestedLogicalName: "notes.txt",
        originalName: "notes.txt",
        storedFileName: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        requestedLogicalName: "proj.zip",
        originalName: "proj.zip",
        storedFileName: "hash.zip",
        mimeType: "application/zip",
        sizeBytes: 8,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        requestedLogicalName: "proj.zip/a.txt",
        nestedLogicalName: true,
        originalName: "a.txt",
        storedFileName: "hash/a.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        archiveLogicalName: "proj.zip",
      },
    ]);

    // hash.zip was never written, as if cleanup removed it.
    expect(await pruneAttachmentManifest(appPath)).toBe(2);
    expect(
      (await listStoredAttachments(appPath)).map((a) => a.logicalName),
    ).toEqual(["notes.txt"]);
  });

  it("registers entries under their parent's final name in one write", async () => {
    writeStored("first.zip", "zipbytes");
    writeStored("second.zip", "zipbytes2");
    writeStored("second/a.txt", "a");
    await appendAttachmentManifestEntriesWithLogicalNames(appPath, [
      {
        requestedLogicalName: "proj.zip",
        originalName: "proj.zip",
        storedFileName: "first.zip",
        mimeType: "application/zip",
        sizeBytes: 8,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const archiveInput = {
      requestedLogicalName: "proj.zip",
      originalName: "proj.zip",
      storedFileName: "second.zip",
      mimeType: "application/zip",
      sizeBytes: 9,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const childFor = (parent: string) => ({
      requestedLogicalName: `${parent}/a.txt`,
      nestedLogicalName: true,
      originalName: "a.txt",
      storedFileName: "second/a.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      archiveLogicalName: parent,
    });

    // Nothing is written when building the children fails.
    await expect(
      appendAttachmentManifestEntryGroups(appPath, [archiveInput], () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(
      (await listStoredAttachments(appPath)).map((a) => a.logicalName),
    ).toEqual(["proj.zip"]);

    const { entries, childEntries } = await appendAttachmentManifestEntryGroups(
      appPath,
      [archiveInput],
      (finalized) => finalized.map((entry) => [childFor(entry.logicalName)]),
    );
    expect(entries.map((entry) => entry.logicalName)).toEqual(["proj-2.zip"]);
    expect(
      childEntries.map((group) => group.map((e) => e.logicalName)),
    ).toEqual([["proj-2.zip/a.txt"]]);
    expect(
      (await listStoredAttachments(appPath)).map((a) => a.logicalName),
    ).toEqual(["proj.zip", "proj-2.zip", "proj-2.zip/a.txt"]);
  });

  it("checks only the entries under the archive being listed", async () => {
    writeStored("one/a.txt", "a");
    writeStored("two/b.txt", "b");
    const entry = (archive: string, stored: string, name: string) => ({
      requestedLogicalName: `${archive}/${name}`,
      nestedLogicalName: true,
      originalName: name,
      storedFileName: stored,
      mimeType: "text/plain",
      sizeBytes: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      archiveLogicalName: archive,
    });
    await appendAttachmentManifestEntriesWithLogicalNames(appPath, [
      entry("one.zip", "one/a.txt", "a.txt"),
      entry("two.zip", "two/b.txt", "b.txt"),
    ]);
    const statSpy = vi.spyOn(fsPromises, "stat");
    try {
      expect(
        await listAttachmentLogicalPaths(appPath, "attachments:one.zip"),
      ).toEqual(["attachments:one.zip/a.txt"]);
      const statted = statSpy.mock.calls.map(([target]) => String(target));
      expect(
        statted.some((target) => target.endsWith(path.join("two", "b.txt"))),
      ).toBe(false);
      expect(
        statted.some((target) => target.endsWith(path.join("one", "a.txt"))),
      ).toBe(true);
    } finally {
      statSpy.mockRestore();
    }
  });

  it("lists every entry in manifest order across stat batches", async () => {
    // Reverse order, so manifest order differs from sorted order.
    const names = Array.from(
      { length: 70 },
      (_, i) => `f${String(69 - i).padStart(2, "0")}.txt`,
    );
    for (const name of names) {
      if (name !== "f20.txt") {
        writeStored(`many/${name}`, "x");
      }
    }
    await appendAttachmentManifestEntriesWithLogicalNames(
      appPath,
      names.map((name) => ({
        requestedLogicalName: `many.zip/${name}`,
        nestedLogicalName: true,
        originalName: name,
        storedFileName: `many/${name}`,
        mimeType: "text/plain",
        sizeBytes: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        archiveLogicalName: "many.zip",
      })),
    );
    expect(
      (
        await listStoredAttachments(appPath, { logicalNamePrefix: "many.zip/" })
      ).map((a) => a.logicalName),
    ).toEqual(
      names
        .filter((name) => name !== "f20.txt")
        .map((name) => `many.zip/${name}`),
    );
  });

  it("removes only media that no manifest entry references", async () => {
    writeStored("orphan.zip", "zipbytes");
    writeStored("orphan/a.txt", "a");
    writeStored("claimed.zip", "zipbytes");
    writeStored("claimed/a.txt", "a");
    await appendAttachmentManifestEntriesWithLogicalNames(appPath, [
      {
        requestedLogicalName: "claimed.zip",
        originalName: "claimed.zip",
        storedFileName: "claimed.zip",
        mimeType: "application/zip",
        sizeBytes: 8,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        requestedLogicalName: "claimed.zip/a.txt",
        nestedLogicalName: true,
        originalName: "a.txt",
        storedFileName: "claimed/a.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        archiveLogicalName: "claimed.zip",
      },
    ]);
    const mediaDir = getDyadMediaDir(appPath);
    const removed = await removeUnreferencedMediaPaths(appPath, [
      path.join(mediaDir, "orphan.zip"),
      path.join(mediaDir, "orphan"),
      path.join(mediaDir, "claimed.zip"),
      path.join(mediaDir, "claimed"),
    ]);
    expect(removed.map((p) => path.basename(p)).sort()).toEqual([
      "orphan",
      "orphan.zip",
    ]);
    expect(fs.readdirSync(mediaDir).sort()).toEqual([
      "attachments-manifest.json",
      "claimed",
      "claimed.zip",
    ]);
  });

  it("keeps media another turn has reserved but not yet registered", async () => {
    writeStored("inflight.zip", "zipbytes");
    writeStored("inflight/a.txt", "a");
    const mediaDir = getDyadMediaDir(appPath);
    const release = reserveMediaPath(path.join(mediaDir, "inflight"));
    const releaseAgain = reserveMediaPath(path.join(mediaDir, "inflight"));
    releaseAgain();
    expect(
      await removeUnreferencedMediaPaths(appPath, [
        path.join(mediaDir, "inflight.zip"),
        path.join(mediaDir, "inflight"),
      ]),
    ).toEqual([path.join(mediaDir, "inflight.zip")]);
    expect(fs.existsSync(path.join(mediaDir, "inflight", "a.txt"))).toBe(true);

    release();
    release();
    expect(
      await removeUnreferencedMediaPaths(appPath, [
        path.join(mediaDir, "inflight"),
      ]),
    ).toEqual([path.join(mediaDir, "inflight")]);
    expect(fs.existsSync(path.join(mediaDir, "inflight"))).toBe(false);
  });

  it("ignores manifest entries whose stored name could escape the media directory", async () => {
    const manifestPath = path.join(
      getDyadMediaDir(appPath),
      "attachments-manifest.json",
    );
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      JSON.stringify([
        {
          logicalName: "evil",
          originalName: "evil",
          storedFileName: "../../etc/passwd",
          mimeType: "text/plain",
          sizeBytes: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );
    expect(
      await resolveAttachmentLogicalPath(appPath, "attachments:evil"),
    ).toBeNull();
    expect(await listStoredAttachments(appPath)).toEqual([]);
  });
});
