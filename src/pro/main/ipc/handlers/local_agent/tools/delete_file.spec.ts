import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { deleteFileTool } from "./delete_file";
import type { AgentContext } from "./types";
import { gitRemove } from "@/ipc/utils/git_utils";
import { deleteSupabaseFunction } from "../../../../../../supabase_admin/supabase_management_client";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      existsSync: vi.fn(),
      realpathSync: vi.fn((filePath: string) => filePath),
      lstatSync: vi.fn(),
      rmdirSync: vi.fn(),
      unlinkSync: vi.fn(),
      promises: {
        realpath: vi.fn(async (filePath: string) => filePath),
        lstat: vi.fn(),
      },
    },
  };
});

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("@/ipc/utils/git_utils", () => ({
  gitRemove: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../../../supabase_admin/supabase_management_client", () => ({
  deleteSupabaseFunction: vi.fn().mockResolvedValue(undefined),
}));

function resolveSelfAlias(appPath: string, filePath: unknown): string {
  const targetPath = String(filePath);
  const aliasPath = path.join(appPath, "self");
  const relativePath = path.relative(aliasPath, targetPath);
  if (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  ) {
    return path.join(appPath, relativePath);
  }
  return targetPath;
}

describe("deleteFileTool", () => {
  const mockContext: AgentContext = {
    event: {} as any,
    appId: 1,
    appPath: "/test/app",
    referencedApps: new Map(),
    chatId: 1,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    messageId: 1,
    isSharedModulesChanged: false,
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
    isDyadPro: false,
    todos: [],
    dyadRequestId: "test-request",
    fileEditTracker: {},
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn().mockResolvedValue(true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.realpathSync).mockImplementation((filePath) =>
      String(filePath),
    );
    vi.mocked(fs.promises.realpath).mockImplementation(async (filePath) =>
      String(filePath),
    );
  });

  describe("schema validation", () => {
    it("rejects empty path", () => {
      const schema = deleteFileTool.inputSchema;
      expect(() => schema.parse({ path: "" })).toThrow("Path cannot be empty");
    });

    it("rejects whitespace-only path", () => {
      const schema = deleteFileTool.inputSchema;
      expect(() => schema.parse({ path: "   " })).toThrow(
        "Path cannot be empty",
      );
    });
  });

  describe("execute safety checks", () => {
    it.each([".", "./", ".\\", "foo/..", "foo\\.."])(
      "rejects project-root-equivalent path: %s",
      async (path) => {
        await expect(
          deleteFileTool.execute({ path }, mockContext),
        ).rejects.toThrow(/Refusing to delete project root/);

        expect(fs.existsSync).not.toHaveBeenCalled();
        expect(fs.unlinkSync).not.toHaveBeenCalled();
        expect(fs.rmdirSync).not.toHaveBeenCalled();
        expect(gitRemove).not.toHaveBeenCalled();
      },
    );
  });

  describe("execute delete behavior", () => {
    it("deletes files with unlink and removes from git", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.lstatSync).mockReturnValue({
        isDirectory: () => false,
        isSymbolicLink: () => false,
      } as any);

      const result = await deleteFileTool.execute(
        { path: "src/file.ts" },
        mockContext,
      );

      expect(fs.unlinkSync).toHaveBeenCalledWith(
        path.join(mockContext.appPath, "src/file.ts"),
      );
      expect(fs.rmdirSync).not.toHaveBeenCalled();
      expect(gitRemove).toHaveBeenCalledWith({
        path: "/test/app",
        filepath: "src/file.ts",
      });
      expect(result).toBe("Successfully deleted src/file.ts");
    });

    it("deletes directories with rmdir recursive", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.lstatSync).mockReturnValue({
        isDirectory: () => true,
        isSymbolicLink: () => false,
      } as any);

      const result = await deleteFileTool.execute(
        { path: "src/dir" },
        mockContext,
      );

      expect(fs.rmdirSync).toHaveBeenCalledWith(
        path.join(mockContext.appPath, "src/dir"),
        {
          recursive: true,
        },
      );
      expect(fs.unlinkSync).not.toHaveBeenCalled();
      expect(result).toBe("Successfully deleted src/dir");
    });

    it("uses the normalized path for shared Supabase modules", async () => {
      vi.mocked(fs.lstatSync).mockReturnValue({
        isDirectory: () => false,
        isSymbolicLink: () => false,
      } as any);
      const context = {
        ...mockContext,
        isSharedModulesChanged: false,
        sharedServerModulePaths: [],
      };

      await deleteFileTool.execute(
        { path: "supabase\\functions\\_shared\\util.ts" },
        context,
      );

      expect(context.isSharedModulesChanged).toBe(true);
      expect(context.sharedServerModulePaths).toEqual([
        "supabase/functions/_shared/util.ts",
      ]);
    });

    it("uses the canonical path for deployed Supabase functions", async () => {
      vi.mocked(fs.lstatSync).mockReturnValue({
        isDirectory: () => false,
        isSymbolicLink: () => false,
      } as any);
      vi.mocked(fs.realpathSync).mockImplementation((filePath) =>
        resolveSelfAlias(mockContext.appPath, filePath),
      );
      vi.mocked(fs.promises.realpath).mockImplementation(async (filePath) =>
        resolveSelfAlias(mockContext.appPath, filePath),
      );
      const context = {
        ...mockContext,
        supabaseProjectId: "project-id",
      };

      await deleteFileTool.execute(
        { path: "self/supabase/functions/hello-world/index.ts" },
        context,
      );

      expect(fs.unlinkSync).toHaveBeenCalledWith(
        path.join(
          mockContext.appPath,
          "supabase/functions/hello-world/index.ts",
        ),
      );
      expect(gitRemove).toHaveBeenCalledWith({
        path: "/test/app",
        filepath: "supabase/functions/hello-world/index.ts",
      });
      expect(deleteSupabaseFunction).toHaveBeenCalledWith({
        supabaseProjectId: "project-id",
        functionName: "hello-world",
        organizationSlug: null,
      });
    });
  });

  describe("buildXml", () => {
    it("returns undefined for blank path", () => {
      const result = deleteFileTool.buildXml?.({ path: "   " }, false);
      expect(result).toBeUndefined();
    });
  });
});
