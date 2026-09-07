import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_READ_FILE_RESULT_LIMIT_BYTES,
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

  it("keeps the local-agent read result budget at 256 KiB", () => {
    expect(AGENT_READ_FILE_RESULT_LIMIT_BYTES).toBe(256 * 1024);
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

    describe("whole-file binary detection (rejects up front regardless of range/truncation)", () => {
      it("variant A: rejects a NUL on a line BEFORE the requested range (startLine > 1)", async () => {
        // Line 1 carries a NUL well past the 8 KiB sample window, on a line
        // numbered LESS than startLine. Previously those bytes were scanned
        // only for newlines (inRange=false => appendBytes skipped) and the
        // 8 KiB sample missed the NUL, so the file was returned as text.
        const filePath = path.join(rootPath, "before-range.bin");
        const file = Buffer.concat([
          Buffer.from("a".repeat(20_000)),
          Buffer.from([0x00]),
          Buffer.from("\n"),
          Buffer.from("visible line\n"),
        ]);
        await fs.writeFile(filePath, file);

        await expect(
          readTextFileLines({
            rootPath,
            filePath,
            displayPath: "before-range.bin",
            startLine: 2,
          }),
        ).rejects.toThrow(
          "Cannot read binary file as UTF-8 text: before-range.bin",
        );
      });

      it("variant A control: same file with a range that includes the binary line is rejected", async () => {
        const filePath = path.join(rootPath, "before-range-ctrl.bin");
        const file = Buffer.concat([
          Buffer.from("a".repeat(20_000)),
          Buffer.from([0x00]),
          Buffer.from("\n"),
          Buffer.from("visible line\n"),
        ]);
        await fs.writeFile(filePath, file);

        await expect(
          readTextFileLines({
            rootPath,
            filePath,
            displayPath: "before-range-ctrl.bin",
          }),
        ).rejects.toThrow(
          "Cannot read binary file as UTF-8 text: before-range-ctrl.bin",
        );
      });

      it("variant B: rejects a NUL past the 256 KiB output cap on the default range", async () => {
        // >256 KiB of valid text (clears the 8 KiB sample) followed by a NUL.
        // Previously the streaming loop truncated at the 256 KiB output budget
        // and exited before ever reading the NUL, returning valid text. This
        // path is reachable with the default range (no startLine > 1).
        const filePath = path.join(rootPath, "past-cap.bin");
        const file = Buffer.concat([
          Buffer.from("line\n".repeat(60_000)), // 300_000 bytes of valid text
          Buffer.from([0x00]),
        ]);
        await fs.writeFile(filePath, file);

        await expect(
          readTextFileLines({
            rootPath,
            filePath,
            displayPath: "past-cap.bin",
          }),
        ).rejects.toThrow(
          "Cannot read binary file as UTF-8 text: past-cap.bin",
        );
      });

      it("variant B control: same content with a NUL within the first 8 KiB is rejected", async () => {
        const filePath = path.join(rootPath, "past-cap-ctrl.bin");
        const file = Buffer.concat([
          Buffer.from("line\n".repeat(100)), // 500 bytes — within 8 KiB sample
          Buffer.from([0x00]),
          Buffer.from("line\n".repeat(60_000)),
        ]);
        await fs.writeFile(filePath, file);

        await expect(
          readTextFileLines({
            rootPath,
            filePath,
            displayPath: "past-cap-ctrl.bin",
          }),
        ).rejects.toThrow(
          "Cannot read binary file as UTF-8 text: past-cap-ctrl.bin",
        );
      });

      it("variant C: rejects a NUL on a line AFTER an end-bounded range (in a never-read chunk)", async () => {
        // Line 1 fills most of chunk 1; line 2 is the end line
        // (endLineInclusive=2) and has a following byte in chunk 1, so
        // reachedRangeEnd fires inside chunk 1 and chunk 2 (which holds the
        // NUL at byte ~66_008, past 64 KiB) is never read by the content loop.
        const filePath = path.join(rootPath, "after-range.bin");
        const file = Buffer.concat([
          Buffer.from("a".repeat(60_000)),
          Buffer.from("\n"), // line 1 ends at byte 60_000
          Buffer.from("target\n"), // line 2: bytes 60_001..60_007
          Buffer.from("a".repeat(6_000)), // start of line 3: bytes 60_008..
          Buffer.from([0x00]), // NUL at byte 66_008 (past 64 KiB => chunk 2)
          Buffer.from("\n"),
        ]);
        await fs.writeFile(filePath, file);

        await expect(
          readTextFileLines({
            rootPath,
            filePath,
            displayPath: "after-range.bin",
            startLine: 1,
            endLineInclusive: 2,
          }),
        ).rejects.toThrow(
          "Cannot read binary file as UTF-8 text: after-range.bin",
        );
      });

      it("variant C control: same file read to the end (range includes the binary line) is rejected", async () => {
        const filePath = path.join(rootPath, "after-range-ctrl.bin");
        const file = Buffer.concat([
          Buffer.from("a".repeat(60_000)),
          Buffer.from("\n"),
          Buffer.from("target\n"),
          Buffer.from("a".repeat(6_000)),
          Buffer.from([0x00]),
          Buffer.from("\n"),
        ]);
        await fs.writeFile(filePath, file);

        await expect(
          readTextFileLines({
            rootPath,
            filePath,
            displayPath: "after-range-ctrl.bin",
          }),
        ).rejects.toThrow(
          "Cannot read binary file as UTF-8 text: after-range-ctrl.bin",
        );
      });

      it("rejects invalid UTF-8 (no NUL) past 8 KiB on a line after an end-bounded range", async () => {
        // The whole-file fatal TextDecoder must also catch malformed UTF-8
        // (here a lone 0xff) that lies past the 8 KiB sample and outside the
        // requested range, not just NUL bytes.
        const filePath = path.join(rootPath, "invalid-utf8.bin");
        const file = Buffer.concat([
          Buffer.from("a".repeat(60_000)),
          Buffer.from("\n"), // line 1
          Buffer.from("target\n"), // line 2 (endLineInclusive)
          Buffer.from("a".repeat(6_000)),
          Buffer.from([0xff]), // invalid UTF-8 at byte 66_008 (chunk 2)
          Buffer.from("\n"),
        ]);
        await fs.writeFile(filePath, file);

        await expect(
          readTextFileLines({
            rootPath,
            filePath,
            displayPath: "invalid-utf8.bin",
            startLine: 1,
            endLineInclusive: 2,
          }),
        ).rejects.toThrow(
          "Cannot read binary file as UTF-8 text: invalid-utf8.bin",
        );
      });

      it("does not falsely reject valid UTF-8 split across a pre-scan chunk boundary", async () => {
        // The 4-byte "🙂" straddles the 64 KiB pre-scan boundary, so the
        // streaming fatal decoder must use stream:true to avoid a false
        // rejection of a perfectly valid text file.
        const filePath = path.join(rootPath, "chunk-boundary-utf8.txt");
        const content = `${"a".repeat(65534)}🙂\ntail`;
        await fs.writeFile(filePath, content);

        const result = await readTextFileLines({
          rootPath,
          filePath,
          displayPath: "chunk-boundary-utf8.txt",
        });

        expect(result.content).toBe(content);
        expect(result.truncated).toBe(false);
      });

      it("does not falsely reject a large valid text file spanning many chunks", async () => {
        const filePath = path.join(rootPath, "large.txt");
        await fs.writeFile(filePath, "line\n".repeat(60_000)); // 300_000 bytes

        const result = await readTextFileLines({
          rootPath,
          filePath,
          displayPath: "large.txt",
        });

        expect(result.truncated).toBe(true);
        expect(result.content.startsWith("line\n")).toBe(true);
        expect(Buffer.byteLength(result.content, "utf8")).toBeLessThanOrEqual(
          AGENT_READ_FILE_RESULT_LIMIT_BYTES,
        );
      });
    });
  });
});
