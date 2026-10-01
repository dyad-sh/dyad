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
      expect(deploySupabaseFunction).toHaveBeenCalledTimes(1);
      expect(deploySupabaseFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 123456,
          supabaseProjectId: "project-id",
          functionName: "hello",
          appPath,
          organizationSlug: null,
        }),
      );
    });

    it("deletes the function when its entry is renamed away within the same function", async () => {
      await createFile("supabase/functions/hello/index.ts");

      await renameFileTool.execute(
        {
          from: "supabase/functions/hello/index.ts",
          to: "supabase/functions/hello/main.ts",
        },
        context(),
      );

      expect(deleteSupabaseFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 123456,
          supabaseProjectId: "project-id",
          functionName: "hello",
          organizationSlug: null,
        }),
      );
      expect(deploySupabaseFunction).not.toHaveBeenCalled();
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
          appId: 123456,
          supabaseProjectId: "project-id",
          functionName: "hello",
          appPath,
          organizationSlug: null,
        }),
      );
      expect(deploySupabaseFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 123456,
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

      expect(deleteSupabaseFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 123456,
          supabaseProjectId: "project-id",
          functionName: "hello",
          organizationSlug: null,
        }),
      );
      expect(deploySupabaseFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 123456,
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
      expect(deploySupabaseFunction).not.toHaveBeenCalled();
      expect(ctx.pendingFunctionDeploys).toEqual(["hello"]);
    });

    it("defers the source redeploy when shared modules changed earlier in the turn", async () => {
      await createFile("supabase/functions/hello/index.ts");
      await createFile("supabase/functions/hello/utils.ts");
      const ctx = context({ isSharedModulesChanged: true });

      await renameFileTool.execute(
        {
          from: "supabase/functions/hello/utils.ts",
          to: "supabase/functions/world/utils.ts",
        },
        ctx,
      );

      expect(deleteSupabaseFunction).not.toHaveBeenCalled();
      expect(deploySupabaseFunction).not.toHaveBeenCalled();
      expect(ctx.pendingFunctionDeploys).toEqual(["hello", "world"]);
    });

    it("reports a failed source redeploy and still deploys the target", async () => {
      await createFile("supabase/functions/hello/index.ts");
      await createFile("supabase/functions/hello/utils.ts");
      deploySupabaseFunction.mockImplementation(async ({ functionName }) => {
        if (functionName === "hello") {
          throw new Error("bundle failed");
        }
      });

      const result = await renameFileTool.execute(
        {
          from: "supabase/functions/hello/utils.ts",
          to: "supabase/functions/world/index.ts",
        },
        context(),
      );

      expect(result).toBe(
        "File renamed, but failed to reconcile Supabase function: Error: bundle failed",
      );
      expect(
        renameFileTool.shouldTrackMutation?.({} as any, result, context()),
      ).toBe(true);
      expect(deploySupabaseFunction).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "world" }),
      );
      expect(queueCloudSandboxSnapshotSync).toHaveBeenCalled();
    });
  },
);
