import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import { deleteFileTool } from "./delete_file";
import type { AgentContext } from "./types";
import { gitRemove } from "@/ipc/utils/git_utils";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      existsSync: vi.fn(),
      lstatSync: vi.fn(),
      rmdirSync: vi.fn(),
      unlinkSync: vi.fn(),
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

describe("deleteFileTool", () => {
  const mockContext: AgentContext = {
    event: {} as any,
    appId: 1,
    appPath: "/test/app",
    chatId: 1,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    messageId: 1,
    isSharedModulesChanged: false,
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
      } as any);

      const result = await deleteFileTool.execute(
        { path: "src/file.ts" },
        mockContext,
      );

      expect(fs.unlinkSync).toHaveBeenCalledWith("/test/app/src/file.ts");
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
      } as any);

      const result = await deleteFileTool.execute(
        { path: "src/dir" },
        mockContext,
      );

      expect(fs.rmdirSync).toHaveBeenCalledWith("/test/app/src/dir", {
        recursive: true,
      });
      expect(fs.unlinkSync).not.toHaveBeenCalled();
      expect(result).toBe("Successfully deleted src/dir");
    });
  });

  describe("buildXml", () => {
    it("returns undefined for blank path", () => {
      const result = deleteFileTool.buildXml?.({ path: "   " }, false);
      expect(result).toBeUndefined();
    });
  });
});
