import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendAttachmentManifestEntries,
  appendAttachmentManifestEntriesWithLogicalNames,
  createUniqueAttachmentLogicalName,
  getAttachmentsManifestPath,
  getDyadMediaDir,
  listStoredAttachments,
  pruneAttachmentManifest,
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
  SANDBOX_READ_FILE_LIMIT_BYTES,
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
    await fs.writeFile(
      path.join(appPath, ".environment-setup.md"),
      "docs",
      "utf8",
    );
    await fs.mkdir(path.join(appPath, ".envoy"), { recursive: true });
    await fs.writeFile(
      path.join(appPath, ".envoy", "config.yaml"),
      "x",
      "utf8",
    );
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

  it("throws instead of silently truncating oversized project file reads", async () => {
    const largePath = path.join(appPath, "src", "large.log");
    await fs.writeFile(largePath, "hello", "utf8");
    await fs.truncate(largePath, SANDBOX_READ_FILE_LIMIT_BYTES + 1);

    await expect(sandboxReadFile(appPath, "src/large.log")).rejects.toThrow(
      "exceeding the",
    );
    await expect(
      sandboxReadFile(appPath, "src/large.log", {
        length: SANDBOX_READ_FILE_LIMIT_BYTES + 1,
      }),
    ).rejects.toThrow("read_file length");
    await expect(
      sandboxReadFile(appPath, "src/large.log", { length: 5 }),
    ).resolves.toBe("hello");
  });

  it("denies protected app paths", async () => {
    await expect(sandboxReadFile(appPath, ".env")).rejects.toThrow(
      "protected path",
    );
    await expect(sandboxReadFile(appPath, ".envrc")).rejects.toThrow(
      "protected path",
    );
    await expect(
      sandboxReadFile(appPath, ".environment-setup.md"),
    ).resolves.toBe("docs");
    await expect(sandboxListFiles(appPath, ".envoy")).resolves.toStrictEqual([
      ".envoy/config.yaml",
    ]);
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

  it("allocates manifest logical names under the manifest lock", async () => {
    const mediaDir = getDyadMediaDir(appPath);
    await fs.writeFile(path.join(mediaDir, "stored-log-2.txt"), "line3\n");

    const [entry] = await appendAttachmentManifestEntriesWithLogicalNames(
      appPath,
      [
        {
          requestedLogicalName: "server.log",
          originalName: "server.log",
          storedFileName: "stored-log-2.txt",
          mimeType: "text/plain",
          sizeBytes: 6,
          createdAt: new Date("2026-04-22T00:00:00.000Z").toISOString(),
        },
      ],
    );

    expect(entry.logicalName).toBe("server-2.log");
    await expect(sandboxListFiles(appPath, "attachments:")).resolves.toEqual([
      "attachments:server.log",
      "attachments:server-2.log",
    ]);
  });

  it("reuses manifest logical names for already registered stored files", async () => {
    const [entry] = await appendAttachmentManifestEntriesWithLogicalNames(
      appPath,
      [
        {
          requestedLogicalName: "server.log",
          originalName: "server.log",
          storedFileName: "stored-log.txt",
          mimeType: "text/plain",
          sizeBytes: 12,
          createdAt: new Date("2026-04-22T00:00:00.000Z").toISOString(),
        },
      ],
    );

    expect(entry.logicalName).toBe("server.log");
    await expect(sandboxListFiles(appPath, "attachments:")).resolves.toEqual([
      "attachments:server.log",
    ]);
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

  it("allows explicit attachment aliases with protected-looking names", async () => {
    const mediaDir = getDyadMediaDir(appPath);
    await fs.writeFile(path.join(mediaDir, "stored-env.txt"), "ATTACHED=1");
    await appendAttachmentManifestEntries(appPath, [
      {
        logicalName: ".env",
        originalName: ".env",
        storedFileName: "stored-env.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        createdAt: new Date("2026-04-22T00:00:00.000Z").toISOString(),
      },
    ]);

    await expect(sandboxReadFile(appPath, "attachments:.env")).resolves.toBe(
      "ATTACHED=1",
    );
    await expect(sandboxListFiles(appPath, "attachments:")).resolves.toEqual([
      "attachments:server.log",
      "attachments:.env",
    ]);
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

  it("prunes stale attachment manifest entries", async () => {
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

    await expect(pruneAttachmentManifest(appPath)).resolves.toBe(1);
    await expect(sandboxListFiles(appPath, "attachments:")).resolves.toEqual([
      "attachments:server.log",
    ]);

    const mediaDir = getDyadMediaDir(appPath);
    await fs.writeFile(path.join(mediaDir, "stored-missing.txt"), "new\n");
    const [entry] = await appendAttachmentManifestEntriesWithLogicalNames(
      appPath,
      [
        {
          requestedLogicalName: "missing.log",
          originalName: "missing.log",
          storedFileName: "stored-missing.txt",
          mimeType: "text/plain",
          sizeBytes: 4,
          createdAt: new Date("2026-04-22T00:00:00.000Z").toISOString(),
        },
      ],
    );

    expect(entry.logicalName).toBe("missing.log");
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

  it("reports actual attachment host calls from MustardScript", async () => {
    if (!isSandboxSupportedPlatform()) {
      return;
    }

    const hostCalls: Array<{ name: string; path?: string }> = [];
    const result = await runSandboxScript({
      appPath,
      script: `
        async function main() {
          const p = "attachments:server.log";
          return await read_file(p, { length: 5 });
        }
        main();
      `,
      onHostCall: (hostCall) => hostCalls.push(hostCall),
    });

    expect(result.value).toBe("line1");
    expect(hostCalls).toContainEqual({
      name: "read_file",
      path: "attachments:server.log",
    });
  });

  it("fails sandbox scripts that read oversized attachments without a range", async () => {
    if (!isSandboxSupportedPlatform()) {
      return;
    }

    const mediaDir = getDyadMediaDir(appPath);
    const storedFileName = "stored-large.log";
    await fs.writeFile(path.join(mediaDir, storedFileName), "large", "utf8");
    await fs.truncate(
      path.join(mediaDir, storedFileName),
      SANDBOX_READ_FILE_LIMIT_BYTES + 1,
    );
    await appendAttachmentManifestEntries(appPath, [
      {
        logicalName: "large.log",
        originalName: "large.log",
        storedFileName,
        mimeType: "text/plain",
        sizeBytes: SANDBOX_READ_FILE_LIMIT_BYTES + 1,
        createdAt: new Date("2026-04-22T00:00:00.000Z").toISOString(),
      },
    ]);

    await expect(
      runSandboxScript({
        appPath,
        script: `
          async function main() {
            const text = await read_file("attachments:large.log");
            return text.length;
          }
          main();
        `,
      }),
    ).rejects.toThrow("exceeding the");
  });

  it("spills oversized script output", async () => {
    if (!isSandboxSupportedPlatform()) {
      return;
    }

    const result = await runSandboxScript({
      appPath,
      script: `"x".repeat(${SANDBOX_UI_OUTPUT_LIMIT_BYTES + 1024});`,
    });

    expect(result.truncated).toBe(true);
    expect(result.value.length).toBe(SANDBOX_LLM_OUTPUT_LIMIT_BYTES);
    expect(result.fullOutputPath).toBeTruthy();
    await expect(
      fs.readFile(result.fullOutputPath!, "utf8"),
    ).resolves.toHaveLength(SANDBOX_UI_OUTPUT_LIMIT_BYTES);
  });
});
