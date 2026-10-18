import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  extractZipArchive,
  toSafeZipSegments,
  ZipLimitError,
  type ZipExtractionResult,
} from "./zip_extract";
import { ZipFormatError } from "./zip_reader";
import { buildZip } from "./testing/zip_writer";

const FIXTURES = path.join(__dirname, "__fixtures__");

function fixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES, name));
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out.push(path.relative(dir, full).split(path.sep).join("/"));
      }
    }
  };
  walk(dir);
  return out.sort();
}

function skippedByReason(result: ZipExtractionResult) {
  const byReason: Record<string, string[]> = {};
  for (const { name, reason } of result.skipped) {
    (byReason[reason] ??= []).push(name);
  }
  return byReason;
}

describe("extractZipArchive", () => {
  let root: string;
  let dest: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-zip-extract-"));
    dest = path.join(root, "out");
    fs.mkdirSync(dest);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("extracts a project archive and strips its single root folder", async () => {
    const result = await extractZipArchive(fixture("python-basic.zip"), dest);
    expect(result.strippedRootDir).toBe("project");
    expect(result.skipped).toEqual([]);
    expect(listFiles(dest)).toEqual([
      "README.md",
      "assets/logo.png",
      "src/index.ts",
      "src/util/empty.ts",
    ]);
    expect(fs.readFileSync(path.join(dest, "src/index.ts"), "utf8")).toBe(
      "export const answer = 42;\n",
    );
    expect(result.files).toContainEqual({
      relativePath: "src/util/empty.ts",
      sizeBytes: 0,
    });
    expect(result.totalBytes).toBe(
      result.files.reduce((sum, file) => sum + file.sizeBytes, 0),
    );
  });

  it("drops Finder resource forks and still unwraps the root folder", async () => {
    const result = await extractZipArchive(fixture("ditto-finder.zip"), dest);
    expect(result.strippedRootDir).toBe("project");
    expect(skippedByReason(result)).toEqual({
      ignored: ["__MACOSX/project/._README.md"],
    });
    expect(listFiles(dest)).toEqual([
      "README.md",
      "src/empty.ts",
      "src/index.ts",
    ]);
  });

  it("extracts streamed and ZIP64 archives", async () => {
    for (const name of [
      "python-stream.zip",
      "python-zip64.zip",
      "infozip-basic.zip",
    ]) {
      const target = path.join(root, name);
      fs.mkdirSync(target);
      const result = await extractZipArchive(fixture(name), target);
      expect(result.skipped).toEqual([]);
      expect(listFiles(target)).toContain("src/index.ts");
    }
  });

  it("never writes outside the destination for hostile entry names", async () => {
    const result = await extractZipArchive(fixture("python-hostile.zip"), dest);
    expect(skippedByReason(result)).toEqual({
      "unsafe-path": [
        "../evil.txt",
        "/abs.txt",
        "sub/../../up.txt",
        "nested/../sibling.txt",
      ],
      symlink: ["link-to-etc"],
      ignored: ["__MACOSX/._ok.txt", "node_modules/pkg/index.js"],
    });
    expect(listFiles(dest)).toEqual([".env", "ok.txt"]);
    // Nothing escaped into the parent of the destination.
    expect(fs.readdirSync(root)).toEqual(["out"]);
    expect(result.strippedRootDir).toBeNull();
  });

  it("applies the caller's exclusion predicate", async () => {
    const result = await extractZipArchive(
      fixture("python-hostile.zip"),
      dest,
      {
        exclude: (relativePath) =>
          path.basename(relativePath).startsWith(".env"),
      },
    );
    expect(skippedByReason(result).excluded).toEqual([".env"]);
    expect(listFiles(dest)).toEqual(["ok.txt"]);
  });

  it("skips encrypted entries with a reason", async () => {
    const result = await extractZipArchive(
      fixture("infozip-encrypted.zip"),
      dest,
    );
    expect(result.files).toEqual([]);
    expect(new Set(result.skipped.map((entry) => entry.reason))).toEqual(
      new Set(["encrypted"]),
    );
    expect(listFiles(dest)).toEqual([]);
  });

  it("skips entries with unsupported compression", async () => {
    const result = await extractZipArchive(fixture("python-bzip2.zip"), dest);
    expect(result.files).toEqual([]);
    expect(new Set(result.skipped.map((entry) => entry.reason))).toEqual(
      new Set(["unsupported-compression"]),
    );
  });

  it("keeps top-level files in place when there is no single root folder", async () => {
    const archive = buildZip([
      { name: "a/one.txt", data: "1" },
      { name: "two.txt", data: "2" },
    ]);
    const result = await extractZipArchive(archive, dest);
    expect(result.strippedRootDir).toBeNull();
    expect(listFiles(dest)).toEqual(["a/one.txt", "two.txt"]);
  });

  it("does not strip a root folder that is the only file", async () => {
    const archive = buildZip([{ name: "only.txt", data: "1" }]);
    const result = await extractZipArchive(archive, dest);
    expect(result.strippedRootDir).toBeNull();
    expect(listFiles(dest)).toEqual(["only.txt"]);
  });

  it("normalizes backslash separators and redundant segments", async () => {
    const archive = buildZip([
      { name: "dir\\sub\\file.txt", data: "1" },
      { name: "./dir//other.txt", data: "2" },
    ]);
    const result = await extractZipArchive(archive, dest);
    expect(result.strippedRootDir).toBe("dir");
    expect(listFiles(dest)).toEqual(["other.txt", "sub/file.txt"]);
  });

  it("rejects Windows drive paths and over-deep paths", async () => {
    const deep =
      Array.from({ length: 40 }, (_, i) => `d${i}`).join("/") + "/f.txt";
    const archive = buildZip([
      { name: "C:/windows/system32/evil.dll", data: "1" },
      { name: deep, data: "2" },
      { name: "fine.txt", data: "3" },
    ]);
    const result = await extractZipArchive(archive, dest);
    expect(skippedByReason(result)["unsafe-path"]).toEqual([
      "C:/windows/system32/evil.dll",
      deep,
    ]);
    expect(listFiles(dest)).toEqual(["fine.txt"]);
  });

  it("lets a later duplicate entry win and lists the path once", async () => {
    const archive = buildZip([
      { name: "dup.txt", data: "first" },
      { name: "dup.txt", data: "second" },
    ]);
    const result = await extractZipArchive(archive, dest);
    expect(result.files).toEqual([{ relativePath: "dup.txt", sizeBytes: 6 }]);
    expect(fs.readFileSync(path.join(dest, "dup.txt"), "utf8")).toBe("second");
  });

  it("skips entries the host filesystem cannot hold instead of failing", async () => {
    const archive = buildZip([
      { name: "shared", data: "a file" },
      { name: "shared/child.txt", data: "needs shared to be a directory" },
      { name: "fine.txt", data: "ok" },
    ]);
    const result = await extractZipArchive(archive, dest);
    expect(skippedByReason(result)).toEqual({
      unwritable: ["shared/child.txt"],
    });
    expect(listFiles(dest)).toEqual(["fine.txt", "shared"]);
  });

  it("enforces the entry count limit before writing anything", async () => {
    const archive = buildZip(
      Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, data: "x" })),
    );
    await expect(
      extractZipArchive(archive, dest, { limits: { maxEntries: 4 } }),
    ).rejects.toThrow(ZipLimitError);
    expect(listFiles(dest)).toEqual([]);
  });

  it("enforces the declared total size limit before writing anything", async () => {
    const archive = buildZip([
      { name: "big.txt", data: "x".repeat(2_000) },
      { name: "small.txt", data: "y" },
    ]);
    await expect(
      extractZipArchive(archive, dest, {
        limits: { maxTotalUncompressedBytes: 1_000 },
      }),
    ).rejects.toThrow(/would expand to 2001 bytes/);
    expect(listFiles(dest)).toEqual([]);
  });

  it("surfaces reader errors for archives that are not readable", async () => {
    await expect(extractZipArchive(Buffer.from("nope"), dest)).rejects.toThrow(
      ZipFormatError,
    );
  });

  it("surfaces an entry that lies about its size", async () => {
    const archive = buildZip([
      {
        name: "liar.txt",
        data: "x".repeat(5_000),
        declaredUncompressedSize: 5,
      },
    ]);
    await expect(extractZipArchive(archive, dest)).rejects.toThrow(
      ZipFormatError,
    );
  });
});

describe("toSafeZipSegments", () => {
  it("accepts ordinary nested names", () => {
    expect(toSafeZipSegments("a/b/c.txt", 32)).toEqual(["a", "b", "c.txt"]);
  });

  it("rejects traversal, absolute, drive, control-character and empty names", () => {
    for (const name of [
      "../x",
      "a/../../x",
      "/x",
      "C:\\x",
      "a\u0000b",
      "",
      "./",
      "a/..",
      "x".repeat(300),
    ]) {
      expect(toSafeZipSegments(name, 32)).toBeNull();
    }
  });
});
