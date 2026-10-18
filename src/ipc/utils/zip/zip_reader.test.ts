import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  isSupportedZipCompression,
  readZipDirectory,
  readZipEntryData,
  ZipFormatError,
  ZipLimitError,
  type ZipEntry,
} from "./zip_reader";
import { buildZip } from "./testing/zip_writer";

const FIXTURES = path.join(__dirname, "__fixtures__");

function fixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES, name));
}

function byName(entries: ZipEntry[], name: string): ZipEntry {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) {
    throw new Error(`entry not found: ${name}`);
  }
  return entry;
}

const PROJECT_FILES: Record<string, Buffer> = {
  "project/README.md": Buffer.from("# Fixture project\n"),
  "project/src/index.ts": Buffer.from("export const answer = 42;\n"),
  "project/src/util/empty.ts": Buffer.alloc(0),
  "project/assets/logo.png": Buffer.concat(
    Array.from({ length: 4 }, () =>
      Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
    ),
  ),
};

async function expectProjectFiles(archive: Buffer, entries: ZipEntry[]) {
  for (const [name, expected] of Object.entries(PROJECT_FILES)) {
    const entry = byName(entries, name);
    expect(entry.isDirectory).toBe(false);
    expect(entry.uncompressedSize).toBe(expected.length);
    expect((await readZipEntryData(archive, entry)).equals(expected)).toBe(
      true,
    );
  }
}

describe("readZipDirectory with real-tool archives", () => {
  it("reads a Python zipfile archive with a directory entry", async () => {
    const archive = fixture("python-basic.zip");
    const entries = readZipDirectory(archive);
    expect(byName(entries, "project/").isDirectory).toBe(true);
    await expectProjectFiles(archive, entries);
  });

  it("reads ZIP64 extra fields written for small entries", async () => {
    const archive = fixture("python-zip64.zip");
    await expectProjectFiles(archive, readZipDirectory(archive));
  });

  it("takes sizes from the central directory when the writer streamed with data descriptors", async () => {
    const archive = fixture("python-stream.zip");
    await expectProjectFiles(archive, readZipDirectory(archive));
  });

  it("reads an Info-ZIP archive with a comment", async () => {
    const archive = fixture("infozip-basic.zip");
    const entries = readZipDirectory(archive);
    const readme = byName(entries, "project/README.md");
    expect((await readZipEntryData(archive, readme)).toString()).toBe(
      "# Fixture project\n",
    );
    expect(byName(entries, "project/src/empty.ts").uncompressedSize).toBe(0);
  });

  it("reads a Finder-style ditto archive including the __MACOSX entries", async () => {
    const archive = fixture("ditto-finder.zip");
    const entries = readZipDirectory(archive);
    expect(entries.map((entry) => entry.name)).toContain(
      "__MACOSX/project/._README.md",
    );
    const index = byName(entries, "project/src/index.ts");
    expect((await readZipEntryData(archive, index)).toString()).toBe(
      "export const answer = 42;\n",
    );
  });

  it("flags encrypted entries and refuses to read them", async () => {
    const archive = fixture("infozip-encrypted.zip");
    const readme = byName(readZipDirectory(archive), "project/README.md");
    expect(readme.isEncrypted).toBe(true);
    await expect(readZipEntryData(archive, readme)).rejects.toThrow(
      /encrypted/,
    );
  });

  it("reports unsupported compression methods instead of inflating them", async () => {
    const archive = fixture("python-bzip2.zip");
    const readme = byName(readZipDirectory(archive), "project/README.md");
    expect(readme.compressionMethod).toBe(12);
    expect(isSupportedZipCompression(readme)).toBe(false);
    await expect(readZipEntryData(archive, readme)).rejects.toThrow(
      /unsupported compression method 12/,
    );
  });

  it("decodes UTF-8 names", () => {
    const names = readZipDirectory(fixture("python-unicode.zip")).map(
      (entry) => entry.name,
    );
    expect(names).toEqual(["docs/café — notes.md", "docs/日本語.txt"]);
  });

  it("detects Unix symlink entries", () => {
    const entries = readZipDirectory(fixture("python-hostile.zip"));
    expect(byName(entries, "link-to-etc").isSymlink).toBe(true);
    expect(byName(entries, "ok.txt").isSymlink).toBe(false);
    // Hostile names are reported verbatim; policy belongs to the extractor.
    expect(entries.map((entry) => entry.name)).toContain("../evil.txt");
  });
});

describe("readZipDirectory with synthetic archives", () => {
  it("reads stored and deflated entries", async () => {
    const archive = buildZip([
      { name: "a.txt", data: "stored", method: 0 },
      { name: "b.txt", data: "deflated".repeat(50), method: 8 },
    ]);
    const entries = readZipDirectory(archive);
    expect(
      (await readZipEntryData(archive, byName(entries, "a.txt"))).toString(),
    ).toBe("stored");
    expect(
      (await readZipEntryData(archive, byName(entries, "b.txt"))).toString(),
    ).toBe("deflated".repeat(50));
  });

  it("returns no entries for an empty archive", () => {
    expect(readZipDirectory(buildZip([]))).toEqual([]);
  });

  it("reads a deflated entry that is genuinely empty", async () => {
    const archive = buildZip([{ name: "empty.txt", data: "", method: 8 }]);
    const entry = readZipDirectory(archive)[0];
    expect(entry.uncompressedSize).toBe(0);
    expect((await readZipEntryData(archive, entry)).length).toBe(0);
  });

  it("decodes CP437 names when the UTF-8 flag is clear", () => {
    const archive = buildZip([
      {
        name: "ignored",
        rawName: Buffer.from([0x63, 0x61, 0x66, 0x82, 0x2e, 0x74, 0x78, 0x74]),
        utf8: false,
        data: "x",
      },
    ]);
    expect(readZipDirectory(archive)[0].name).toBe("café.txt");
  });

  it("prefers a matching Info-ZIP Unicode Path extra field", () => {
    const archive = buildZip([
      { name: "cafe.txt", utf8: false, unicodePathName: "café.txt", data: "x" },
    ]);
    expect(readZipDirectory(archive)[0].name).toBe("café.txt");
  });

  it("ignores a stale Unicode Path field whose CRC does not match", () => {
    const archive = buildZip([
      {
        name: "renamed.txt",
        utf8: false,
        unicodePathName: "old.txt",
        data: "x",
      },
    ]);
    // Corrupt the CRC inside the 0x7075 field so it no longer matches the name.
    const fieldIndex = archive.lastIndexOf(Buffer.from([0x75, 0x70]));
    archive.writeUInt32LE(0xdeadbeef, fieldIndex + 5);
    expect(readZipDirectory(archive)[0].name).toBe("renamed.txt");
  });

  it("reads a ZIP64 end of central directory record", async () => {
    const archive = buildZip(
      [
        { name: "a.txt", data: "alpha", zip64: true },
        { name: "b.txt", data: "beta" },
      ],
      { zip64: true },
    );
    const entries = readZipDirectory(archive);
    expect(entries.map((entry) => entry.name)).toEqual(["a.txt", "b.txt"]);
    expect((await readZipEntryData(archive, entries[0])).toString()).toBe(
      "alpha",
    );
    expect((await readZipEntryData(archive, entries[1])).toString()).toBe(
      "beta",
    );
  });

  it("handles an archive comment and a self-extractor prefix", async () => {
    const archive = buildZip([{ name: "a.txt", data: "alpha" }], {
      comment: "x".repeat(1000),
      prefix: Buffer.from("MZ this is not a real stub"),
    });
    const entries = readZipDirectory(archive);
    expect((await readZipEntryData(archive, entries[0])).toString()).toBe(
      "alpha",
    );
  });

  it("is not fooled by a fake end-of-directory record inside the comment", () => {
    // A 22-byte record declaring zero entries, embedded in the real comment.
    const fake = Buffer.alloc(22);
    fake.writeUInt32LE(0x06054b50, 0);
    const archive = buildZip([{ name: "a.txt", data: "alpha" }], {
      comment: `before ${fake.toString("latin1")} after`,
    });
    expect(readZipDirectory(archive).map((entry) => entry.name)).toEqual([
      "a.txt",
    ]);
  });

  it("still opens an archive followed by trailing junk", () => {
    const archive = Buffer.concat([
      buildZip([{ name: "a.txt", data: "alpha" }]),
      Buffer.from("trailing junk"),
    ]);
    expect(readZipDirectory(archive).map((entry) => entry.name)).toEqual([
      "a.txt",
    ]);
  });

  it("treats a trailing-slash name and the MS-DOS attribute as directories", () => {
    const archive = buildZip([
      { name: "dir", directory: true },
      { name: "file.txt", data: "x" },
    ]);
    const entries = readZipDirectory(archive);
    expect(byName(entries, "dir/").isDirectory).toBe(true);
    expect(byName(entries, "file.txt").isDirectory).toBe(false);
  });

  it("rejects archives above the entry cap before parsing headers", () => {
    const archive = buildZip([
      { name: "a", data: "1" },
      { name: "b", data: "2" },
    ]);
    expect(() => readZipDirectory(archive, { maxEntries: 1 })).toThrow(
      ZipLimitError,
    );
    expect(readZipDirectory(archive, { maxEntries: 2 })).toHaveLength(2);
  });
});

describe("readZipDirectory rejects malformed input", () => {
  it("rejects data that is not an archive", () => {
    expect(() => readZipDirectory(Buffer.from("hello"))).toThrow(
      ZipFormatError,
    );
    expect(() => readZipDirectory(Buffer.alloc(4096))).toThrow(
      /end of central directory record not found/,
    );
  });

  it("rejects a truncated archive", () => {
    const archive = buildZip([{ name: "a.txt", data: "alpha".repeat(100) }]);
    expect(() =>
      readZipDirectory(archive.subarray(0, archive.length - 10)),
    ).toThrow(ZipFormatError);
  });

  it("rejects a central directory offset outside the file", () => {
    const archive = buildZip([{ name: "a.txt", data: "alpha" }]);
    archive.writeUInt32LE(0x7fffffff, archive.length - 6);
    expect(() => readZipDirectory(archive)).toThrow(/outside the archive/);
  });

  it("rejects an entry count the central directory cannot hold", () => {
    const archive = buildZip([{ name: "a.txt", data: "alpha" }]);
    archive.writeUInt16LE(500, archive.length - 12);
    archive.writeUInt16LE(500, archive.length - 14);
    expect(() => readZipDirectory(archive)).toThrow(
      /smaller than its entry count implies/,
    );
  });

  it("rejects multi-disk archives", () => {
    const archive = buildZip([{ name: "a.txt", data: "alpha" }]);
    archive.writeUInt16LE(1, archive.length - 18);
    expect(() => readZipDirectory(archive)).toThrow(/multi-disk/);
  });

  it("rejects a bad central header signature", () => {
    const archive = buildZip([{ name: "a.txt", data: "alpha" }]);
    const centralOffset = archive.readUInt32LE(archive.length - 6);
    archive.writeUInt32LE(0, centralOffset);
    expect(() => readZipDirectory(archive)).toThrow(/signature mismatch/);
  });
});

describe("readZipEntryData rejects corrupt entries", () => {
  it("rejects a local header offset outside the file", async () => {
    const archive = buildZip([{ name: "a.txt", data: "alpha" }]);
    const entry = {
      ...readZipDirectory(archive)[0],
      localHeaderOffset: 1 << 30,
    };
    await expect(readZipEntryData(archive, entry)).rejects.toThrow(
      /outside the archive/,
    );
  });

  it("rejects a bad local header signature", async () => {
    const archive = buildZip([{ name: "a.txt", data: "alpha" }]);
    archive.writeUInt32LE(0, 0);
    const entry = readZipDirectory(archive)[0];
    await expect(readZipEntryData(archive, entry)).rejects.toThrow(
      /signature mismatch/,
    );
  });

  it("stops inflating at the declared size when an entry lies about it", async () => {
    const archive = buildZip([
      { name: "a.txt", data: "x".repeat(10_000), declaredUncompressedSize: 10 },
    ]);
    const entry = readZipDirectory(archive)[0];
    await expect(readZipEntryData(archive, entry)).rejects.toThrow(
      /could not be decompressed/,
    );
  });

  it("rejects a non-empty stream declared as empty", async () => {
    const archive = buildZip([
      { name: "a.txt", data: "not empty", declaredUncompressedSize: 0 },
    ]);
    const entry = readZipDirectory(archive)[0];
    await expect(readZipEntryData(archive, entry)).rejects.toThrow(
      /could not be decompressed/,
    );
  });

  it("rejects an entry whose data decompresses to fewer bytes than declared", async () => {
    const archive = buildZip([
      { name: "a.txt", data: "short", declaredUncompressedSize: 50 },
    ]);
    const entry = readZipDirectory(archive)[0];
    await expect(readZipEntryData(archive, entry)).rejects.toThrow(
      /expected 50/,
    );
  });

  it("rejects an entry that fails its CRC check", async () => {
    const archive = buildZip([
      { name: "a.txt", data: "alpha", declaredCrc32: zlib.crc32("beta") },
    ]);
    const entry = readZipDirectory(archive)[0];
    await expect(readZipEntryData(archive, entry)).rejects.toThrow(/CRC-32/);
  });

  it("rejects corrupt deflate streams", async () => {
    const archive = buildZip([{ name: "a.txt", data: "alpha".repeat(20) }]);
    const entry = readZipDirectory(archive)[0];
    // 0xff sets a reserved block type, which zlib rejects outright.
    const dataOffset = 30 + "a.txt".length;
    archive.fill(0xff, dataOffset, dataOffset + 4);
    await expect(readZipEntryData(archive, entry)).rejects.toThrow(
      /could not be decompressed/,
    );
  });
});
