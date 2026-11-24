import fs from "node:fs/promises";
import fsSync from "node:fs";
import { execFileSync } from "node:child_process";
import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFileTool } from "./copy_file";
import { renameFileTool } from "./rename_file";
import {
  appendAttachmentManifestEntries,
  getAttachmentsManifestPath,
  getDyadMediaDir,
} from "@/ipc/utils/media_path_utils";

const { findApp, gitAdd, gitRemove } = vi.hoisted(() => ({
  findApp: vi.fn(),
  gitAdd: vi.fn(),
  gitRemove: vi.fn(),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));
vi.mock("@/paths/paths", () => ({ getDyadAppPath: (value: string) => value }));
vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: findApp } } },
}));
vi.mock("@/ipc/utils/git_utils", () => ({
  gitAdd,
  gitRemove,
  execGit: vi.fn(),
}));
vi.mock("@/ipc/utils/cloud_sandbox_provider", () => ({
  queueCloudSandboxSnapshotSync: vi.fn(),
}));

describe("copy_file and rename_file protected paths", () => {
  let appPath: string;

  beforeEach(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-protected-"));
    findApp.mockResolvedValue({ path: appPath, supabaseProjectId: null });
    gitAdd.mockResolvedValue(undefined);
    gitRemove.mockResolvedValue(undefined);
    await fs.writeFile(path.join(appPath, ".env"), "TOKEN=secret\n");
    await fs.mkdir(path.join(appPath, ".git"));
    await fs.writeFile(path.join(appPath, ".git", "config"), "[remote]\n");
    await fs.writeFile(path.join(appPath, "notes.txt"), "hello\n");
    const mediaDir = getDyadMediaDir(appPath);
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.writeFile(path.join(mediaDir, "stored-env"), "TOKEN=secret\n");
    await appendAttachmentManifestEntries(appPath, [
      {
        logicalName: ".env",
        originalName: ".env",
        storedFileName: "stored-env",
        mimeType: "text/plain",
        sizeBytes: 13,
        createdAt: new Date("2026-04-22T00:00:00.000Z").toISOString(),
      },
    ]);
  });

  afterEach(async () => {
    await fs.rm(appPath, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  const ctx = () =>
    ({
      appId: 1,
      appPath,
      supabaseProjectId: null,
      supabaseOrganizationSlug: null,
      isSharedModulesChanged: false,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
    }) as any;

  const exists = (relativePath: string) =>
    fs.access(path.join(appPath, relativePath)).then(
      () => true,
      () => false,
    );

  it.each([
    [".env", "leaked.txt"],
    [".env", "foo.env"],
    [".git/config", "leaked.txt"],
    ["attachments:.env", "leaked.txt"],
    ["notes.txt", ".git/hooks/pre-commit"],
  ])("copy_file rejects %s -> %s", async (from, to) => {
    await expect(copyFileTool.execute({ from, to }, ctx())).rejects.toThrow(
      /protected/i,
    );
    expect(await exists(to)).toBe(false);
    expect(gitAdd).not.toHaveBeenCalled();
  });

  it.each([
    [".env", "leaked.txt"],
    [".env", "foo.env"],
    [".git/config", "leaked.txt"],
    ["notes.txt", ".git/hooks/pre-commit"],
  ])("rename_file rejects %s -> %s", async (from, to) => {
    await expect(renameFileTool.execute({ from, to }, ctx())).rejects.toThrow(
      /protected/i,
    );
    expect(await exists(from)).toBe(true);
    expect(await exists(to)).toBe(false);
    expect(gitAdd).not.toHaveBeenCalled();
  });

  it.runIf(process.platform !== "win32")(
    "copy_file rejects a symlink alias of .env",
    async () => {
      await fs.symlink(".env", path.join(appPath, "alias.txt"));
      await expect(
        copyFileTool.execute({ from: "alias.txt", to: "leaked.txt" }, ctx()),
      ).rejects.toThrow(/protected/i);
      expect(await exists("leaked.txt")).toBe(false);
    },
  );

  it.runIf(process.platform !== "win32")(
    "copy_file rejects a symlink alias of a stored dotenv attachment",
    async () => {
      await fs.symlink(
        path.join(".dyad", "media", "stored-env"),
        path.join(appPath, "media-alias.txt"),
      );
      await expect(
        copyFileTool.execute(
          { from: "media-alias.txt", to: "leaked.txt" },
          ctx(),
        ),
      ).rejects.toThrow(/protected/i);
      expect(await exists("leaked.txt")).toBe(false);
    },
  );

  it("copy_file skips the attachment manifest for sources outside media", async () => {
    const stat = vi.spyOn(fs, "stat");
    await copyFileTool.execute({ from: "notes.txt", to: "copy.txt" }, ctx());
    expect(stat.mock.calls.map(([p]) => p)).not.toContain(
      getAttachmentsManifestPath(appPath),
    );
    stat.mockRestore();
  });

  it("copy_file does not resolve absolute sources before the media containment check", async () => {
    const outside = path.join(os.tmpdir(), "dyad-outside-source.txt");
    const realpath = vi.spyOn(fsSync.realpathSync, "native");
    await expect(
      copyFileTool.execute({ from: outside, to: "leaked.txt" }, ctx()),
    ).rejects.toThrow(/only allowed within the .dyad\/media/);
    expect(realpath.mock.calls.map(([p]) => p)).not.toContain(outside);
    realpath.mockRestore();
  });

  it.runIf(process.platform !== "win32")(
    "copy_file rejects a destination symlink to .env",
    async () => {
      await fs.symlink(".env", path.join(appPath, "link.txt"));
      await expect(
        copyFileTool.execute({ from: "notes.txt", to: "link.txt" }, ctx()),
      ).rejects.toThrow(/protected/i);
      expect(await fs.readFile(path.join(appPath, ".env"), "utf8")).toBe(
        "TOKEN=secret\n",
      );
      expect(gitAdd).not.toHaveBeenCalled();
    },
  );

  it.each([
    () => ".dyad/media/stored-env",
    () => path.join(getDyadMediaDir(appPath), "stored-env"),
  ])("copy_file rejects a stored dotenv media path (%#)", async (from) => {
    await expect(
      copyFileTool.execute({ from: from(), to: "leaked.txt" }, ctx()),
    ).rejects.toThrow(/protected/i);
    expect(await exists("leaked.txt")).toBe(false);
  });

  it.runIf(process.platform !== "win32")(
    "copy_file rejects an attachment whose stored file links to .env",
    async () => {
      const mediaDir = getDyadMediaDir(appPath);
      await fs.symlink(
        path.join(appPath, ".env"),
        path.join(mediaDir, "stored-link"),
      );
      await appendAttachmentManifestEntries(appPath, [
        {
          logicalName: "plain.txt",
          originalName: "plain.txt",
          storedFileName: "stored-link",
          mimeType: "text/plain",
          sizeBytes: 13,
          createdAt: new Date("2026-04-22T00:00:00.000Z").toISOString(),
        },
      ]);
      await expect(
        copyFileTool.execute(
          { from: "attachments:plain.txt", to: "leaked.txt" },
          ctx(),
        ),
      ).rejects.toThrow(/protected/i);
      expect(await exists("leaked.txt")).toBe(false);
    },
  );

  it.runIf(process.platform !== "win32")(
    "copy_file rechecks a source swapped before workspace claims are held",
    async () => {
      const run = appOperationCoordinator.run.bind(appOperationCoordinator);
      const spy = vi
        .spyOn(appOperationCoordinator, "run")
        .mockImplementationOnce(async (options, fn) => {
          await fs.rm(path.join(appPath, "notes.txt"));
          await fs.symlink(".env", path.join(appPath, "notes.txt"));
          return run(options, fn);
        });
      await expect(
        copyFileTool.execute({ from: "notes.txt", to: "leaked.txt" }, ctx()),
      ).rejects.toThrow(/protected/i);
      expect(await exists("leaked.txt")).toBe(false);
      spy.mockRestore();
    },
  );

  it("copies and renames a dotenv template to a dotenv name", async () => {
    await fs.writeFile(path.join(appPath, ".env.example"), "TOKEN=\n");
    await fs.writeFile(path.join(appPath, ".env.sample"), "TOKEN=\n");
    await expect(
      copyFileTool.execute({ from: ".env.example", to: ".env.local" }, ctx()),
    ).resolves.toBe("Successfully copied .env.example to .env.local");
    await expect(
      renameFileTool.execute({ from: ".env.sample", to: ".env.dev" }, ctx()),
    ).resolves.toBe("Successfully renamed .env.sample to .env.dev");
  });

  it.each([
    [".env.local", ".env.example"],
    [".env.local", "config/.env.production"],
    [".env", ".env.local"],
  ])("rejects non-template dotenv %s -> %s", async (from, to) => {
    await fs.writeFile(path.join(appPath, from), "TOKEN=secret\n");
    for (const tool of [copyFileTool, renameFileTool]) {
      await expect(tool.execute({ from, to }, ctx())).rejects.toThrow(
        /only be created from a template/,
      );
    }
    expect(await exists(from)).toBe(true);
    expect(await exists(to)).toBe(false);
    expect(gitAdd).not.toHaveBeenCalled();
  });

  it.runIf(process.platform !== "win32")(
    "copy_file allows a symlink alias of a dotenv template",
    async () => {
      await fs.writeFile(path.join(appPath, ".env.example"), "TOKEN=\n");
      await fs.symlink(".env.example", path.join(appPath, "template-link"));
      await expect(
        copyFileTool.execute(
          { from: "template-link", to: ".env.local" },
          ctx(),
        ),
      ).resolves.toBe("Successfully copied template-link to .env.local");
    },
  );

  it.runIf(process.platform !== "win32")(
    "rename_file rejects a template-named symlink to a secret dotenv",
    async () => {
      await fs.writeFile(path.join(appPath, ".env.local"), "TOKEN=secret\n");
      await fs.symlink(".env.local", path.join(appPath, ".env.example"));
      await expect(
        renameFileTool.execute({ from: ".env.example", to: ".env.dev" }, ctx()),
      ).rejects.toThrow(/only be created from a template/);
      expect(await exists(".env.dev")).toBe(false);
      expect(await exists(".env.example")).toBe(true);
      expect(gitAdd).not.toHaveBeenCalled();
    },
  );

  it.each([".env.", ".env ", ".env::$DATA"])(
    "copy_file rejects the Windows alias %j",
    async (from) => {
      // Win32 writes these to .env itself; elsewhere they are real names.
      await fs.writeFile(path.join(appPath, from), "TOKEN=secret\n");
      await expect(
        copyFileTool.execute({ from, to: "leaked.txt" }, ctx()),
      ).rejects.toThrow(/protected/i);
      expect(await exists("leaked.txt")).toBe(false);
    },
  );

  it.runIf(process.platform === "win32")(
    "copy_file and rename_file reject 8.3 short names of .env and .git",
    async ({ skip }) => {
      // Read the real short names; the volume may have 8.3 names disabled.
      const listing = execFileSync("cmd", ["/c", "dir", "/x", "/a"], {
        cwd: appPath,
        encoding: "utf8",
      });
      const shortName = (longName: string) =>
        listing
          .split(/\r?\n/)
          .map((line) => line.trim().split(/\s+/))
          .find((cols) => cols.at(-1) === longName && cols.length >= 2)
          ?.at(-2)
          ?.match(/^\S*~\S*$/)?.[0];
      const envShort = shortName(".env");
      const gitShort = shortName(".git");
      if (!envShort || !gitShort) {
        skip("8.3 short names are disabled on this volume");
      }
      for (const [from, to] of [
        [envShort!, "leaked1.txt"],
        [`${gitShort}/config`, "leaked2.txt"],
        ["notes.txt", `${gitShort}/hooks/pre-commit`],
      ]) {
        for (const tool of [copyFileTool, renameFileTool]) {
          await expect(tool.execute({ from, to }, ctx())).rejects.toThrow(
            /protected/i,
          );
        }
      }
      expect(await exists("leaked1.txt")).toBe(false);
      expect(await exists("leaked2.txt")).toBe(false);
      expect(await exists(".env")).toBe(true);
    },
  );

  it("still copies and renames ordinary files", async () => {
    await expect(
      copyFileTool.execute({ from: "notes.txt", to: "copy.txt" }, ctx()),
    ).resolves.toBe("Successfully copied notes.txt to copy.txt");
    await expect(
      renameFileTool.execute({ from: "copy.txt", to: "moved.txt" }, ctx()),
    ).resolves.toBe("Successfully renamed copy.txt to moved.txt");
  });
});
