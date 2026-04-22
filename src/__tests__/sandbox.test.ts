import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendAttachmentManifestEntries,
  createUniqueAttachmentLogicalName,
  getAttachmentsManifestPath,
  getDyadMediaDir,
  listStoredAttachments,
} from "@/ipc/utils/media_path_utils";
import {
  sandboxFileStats,
  sandboxListFiles,
  sandboxReadFile,
} from "@/ipc/utils/sandbox/capabilities";
import {
  isSandboxSupportedPlatform,
  runSandboxScript,
} from "@/ipc/utils/sandbox/runner";
import {
  SANDBOX_LLM_OUTPUT_LIMIT_BYTES,
  SANDBOX_UI_OUTPUT_LIMIT_BYTES,
} from "@/ipc/utils/sandbox/limits";

describe("sandbox capabilities", () => {
  let appPath: string;

  beforeEach(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-sandbox-"));
    await fs.mkdir(path.join(appPath, "src"), { recursive: true });
    await fs.writeFile(path.join(appPath, "src", "data.txt"), "abcdef", "utf8");
    await fs.writeFile(path.join(appPath, ".env"), "SECRET=1", "utf8");
    await fs.writeFile(path.join(appPath, ".envrc"), "SECRET=2", "utf8");
    const mediaDir = getDyadMediaDir(appPath);
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.writeFile(path.join(mediaDir, "stored-log.txt"), "line1\nline2\n");
    await appendAttachmentManifestEntries(appPath, [
      {
        logicalName: "server.log",
        originalName: "server.log",
        storedFileName: "stored-log.txt",
        mimeType: "text/plain",
        sizeBytes: 12,
        createdAt: new Date("2026-04-22T00:00:00.000Z").toISOString(),
      },
    ]);
  });

  afterEach(async () => {
    await fs.rm(appPath, { recursive: true, force: true });
  });

  it("reads attachment logical paths with ranges", async () => {
    await expect(
      sandboxReadFile(appPath, "attachments:server.log", {
        start: 6,
        length: 5,
      }),
    ).resolves.toBe("line2");
  });

  it("denies protected app paths", async () => {
    await expect(sandboxReadFile(appPath, ".env")).rejects.toThrow(
      "protected path",
    );
    await expect(sandboxReadFile(appPath, ".envrc")).rejects.toThrow(
      "protected path",
    );
    await expect(sandboxReadFile(appPath, "../outside.txt")).rejects.toThrow(
      "Path traversal",
    );
    await expect(
      sandboxReadFile(appPath, path.join(appPath, "src", "data.txt")),
    ).rejects.toThrow("Absolute paths");
    await expect(
      sandboxReadFile(appPath, ".dyad/media/attachments-manifest.json"),
    ).rejects.toThrow("protected path");
    await expect(sandboxListFiles(appPath, ".dyad")).rejects.toThrow(
      "protected path",
    );
  });

  it("normalizes and deduplicates logical attachment names", () => {
    const usedNames = new Set(["server.log"]);

    expect(createUniqueAttachmentLogicalName("../server.log", usedNames)).toBe(
      "server-2.log",
    );
    expect(
      createUniqueAttachmentLogicalName("folder\\data:raw.txt", usedNames),
    ).toBe("data_raw.txt");
  });

  it("lists attachment logical paths and returns file stats", async () => {
    await expect(sandboxListFiles(appPath, "attachments:")).resolves.toEqual([
      "attachments:server.log",
    ]);
    await expect(
      sandboxFileStats(appPath, "attachments:server.log"),
    ).resolves.toMatchObject({
      size: 12,
      isText: true,
    });
  });

  it("filters stale attachment manifest entries", async () => {
    await appendAttachmentManifestEntries(appPath, [
      {
        logicalName: "missing.log",
        originalName: "missing.log",
        storedFileName: "missing-log.txt",
        mimeType: "text/plain",
        sizeBytes: 12,
        createdAt: new Date("2026-04-22T00:00:00.000Z").toISOString(),
      },
    ]);

    await expect(listStoredAttachments(appPath)).resolves.toEqual([
      expect.objectContaining({ logicalName: "server.log" }),
    ]);
    await expect(sandboxListFiles(appPath, "attachments:")).resolves.toEqual([
      "attachments:server.log",
    ]);
  });

  it("recovers from malformed attachment manifests", async () => {
    await fs.writeFile(getAttachmentsManifestPath(appPath), "{", "utf8");

    await expect(listStoredAttachments(appPath)).resolves.toEqual([]);
    await expect(sandboxListFiles(appPath, "attachments:")).resolves.toEqual(
      [],
    );
  });

  it("runs MustardScript against host capabilities on supported platforms", async () => {
    if (!isSandboxSupportedPlatform()) {
      return;
    }

    const result = await runSandboxScript({
      appPath,
      script: `
        async function main() {
          const text = await read_file("attachments:server.log");
          return text.split("\\n").filter(Boolean).length;
        }
        main();
      `,
    });

    expect(result).toMatchObject({
      value: "2",
      truncated: false,
    });
  });

  it("spills oversized script output", async () => {
    if (!isSandboxSupportedPlatform()) {
      return;
    }

    const result = await runSandboxScript({
      appPath,
      script: `"x".repeat(2 * 1024 * 1024);`,
    });

    expect(result.truncated).toBe(true);
    expect(result.value.length).toBe(SANDBOX_LLM_OUTPUT_LIMIT_BYTES);
    expect(result.fullOutputPath).toBeTruthy();
    await expect(
      fs.readFile(result.fullOutputPath!, "utf8"),
    ).resolves.toHaveLength(SANDBOX_UI_OUTPUT_LIMIT_BYTES);
  });
});
