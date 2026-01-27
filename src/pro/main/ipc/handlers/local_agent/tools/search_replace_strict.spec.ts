import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { searchReplaceStrictTool } from "./search_replace_strict";
import type { AgentContext } from "./types";

// Mock fs module
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      existsSync: vi.fn(),
      writeFileSync: vi.fn(),
      promises: {
        readFile: vi.fn(),
      },
    },
  };
});

// Mock electron-log
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// Mock path utils
vi.mock("@/ipc/utils/path_utils", () => ({
  safeJoin: (base: string, path: string) => `${base}/${path}`,
}));

describe("searchReplaceStrictTool", () => {
  const mockContext: AgentContext = {
    event: {} as any,
    appId: 1,
    appPath: "/test/app",
    chatId: 1,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    messageId: 1,
    isSharedModulesChanged: false,
    todos: [],
    dyadRequestId: "test-request",
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn().mockResolvedValue(true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("schema validation", () => {
    it("has the correct name", () => {
      expect(searchReplaceStrictTool.name).toBe("search_replace");
    });

    it("has modifiesState set to true", () => {
      expect(searchReplaceStrictTool.modifiesState).toBe(true);
    });

    it("validates required fields", () => {
      const schema = searchReplaceStrictTool.inputSchema;

      // Missing all fields
      expect(() => schema.parse({})).toThrow();

      // Missing new_string
      expect(() =>
        schema.parse({
          file_path: "test.ts",
          old_string: "old",
        }),
      ).toThrow();

      // Missing old_string
      expect(() =>
        schema.parse({
          file_path: "test.ts",
          new_string: "new",
        }),
      ).toThrow();

      // All required fields present
      expect(() =>
        schema.parse({
          file_path: "test.ts",
          old_string: "old",
          new_string: "new",
        }),
      ).not.toThrow();
    });
  });

  describe("execute validation", () => {
    it("errors when old_string equals new_string", async () => {
      await expect(
        searchReplaceStrictTool.execute(
          {
            file_path: "test.ts",
            old_string: "same content\nline2\nline3",
            new_string: "same content\nline2\nline3",
          },
          mockContext,
        ),
      ).rejects.toThrow("old_string and new_string must be different");
    });

    it("errors when old_string has fewer than 3 lines", async () => {
      await expect(
        searchReplaceStrictTool.execute(
          {
            file_path: "test.ts",
            old_string: "single line",
            new_string: "replacement",
          },
          mockContext,
        ),
      ).rejects.toThrow(/must include at least 3 lines/);

      await expect(
        searchReplaceStrictTool.execute(
          {
            file_path: "test.ts",
            old_string: "line1\nline2",
            new_string: "replacement",
          },
          mockContext,
        ),
      ).rejects.toThrow(/must include at least 3 lines/);
    });

    it("passes validation with exactly 3 lines", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        "line1\nline2\nline3\nline4",
      );

      await expect(
        searchReplaceStrictTool.execute(
          {
            file_path: "test.ts",
            old_string: "line1\nline2\nline3",
            new_string: "NEW1\nNEW2\nNEW3",
          },
          mockContext,
        ),
      ).resolves.toContain("Successfully");

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("errors when file does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(
        searchReplaceStrictTool.execute(
          {
            file_path: "nonexistent.ts",
            old_string: "line1\nline2\nline3",
            new_string: "new1\nnew2\nnew3",
          },
          mockContext,
        ),
      ).rejects.toThrow("File does not exist: nonexistent.ts");
    });
  });

  describe("execute integration", () => {
    it("successfully replaces content with exact match", async () => {
      const originalContent = [
        "function test() {",
        "  const x = 1;",
        "  const y = 2;",
        "  return x + y;",
        "}",
      ].join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(originalContent);

      const result = await searchReplaceStrictTool.execute(
        {
          file_path: "test.ts",
          old_string: "  const x = 1;\n  const y = 2;\n  return x + y;",
          new_string: "  const a = 10;\n  const b = 20;\n  return a + b;",
        },
        mockContext,
      );

      expect(result).toContain("Successfully");
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/test/app/test.ts",
        expect.stringContaining("const a = 10"),
      );
    });

    it("errors on ambiguous matches (multiple occurrences)", async () => {
      const originalContent = [
        "function test1() {",
        "  console.log('hello');",
        "  return true;",
        "}",
        "function test2() {",
        "  console.log('hello');",
        "  return true;",
        "}",
      ].join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(originalContent);

      await expect(
        searchReplaceStrictTool.execute(
          {
            file_path: "test.ts",
            old_string: "  console.log('hello');\n  return true;\n}",
            new_string: "  console.log('goodbye');\n  return false;\n}",
          },
          mockContext,
        ),
      ).rejects.toThrow(/ambiguous|multiple/i);
    });

    it("errors when no exact match found (no fuzzy fallback)", async () => {
      const originalContent = [
        "function test() {",
        "\tconsole.log('hello');", // Tab indentation
        "\treturn true;",
        "}",
      ].join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(originalContent);

      // Using spaces instead of tabs - would match with lenient mode but not exact
      await expect(
        searchReplaceStrictTool.execute(
          {
            file_path: "test.ts",
            old_string:
              "function test() {\n  console.log('hello');\n  return true;",
            new_string:
              "function test() {\n  console.log('goodbye');\n  return false;",
          },
          mockContext,
        ),
      ).rejects.toThrow(/did not match exactly/i);
    });
  });

  describe("buildXml", () => {
    it("returns undefined when file_path is missing", () => {
      const result = searchReplaceStrictTool.buildXml?.({}, false);
      expect(result).toBeUndefined();
    });

    it("builds partial XML during streaming", () => {
      const result = searchReplaceStrictTool.buildXml?.(
        {
          file_path: "test.ts",
          old_string: "old content",
        },
        false,
      );
      expect(result).toContain('path="test.ts"');
      expect(result).toContain("<<<<<<< SEARCH");
      expect(result).toContain("old content");
      expect(result).not.toContain(">>>>>>> REPLACE");
    });

    it("builds complete XML on finish", () => {
      const result = searchReplaceStrictTool.buildXml?.(
        {
          file_path: "test.ts",
          old_string: "old content",
          new_string: "new content",
        },
        true,
      );
      expect(result).toContain('path="test.ts"');
      expect(result).toContain("<<<<<<< SEARCH");
      expect(result).toContain("old content");
      expect(result).toContain("=======");
      expect(result).toContain("new content");
      expect(result).toContain(">>>>>>> REPLACE");
      expect(result).toContain("</dyad-search-replace>");
    });
  });

  describe("getConsentPreview", () => {
    it("returns preview with file path", () => {
      const preview = searchReplaceStrictTool.getConsentPreview?.({
        file_path: "src/test.ts",
        old_string: "old",
        new_string: "new",
      });
      expect(preview).toBe("Edit src/test.ts");
    });
  });
});
