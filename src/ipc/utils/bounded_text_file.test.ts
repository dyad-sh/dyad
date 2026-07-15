import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APP_FILE_EDITOR_LIMIT_BYTES,
  readAppFileForEditor,
  readTextFileLines,
} from "./bounded_text_file";

describe("bounded text file reads", () => {
  let rootPath: string;
  let outsidePath: string;

  beforeEach(async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "bounded-read-root-"));
    outsidePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "bounded-read-outside-"),
    );
  });

  afterEach(async () => {
    await Promise.all([
      fs.rm(rootPath, { recursive: true, force: true }),
      fs.rm(outsidePath, { recursive: true, force: true }),
    ]);
  });

  describe("readAppFileForEditor", () => {
    it("reads valid UTF-8 asynchronously", async () => {
      const filePath = path.join(rootPath, "unicode.ts");
      await fs.writeFile(filePath, "const greeting = 'héllo 🙂';\n");

      await expect(
        readAppFileForEditor({
          rootPath,
          filePath,
          displayPath: "unicode.ts",
        }),
      ).resolves.toBe("const greeting = 'héllo 🙂';\n");
    });

    it("allows in-root paths whose first segment starts with two dots", async () => {
      const directoryPath = path.join(rootPath, "..foo");
      const filePath = path.join(directoryPath, "valid.txt");
      await fs.mkdir(directoryPath);
      await fs.writeFile(filePath, "still inside the app\n");

      await expect(
        readAppFileForEditor({
          rootPath,
          filePath,
          displayPath: "..foo/valid.txt",
        }),
      ).resolves.toBe("still inside the app\n");
    });

    it("rejects an oversized sparse file before reading its contents", async () => {
      const filePath = path.join(rootPath, "huge.txt");
      await fs.writeFile(filePath, "small prefix");
      await fs.truncate(filePath, APP_FILE_EDITOR_LIMIT_BYTES + 1);

      await expect(
        readAppFileForEditor({
          rootPath,
          filePath,
          displayPath: "huge.txt",
        }),
      ).rejects.toThrow(
        `${APP_FILE_EDITOR_LIMIT_BYTES + 1} bytes; ${APP_FILE_EDITOR_LIMIT_BYTES} byte limit`,
      );
    });

    it("rejects binary and malformed UTF-8 files", async () => {
      const nullFilePath = path.join(rootPath, "null.bin");
      const invalidUtf8Path = path.join(rootPath, "invalid.bin");
      await fs.writeFile(nullFilePath, Buffer.from([0x61, 0x00, 0x62]));
      await fs.writeFile(invalidUtf8Path, Buffer.from([0x61, 0xff, 0x62]));

      await expect(
        readAppFileForEditor({
          rootPath,
          filePath: nullFilePath,
          displayPath: "null.bin",
        }),
      ).rejects.toThrow("Cannot read binary file as UTF-8 text: null.bin");
      await expect(
        readAppFileForEditor({
          rootPath,
          filePath: invalidUtf8Path,
          displayPath: "invalid.bin",
        }),
      ).rejects.toThrow("Cannot read binary file as UTF-8 text: invalid.bin");
    });

    it.runIf(process.platform !== "win32")(
      "rejects symlinks that escape the app root",
      async () => {
        const outsideFile = path.join(outsidePath, "secret.txt");
        const symlinkPath = path.join(rootPath, "secret-link.txt");
        await fs.writeFile(outsideFile, "secret");
        await fs.symlink(outsideFile, symlinkPath);

        await expect(
          readAppFileForEditor({
            rootPath,
            filePath: symlinkPath,
            displayPath: "secret-link.txt",
          }),
        ).rejects.toThrow("Cannot read files outside the app");
      },
    );
  });

  describe("readTextFileLines", () => {
    it("streams a late range from a file larger than the result budget", async () => {
      const filePath = path.join(rootPath, "many-lines.txt");
      const handle = await fs.open(filePath, "w");
      try {
        await handle.write("skip\n".repeat(99_998));
        await handle.write("line 99999\nline 100000\n");
      } finally {
        await handle.close();
      }

      const result = await readTextFileLines({
        rootPath,
        filePath,
        displayPath: "many-lines.txt",
        startLine: 99_999,
        endLineInclusive: 100_000,
      });

      expect(result).toMatchObject({
        content: "line 99999\nline 100000\n",
        truncated: false,
      });
    });

    it("preserves UTF-8 characters split across stream chunks", async () => {
      const filePath = path.join(rootPath, "chunk-boundary.txt");
      const content = `${"a".repeat(32 * 1024 - 1)}🙂\nlast line`;
      await fs.writeFile(filePath, content);

      const result = await readTextFileLines({
        rootPath,
        filePath,
        displayPath: "chunk-boundary.txt",
      });

      expect(result.content).toBe(content);
      expect(result.truncated).toBe(false);
    });

    it("rejects binary input before returning tool content", async () => {
      const filePath = path.join(rootPath, "binary.dat");
      await fs.writeFile(filePath, Buffer.from([0x61, 0x00, 0x62, 0x0a]));

      await expect(
        readTextFileLines({
          rootPath,
          filePath,
          displayPath: "binary.dat",
        }),
      ).rejects.toThrow("Cannot read binary file as UTF-8 text: binary.dat");
    });
  });
});
