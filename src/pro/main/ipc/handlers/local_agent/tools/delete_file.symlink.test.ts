import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteFileTool } from "./delete_file";

const { gitRemove } = vi.hoisted(() => ({ gitRemove: vi.fn() }));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));
vi.mock("@/ipc/utils/git_utils", () => ({ gitRemove }));
vi.mock("@/ipc/utils/cloud_sandbox_provider", () => ({
  queueCloudSandboxSnapshotSync: vi.fn(),
}));
vi.mock("../../../../../../supabase_admin/supabase_management_client", () => ({
  deleteSupabaseFunction: vi.fn(),
}));

describe.runIf(process.platform !== "win32")(
  "deleteFileTool symlink safety",
  () => {
    let appPath: string;
    let outsidePath: string;

    beforeEach(async () => {
      appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-delete-app-"));
      outsidePath = await fs.mkdtemp(
        path.join(os.tmpdir(), "dyad-delete-outside-"),
      );
      gitRemove.mockResolvedValue(undefined);
    });

    afterEach(async () => {
      await fs.rm(appPath, { recursive: true, force: true });
      await fs.rm(outsidePath, { recursive: true, force: true });
      vi.clearAllMocks();
    });

    function context() {
      return {
        appId: 1,
        appPath,
        supabaseProjectId: null,
        isSharedModulesChanged: false,
        sharedServerModulePaths: [],
      } as any;
    }

    it("unlinks slash-terminated final symlinks without following them", async () => {
      const sentinelPath = path.join(appPath, "sentinel.txt");
      const outsideVictimPath = path.join(outsidePath, "victim.txt");
      const missingOutsidePath = path.join(outsidePath, "missing");
      await fs.writeFile(sentinelPath, "project");
      await fs.writeFile(outsideVictimPath, "outside");
      await fs.symlink(".", path.join(appPath, "self"), "dir");
      await fs.symlink(outsidePath, path.join(appPath, "outside-link"), "dir");
      await fs.symlink(
        outsideVictimPath,
        path.join(appPath, "outside-file-link"),
      );
      await fs.symlink(
        missingOutsidePath,
        path.join(appPath, "dangling"),
        "dir",
      );

      await deleteFileTool.execute(
        { path: "self/outside-file-link/" },
        context(),
      );
      await expect(
        fs.lstat(path.join(appPath, "outside-file-link")),
      ).rejects.toThrow();
      expect(gitRemove).toHaveBeenCalledWith({
        path: appPath,
        filepath: "outside-file-link",
      });

      await deleteFileTool.execute({ path: "self/" }, context());
      await deleteFileTool.execute({ path: "outside-link/" }, context());
      await deleteFileTool.execute({ path: "dangling/" }, context());

      await expect(fs.readFile(sentinelPath, "utf8")).resolves.toBe("project");
      await expect(fs.readFile(outsideVictimPath, "utf8")).resolves.toBe(
        "outside",
      );
      await expect(fs.lstat(path.join(appPath, "self"))).rejects.toThrow();
      await expect(
        fs.lstat(path.join(appPath, "outside-link")),
      ).rejects.toThrow();
      await expect(fs.lstat(path.join(appPath, "dangling"))).rejects.toThrow();
      expect(gitRemove).toHaveBeenCalledWith({
        path: appPath,
        filepath: "self",
      });
    });

    it("still rejects a path reached through a symlinked ancestor", async () => {
      const outsideVictimPath = path.join(outsidePath, "victim.txt");
      const outsideVictimLinkPath = path.join(outsidePath, "victim-link");
      await fs.writeFile(outsideVictimPath, "outside");
      await fs.symlink("victim.txt", outsideVictimLinkPath);
      await fs.symlink(outsidePath, path.join(appPath, "outside-link"), "dir");

      await expect(
        deleteFileTool.execute({ path: "outside-link/victim.txt" }, context()),
      ).rejects.toThrow("outside the app");
      await expect(
        deleteFileTool.execute({ path: "outside-link/victim-link" }, context()),
      ).rejects.toThrow("outside the app");
      await expect(fs.readFile(outsideVictimPath, "utf8")).resolves.toBe(
        "outside",
      );
      await expect(fs.lstat(outsideVictimLinkPath)).resolves.toMatchObject({});
    });
  },
);
