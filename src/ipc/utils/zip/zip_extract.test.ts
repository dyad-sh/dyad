import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  extractZipArchive,
  toSafeZipSegments,
  ZipLimitError,
  type ZipExtractionResult,
} from "./zip_extract";
import { ZipFormatError } from "./zip_reader";
import { buildZip } from "./testing/zip_writer";

// Lets a test act right after an entry has been inflated.
const inflateHook = vi.hoisted(() => ({
  after: null as null | (() => void),
}));
vi.mock("./zip_reader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./zip_reader")>();
  return {
    ...actual,
    readZipEntryData: async (
      ...args: Parameters<typeof actual.readZipEntryData>
    ) => {
      const data = await actual.readZipEntryData(...args);
      inflateHook.after?.();
      return data;
    },
  };
});

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

  it("rejects names Windows cannot hold as regular files, on every platform", async () => {
    const archive = buildZip([
      { name: "CON", data: "device" },
      { name: "logs/nul.txt", data: "device with extension" },
      { name: "com1.js", data: "serial port" },
      { name: "README.md:hidden", data: "alternate stream" },
      { name: "trailing./x.txt", data: "stripped dot" },
      { name: "notes.txt ", data: "stripped space" },
      { name: "what?.md", data: "question mark" },
      { name: 'a"b/c.txt', data: "quote in a directory" },
      { name: "x<y>|*.txt", data: "angle brackets, pipe and star" },
      { name: "console.ts", data: "fine, not a reserved name" },
      { name: "nulls/ok.txt", data: "fine, directory is not reserved" },
    ]);
    const result = await extractZipArchive(archive, dest);
    expect(skippedByReason(result)["unsafe-path"]).toEqual([
      "CON",
      "logs/nul.txt",
      "com1.js",
      "README.md:hidden",
      "trailing./x.txt",
      "notes.txt ",
      "what?.md",
      'a"b/c.txt',
      "x<y>|*.txt",
    ]);
    expect(listFiles(dest)).toEqual(["console.ts", "nulls/ok.txt"]);
  });

  it("extracts names that merely start with two dots", async () => {
    const archive = buildZip([
      { name: "..config", data: "1" },
      { name: "src/..hidden.ts", data: "2" },
    ]);
    const result = await extractZipArchive(archive, dest);
    expect(result.skipped).toEqual([]);
    expect(listFiles(dest)).toEqual(["..config", "src/..hidden.ts"]);
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

  it("never lists two case-variant names that share one file", async () => {
    const archive = buildZip([
      { name: "README.md", data: "upper" },
      { name: "readme.md", data: "lower!" },
    ]);
    const result = await extractZipArchive(archive, dest);
    // Case-sensitive hosts keep both; case-insensitive ones skip the second.
    for (const file of result.files) {
      expect(fs.statSync(path.join(dest, file.relativePath)).size).toBe(
        file.sizeBytes,
      );
    }
    expect(result.files.length + result.skipped.length).toBe(2);
    expect(listFiles(dest)).toHaveLength(result.files.length);
  });

  it("skips a new path that already exists instead of overwriting it", async () => {
    // Stands in for a case-insensitive host, where readme.md opens README.md.
    const realWriteFile = fsPromises.writeFile;
    const writeSpy = vi
      .spyOn(fsPromises, "writeFile")
      .mockImplementation(async (file, data, options) => {
        if (
          String(file).endsWith("readme.md") &&
          typeof options === "object" &&
          options?.flag === "wx"
        ) {
          throw Object.assign(new Error("exists"), { code: "EEXIST" });
        }
        return realWriteFile(file, data, options);
      });
    try {
      const result = await extractZipArchive(
        buildZip([
          { name: "README.md", data: "upper" },
          { name: "readme.md", data: "lower!" },
        ]),
        dest,
      );
      expect(result.files).toEqual([
        { relativePath: "README.md", sizeBytes: 5 },
      ]);
      expect(skippedByReason(result)).toEqual({ unwritable: ["readme.md"] });
    } finally {
      writeSpy.mockRestore();
    }
    expect(fs.readFileSync(path.join(dest, "README.md"), "utf8")).toBe("upper");
  });

  it.skipIf(process.platform === "win32")(
    "keeps execute bits from Unix-made entries",
    async () => {
      const archive = buildZip([
        { name: "gradlew", data: "#!/bin/sh\n", unixMode: 0o100755 },
        { name: "README.md", data: "docs", unixMode: 0o100644 },
      ]);
      await extractZipArchive(archive, dest);
      expect(fs.statSync(path.join(dest, "gradlew")).mode & 0o111).not.toBe(0);
      expect(fs.statSync(path.join(dest, "README.md")).mode & 0o111).toBe(0);
    },
  );

  it.skipIf(process.platform === "win32")(
    "gives a repeated path the mode of the entry that wins",
    async () => {
      const archive = buildZip([
        { name: "run.sh", data: "old", unixMode: 0o100755 },
        { name: "run.sh", data: "new", unixMode: 0o100644 },
      ]);
      await extractZipArchive(archive, dest);
      const filePath = path.join(dest, "run.sh");
      expect(fs.readFileSync(filePath, "utf8")).toBe("new");
      expect(fs.statSync(filePath).mode & 0o111).toBe(0);
    },
  );

  it("still extracts a file when its mode cannot be changed", async () => {
    const chmodSpy = vi
      .spyOn(fsPromises, "chmod")
      .mockRejectedValue(
        Object.assign(new Error("operation not permitted"), { code: "EPERM" }),
      );
    try {
      const result = await extractZipArchive(
        buildZip([
          { name: "gradlew", data: "#!/bin/sh\n", unixMode: 0o100755 },
        ]),
        dest,
      );
      expect(result.files).toEqual([
        { relativePath: "gradlew", sizeBytes: 10 },
      ]);
      expect(chmodSpy).toHaveBeenCalled();
    } finally {
      chmodSpy.mockRestore();
    }
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

  it("stops between entries when the signal aborts mid-extraction", async () => {
    const archive = buildZip([
      { name: "first.txt", data: "1" },
      { name: "second.txt", data: "2" },
    ]);
    const controller = new AbortController();
    const realWriteFile = fsPromises.writeFile;
    const writeSpy = vi
      .spyOn(fsPromises, "writeFile")
      .mockImplementation(async (...args) => {
        await realWriteFile(...args);
        controller.abort();
      });
    try {
      await expect(
        extractZipArchive(archive, dest, { signal: controller.signal }),
      ).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      writeSpy.mockRestore();
    }
    expect(listFiles(dest)).toEqual(["first.txt"]);
  });

  it("stops before writing an entry when the signal aborts while it inflates", async () => {
    const archive = buildZip([
      { name: "dir/big.txt", data: "x".repeat(10_000) },
    ]);
    const controller = new AbortController();
    inflateHook.after = () => controller.abort();
    const writeSpy = vi.spyOn(fsPromises, "writeFile");
    try {
      await expect(
        extractZipArchive(archive, dest, { signal: controller.signal }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(writeSpy).not.toHaveBeenCalled();
    } finally {
      inflateHook.after = null;
      writeSpy.mockRestore();
    }
    expect(fs.readdirSync(dest)).toEqual([]);
  });

  it("counts only files to extract against the entry limit", async () => {
    const archive = buildZip([
      { name: "dir", directory: true },
      { name: "dir/a.txt", data: "a" },
      ...Array.from({ length: 10 }, (_, i) => ({
        name: `node_modules/pkg/f${i}.js`,
        data: "noise",
      })),
      { name: "__MACOSX/._a.txt", data: "noise" },
    ]);
    const result = await extractZipArchive(archive, dest, {
      limits: { maxEntries: 1 },
    });
    expect(result.files).toHaveLength(1);
    expect(result.entryCount).toBe(1);
  });

  it("still bounds every declared entry, folders and noise included", async () => {
    const archive = buildZip([
      { name: "a.txt", data: "a" },
      { name: "node_modules/x.js", data: "x" },
      { name: "node_modules/y.js", data: "y" },
    ]);
    const error = await extractZipArchive(archive, dest, {
      limits: { maxDirectoryEntries: 2 },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ZipLimitError);
    expect(error).toMatchObject({ limit: "directory" });
    expect((error as Error).message).toContain("node_modules and .git");
    expect(listFiles(dest)).toEqual([]);
  });

  it("stops before writing when the signal is already aborted", async () => {
    const archive = buildZip([
      { name: "first.txt", data: "1" },
      { name: "second.txt", data: "2" },
    ]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractZipArchive(archive, dest, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
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
    // Close to device names, but not reserved.
    expect(toSafeZipSegments("conin.txt", 32)).toEqual(["conin.txt"]);
    expect(toSafeZipSegments("com10", 32)).toEqual(["com10"]);
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
      "a:b",
      "NUL",
      "lpt9.txt",
      "CONIN$",
      "conout$.txt",
      "COM¹",
      "lpt³.log",
      "dot.",
      "space ",
    ]) {
      expect(toSafeZipSegments(name, 32)).toBeNull();
    }
  });
});
