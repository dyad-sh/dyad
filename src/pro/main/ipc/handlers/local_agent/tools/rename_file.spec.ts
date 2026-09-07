import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renameFileTool } from "./rename_file";

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
  "renameFileTool Supabase function reconcile",
  () => {
    let appPath: string;

    beforeEach(async () => {
      appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-rename-app-"));
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
        supabaseProjectId: "project-id",
        supabaseOrganizationSlug: null,
        isSharedModulesChanged: false,
        sharedServerModulePaths: [],
        pendingFunctionDeploys: [],
        ...overrides,
      } as any;
    }

    async function createFile(relPath: string, content = "// stub") {
      const full = path.join(appPath, relPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
    }

    it("redeploys the source function instead of deleting when a nested file is renamed within a still-present function", async () => {
      await createFile("supabase/functions/hello/index.ts");
      await createFile("supabase/functions/hello/helpers.ts");

      const result = await renameFileTool.execute(
        {
          from: "supabase/functions/hello/helpers.ts",
          to: "supabase/functions/hello/lib/helpers.ts",
        },
        context(),
      );

      expect(result).toContain("Successfully renamed");
      expect(deleteSupabaseFunction).not.toHaveBeenCalled();
      expect(deploySupabaseFunction).toHaveBeenCalledWith({
        supabaseProjectId: "project-id",
        functionName: "hello",
        appPath,
        organizationSlug: null,
      });
    });

    it("redeploys the source function and deploys the target function when moving a file out of a still-present function", async () => {
      await createFile("supabase/functions/hello/index.ts");
      await createFile("supabase/functions/hello/utils.ts");

      await renameFileTool.execute(
        {
          from: "supabase/functions/hello/utils.ts",
          to: "supabase/functions/world/index.ts",
        },
        context(),
      );

      expect(deleteSupabaseFunction).not.toHaveBeenCalled();
      expect(deploySupabaseFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          supabaseProjectId: "project-id",
          functionName: "hello",
          appPath,
          organizationSlug: null,
        }),
      );
      expect(deploySupabaseFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          supabaseProjectId: "project-id",
          functionName: "world",
          appPath,
          organizationSlug: null,
        }),
      );
    });

    it("deletes the source function and deploys the target when the source entry itself is moved away", async () => {
      await createFile("supabase/functions/hello/index.ts");

      await renameFileTool.execute(
        {
          from: "supabase/functions/hello/index.ts",
          to: "supabase/functions/world/index.ts",
        },
        context(),
      );

      expect(deleteSupabaseFunction).toHaveBeenCalledWith({
        supabaseProjectId: "project-id",
        functionName: "hello",
        organizationSlug: null,
      });
      expect(deploySupabaseFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          supabaseProjectId: "project-id",
          functionName: "world",
          appPath,
          organizationSlug: null,
        }),
      );
      expect(deploySupabaseFunction).not.toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "hello" }),
      );
    });

    it("does not delete the function when shared modules changed earlier in the turn (no extended outage)", async () => {
      await createFile("supabase/functions/hello/index.ts");
      await createFile("supabase/functions/hello/helpers.ts");
      const ctx = context({ isSharedModulesChanged: true });

      await renameFileTool.execute(
        {
          from: "supabase/functions/hello/helpers.ts",
          to: "supabase/functions/hello/lib/helpers.ts",
        },
        ctx,
      );

      expect(deleteSupabaseFunction).not.toHaveBeenCalled();
      expect(deploySupabaseFunction).toHaveBeenCalledWith({
        supabaseProjectId: "project-id",
        functionName: "hello",
        appPath,
        organizationSlug: null,
      });
      expect(ctx.pendingFunctionDeploys).toContain("hello");
    });
  },
);
