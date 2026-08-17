import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { exec } from "dugite";
import type { AgentContext } from "./types";
import { copyFileTool } from "./copy_file";

describe("copyFileTool file mutation tracking", () => {
  let appPath: string | undefined;

  afterEach(async () => {
    if (appPath) {
      await fs.rm(appPath, { recursive: true, force: true });
      appPath = undefined;
    }
  });

  it("does not count copies to Git-ignored destinations", async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "copy-file-track-"));
    expect((await exec(["init"], appPath)).exitCode).toBe(0);
    await fs.writeFile(path.join(appPath, ".gitignore"), "ignored/\n");
    await fs.mkdir(path.join(appPath, "ignored"), { recursive: true });
    await fs.writeFile(path.join(appPath, "ignored", "tracked.txt"), "old\n");
    expect(
      (await exec(["add", "-f", "ignored/tracked.txt"], appPath)).exitCode,
    ).toBe(0);
    const shouldTrackFileMutation = copyFileTool.shouldTrackFileMutation!;
    const ctx = { appPath } as AgentContext;

    await expect(
      shouldTrackFileMutation(
        { from: "source.txt", to: "ignored/copy.txt" },
        "Successfully copied source.txt to ignored/copy.txt",
        ctx,
      ),
    ).resolves.toBe(false);
    await expect(
      shouldTrackFileMutation(
        { from: "source.txt", to: "src/copy.txt" },
        "Successfully copied source.txt to src/copy.txt",
        ctx,
      ),
    ).resolves.toBe(true);
    await expect(
      shouldTrackFileMutation(
        { from: "source.txt", to: "ignored/tracked.txt" },
        "Successfully copied source.txt to ignored/tracked.txt",
        ctx,
      ),
    ).resolves.toBe(true);
  });
});
