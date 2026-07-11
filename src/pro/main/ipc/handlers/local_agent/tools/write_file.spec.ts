import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileTool } from "./write_file";

vi.mock("electron-log", () => ({
  default: { scope: () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

vi.mock("@/ipc/utils/cloud_sandbox_provider", () => ({
  queueCloudSandboxSnapshotSync: vi.fn(),
}));

describe("writeFileTool", () => {
  let appPath: string;

  beforeEach(() => {
    appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-git-guard-"));
    execFileSync("git", ["init", "-q"], { cwd: appPath });
  });

  afterEach(() => {
    fs.rmSync(appPath, { recursive: true, force: true });
  });

  function context() {
    return { appId: 1, appPath } as any;
  }

  it("rejects writes to Git metadata", async () => {
    await expect(
      writeFileTool.execute(
        { path: ".git/config", content: "[core]\nhooksPath=hooks" },
        context(),
      ),
    ).rejects.toThrow("cannot modify Git metadata");

    expect(fs.readFileSync(path.join(appPath, ".git/config"), "utf8")).not.toBe(
      "[core]\nhooksPath=hooks",
    );
  });

  it("allows normal .gitignore edits", async () => {
    await expect(
      writeFileTool.execute(
        { path: ".gitignore", content: "dist/\n" },
        context(),
      ),
    ).resolves.toBe("Successfully wrote .gitignore");

    expect(fs.readFileSync(path.join(appPath, ".gitignore"), "utf8")).toBe(
      "dist/\n",
    );
  });

  it.runIf(process.platform !== "win32")(
    "rejects an existing and non-existing path through a tracked .git symlink alias",
    async () => {
      fs.symlinkSync(".git", path.join(appPath, "gitmeta"), "dir");
      execFileSync("git", ["add", "gitmeta"], { cwd: appPath });
      const originalConfig = fs.readFileSync(
        path.join(appPath, ".git/config"),
        "utf8",
      );

      await expect(
        writeFileTool.execute(
          { path: "gitmeta/config", content: "[core]\nhooksPath=hooks" },
          context(),
        ),
      ).rejects.toThrow("cannot modify Git metadata");
      await expect(
        writeFileTool.execute(
          { path: "gitmeta/new/deep/config", content: "malicious" },
          context(),
        ),
      ).rejects.toThrow("cannot modify Git metadata");

      expect(fs.readFileSync(path.join(appPath, ".git/config"), "utf8")).toBe(
        originalConfig,
      );
      expect(fs.existsSync(path.join(appPath, ".git/new"))).toBe(false);
    },
  );

  it.runIf(process.platform !== "win32")(
    "fails closed for a dangling symlink ancestor",
    async () => {
      fs.symlinkSync(".git/missing", path.join(appPath, "dangling"), "dir");

      await expect(
        writeFileTool.execute(
          { path: "dangling/config", content: "malicious" },
          context(),
        ),
      ).rejects.toThrow("cannot modify through an unresolved symlink");
      expect(fs.existsSync(path.join(appPath, ".git/missing"))).toBe(false);
    },
  );
});
