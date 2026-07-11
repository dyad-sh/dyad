import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renameFileTool } from "./rename_file";
import { writeFileTool } from "./write_file";

const {
  deleteSupabaseFunction,
  deploySupabaseFunction,
  gitAdd,
  gitRemove,
  queueCloudSandboxSnapshotSync,
} = vi.hoisted(() => ({
  deleteSupabaseFunction: vi.fn(),
  deploySupabaseFunction: vi.fn(),
  gitAdd: vi.fn(),
  gitRemove: vi.fn(),
  queueCloudSandboxSnapshotSync: vi.fn(),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("@/ipc/utils/git_utils", () => ({ gitAdd, gitRemove }));
vi.mock("@/ipc/utils/cloud_sandbox_provider", () => ({
  queueCloudSandboxSnapshotSync,
}));
vi.mock("../../../../../../supabase_admin/supabase_management_client", () => ({
  deleteSupabaseFunction,
  deploySupabaseFunction,
}));

describe.runIf(process.platform !== "win32")(
  "Local Agent canonical mutation paths",
  () => {
    let appPath: string;

    beforeEach(async () => {
      appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-mutation-app-"));
      await fs.symlink(".", path.join(appPath, "self"), "dir");
      gitAdd.mockResolvedValue(undefined);
      gitRemove.mockResolvedValue(undefined);
      deleteSupabaseFunction.mockResolvedValue(undefined);
      deploySupabaseFunction.mockResolvedValue(undefined);
    });

    afterEach(async () => {
      await fs.rm(appPath, { recursive: true, force: true });
      vi.clearAllMocks();
    });

    function context(overrides: Record<string, unknown> = {}) {
      return {
        appId: 123456,
        appPath,
        supabaseProjectId: null,
        supabaseOrganizationSlug: null,
        isSharedModulesChanged: false,
        sharedServerModulePaths: [],
        pendingFunctionDeploys: [],
        ...overrides,
      } as any;
    }

    it("writes and tracks the canonical path behind an in-app alias", async () => {
      const ctx = context();

      await writeFileTool.execute(
        {
          path: "self/supabase/functions/_shared/util.ts",
          content: "export const value = 1;",
        },
        ctx,
      );

      await expect(
        fs.readFile(
          path.join(appPath, "supabase", "functions", "_shared", "util.ts"),
          "utf8",
        ),
      ).resolves.toBe("export const value = 1;");
      expect(ctx.sharedServerModulePaths).toEqual([
        "supabase/functions/_shared/util.ts",
      ]);
      expect(queueCloudSandboxSnapshotSync).toHaveBeenCalledWith({
        appId: 123456,
        changedPaths: ["supabase/functions/_shared/util.ts"],
      });
    });

    it("renames through an alias using canonical git, cloud, and Supabase paths", async () => {
      await fs.writeFile(path.join(appPath, "source.ts"), "source");
      const ctx = context({ supabaseProjectId: "project-id" });

      await renameFileTool.execute(
        {
          from: "self/source.ts",
          to: "self/supabase/functions/hello-world/index.ts",
        },
        ctx,
      );

      expect(gitAdd).toHaveBeenCalledWith({
        path: appPath,
        filepath: "supabase/functions/hello-world/index.ts",
      });
      expect(gitRemove).toHaveBeenCalledWith({
        path: appPath,
        filepath: "source.ts",
      });
      expect(queueCloudSandboxSnapshotSync).toHaveBeenCalledWith({
        appId: 123456,
        changedPaths: ["supabase/functions/hello-world/index.ts"],
        deletedPaths: ["source.ts"],
      });
      expect(deploySupabaseFunction).toHaveBeenCalledWith({
        supabaseProjectId: "project-id",
        functionName: "hello-world",
        appPath,
        organizationSlug: null,
      });
    });

    it("renames a direct final symlink entry without moving its target", async () => {
      await fs.writeFile(path.join(appPath, "target.txt"), "target");
      await fs.symlink("target.txt", path.join(appPath, "source-link"));

      await renameFileTool.execute(
        {
          from: "self/source-link",
          to: "self/moved-link",
        },
        context(),
      );

      await expect(
        fs.readFile(path.join(appPath, "target.txt"), "utf8"),
      ).resolves.toBe("target");
      await expect(fs.readlink(path.join(appPath, "moved-link"))).resolves.toBe(
        "target.txt",
      );
      await expect(
        fs.lstat(path.join(appPath, "source-link")),
      ).rejects.toThrow();
    });
  },
);
