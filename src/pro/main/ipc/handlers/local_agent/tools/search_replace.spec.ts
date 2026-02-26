import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { searchReplaceTool } from "./search_replace";
import type { AgentContext } from "./types";

// Mock fs module
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      existsSync: vi.fn(),
      promises: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
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
      debug: vi.fn(),
    }),
  },
}));

// Mock path utils
vi.mock("@/ipc/utils/path_utils", () => ({
  safeJoin: (base: string, path: string) => `${base}/${path}`,
}));

describe("searchReplaceTool", () => {
  const mockContext: AgentContext = {
    event: {} as any,
    appId: 1,
    appPath: "/test/app",
    chatId: 1,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("schema validation", () => {
    it("has the correct name", () => {
      expect(searchReplaceTool.name).toBe("search_replace");
    });

    it("has modifiesState set to true", () => {
      expect(searchReplaceTool.modifiesState).toBe(true);
    });

    it("validates required fields", () => {
      const schema = searchReplaceTool.inputSchema;

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
        searchReplaceTool.execute(
          {
            file_path: "test.ts",
            old_string: "same content\nline2\nline3",
            new_string: "same content\nline2\nline3",
          },
          mockContext,
        ),
      ).rejects.toThrow("old_string and new_string must be different");
    });

    it("errors when file does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(
        searchReplaceTool.execute(
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

      const result = await searchReplaceTool.execute(
        {
          file_path: "test.ts",
          old_string: "  const x = 1;\n  const y = 2;\n  return x + y;",
          new_string: "  const a = 10;\n  const b = 20;\n  return a + b;",
        },
        mockContext,
      );

      expect(result).toContain("Successfully");
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        "/test/app/test.ts",
        expect.stringContaining("const a = 10"),
      );
    });

    it("escapes marker-like lines inside content to avoid parser splitting", async () => {
      const originalContent = [
        "start",
        "<<<<<<< HEAD",
        "const x = 1;",
        "=======",
        "const x = 2;",
        ">>>>>>> branch",
        "end",
      ].join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(originalContent);

      const result = await searchReplaceTool.execute(
        {
          file_path: "test.ts",
          old_string: [
            "<<<<<<< HEAD",
            "const x = 1;",
            "=======",
            "const x = 2;",
            ">>>>>>> branch",
          ].join("\n"),
          new_string: "const x = 42;",
        },
        mockContext,
      );

      expect(result).toContain("Successfully");
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        "/test/app/test.ts",
        expect.stringContaining("const x = 42;"),
      );

      const written = vi.mocked(fs.promises.writeFile).mock.calls[0]?.[1];
      expect(String(written)).not.toContain("<<<<<<< HEAD");
      expect(String(written)).not.toContain("=======");
      expect(String(written)).not.toContain(">>>>>>> branch");
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
        searchReplaceTool.execute(
          {
            file_path: "test.ts",
            old_string: "  console.log('hello');\n  return true;\n}",
            new_string: "  console.log('goodbye');\n  return false;\n}",
          },
          mockContext,
        ),
      ).rejects.toThrow(/ambiguous|multiple/i);
    });

    it("matches with fuzzy matching when whitespace differs", async () => {
      const originalContent = [
        "function test() {",
        "\tconsole.log('hello');", // Tab indentation
        "\treturn true;",
        "}",
      ].join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(originalContent);

      // Using spaces instead of tabs - matches via fuzzy matching
      const result = await searchReplaceTool.execute(
        {
          file_path: "test.ts",
          old_string:
            "function test() {\n  console.log('hello');\n  return true;",
          new_string:
            "function test() {\n  console.log('goodbye');\n  return false;",
        },
        mockContext,
      );

      expect(result).toContain("Successfully");
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        "/test/app/test.ts",
        expect.stringContaining("console.log('goodbye')"),
      );
    });

    it("matches when old_string has extra trailing newline not in source", async () => {
      const originalContent = [
        "function test() {",
        "  const x = 1;",
        "  return x;",
        "}",
      ].join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(originalContent);

      // old_string has trailing newline that doesn't exist in file - should still match
      const result = await searchReplaceTool.execute(
        {
          file_path: "test.ts",
          old_string: "  const x = 1;\n  return x;\n", // Extra trailing newline
          new_string: "  const y = 2;\n  return y;",
        },
        mockContext,
      );

      expect(result).toContain("Successfully");
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        "/test/app/test.ts",
        expect.stringContaining("const y = 2"),
      );
    });

    it("matches when old_string has extra leading newline not in source", async () => {
      const originalContent = [
        "function test() {",
        "  const x = 1;",
        "  return x;",
        "}",
      ].join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(originalContent);

      // old_string has leading newline that doesn't exist in file - should still match
      const result = await searchReplaceTool.execute(
        {
          file_path: "test.ts",
          old_string: "\n  const x = 1;\n  return x;", // Extra leading newline
          new_string: "  const y = 2;\n  return y;",
        },
        mockContext,
      );

      expect(result).toContain("Successfully");
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        "/test/app/test.ts",
        expect.stringContaining("const y = 2"),
      );
    });

    it("matches when old_string has both leading and trailing newlines", async () => {
      const originalContent = [
        "function test() {",
        "  const x = 1;",
        "  return x;",
        "}",
      ].join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(originalContent);

      // old_string has both leading and trailing newlines - should still match
      const result = await searchReplaceTool.execute(
        {
          file_path: "test.ts",
          old_string: "\n\n  const x = 1;\n  return x;\n\n", // Extra newlines on both ends
          new_string: "  const y = 2;\n  return y;",
        },
        mockContext,
      );

      expect(result).toContain("Successfully");
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        "/test/app/test.ts",
        expect.stringContaining("const y = 2"),
      );
    });
  });

  describe("buildXml", () => {
    it("returns undefined when file_path is missing", () => {
      const result = searchReplaceTool.buildXml?.({}, false);
      expect(result).toBeUndefined();
    });

    it("builds partial XML during streaming", () => {
      const result = searchReplaceTool.buildXml?.(
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
      const result = searchReplaceTool.buildXml?.(
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
      const preview = searchReplaceTool.getConsentPreview?.({
        file_path: "src/test.ts",
        old_string: "old",
        new_string: "new",
      });
      expect(preview).toBe("Edit src/test.ts");
    });
  });

  describe("line number stripping", () => {
    it("strips line number prefixes from old_string and matches", async () => {
      const originalContent = [
        "function greet() {",
        "  console.log('Hello');",
        "  return true;",
        "}",
      ].join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(originalContent);

      // old_string has line number prefixes (as if copied from read_file output)
      const result = await searchReplaceTool.execute(
        {
          file_path: "test.ts",
          old_string: "1| function greet() {\n2|   console.log('Hello');",
          new_string: "function greet() {\n  console.log('Hi there');",
        },
        mockContext,
      );

      expect(result).toContain("Successfully");
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        "/test/app/test.ts",
        expect.stringContaining("console.log('Hi there')"),
      );
    });

    it("strips line number prefixes from both old_string and new_string", async () => {
      const originalContent = [
        "function test() {",
        "  const x = 1;",
        "  return x;",
        "}",
      ].join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(originalContent);

      const result = await searchReplaceTool.execute(
        {
          file_path: "test.ts",
          old_string: "1| function test() {\n2|   const x = 1;",
          new_string: "1| function test() {\n2|   const y = 2;",
        },
        mockContext,
      );

      expect(result).toContain("Successfully");
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        "/test/app/test.ts",
        expect.stringContaining("const y = 2"),
      );
    });

    it("handles padded line numbers (right-aligned)", async () => {
      const originalContent = Array.from(
        { length: 15 },
        (_, i) => `line ${i + 1}`,
      ).join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(originalContent);

      // Padded line numbers for a file with 15+ lines
      const result = await searchReplaceTool.execute(
        {
          file_path: "test.ts",
          old_string: "10| line 10\n11| line 11\n12| line 12",
          new_string: "line 10 modified\nline 11 modified\nline 12 modified",
        },
        mockContext,
      );

      expect(result).toContain("Successfully");
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        "/test/app/test.ts",
        expect.stringContaining("line 10 modified"),
      );
    });
  });

  describe("enhanced error messages", () => {
    it("provides detailed error message for no-match failures", async () => {
      const originalContent = [
        "function greet() {",
        "  console.log('Hello');",
        "  return true;",
        "}",
      ].join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(originalContent);

      await expect(
        searchReplaceTool.execute(
          {
            file_path: "test.ts",
            old_string:
              "function greet() {\n  console.log('Hi there');\n  return true;\n}",
            new_string:
              "function greet() {\n  console.log('Hello World');\n  return true;\n}",
          },
          mockContext,
        ),
      ).rejects.toThrow(/SEARCH CONTENT|BEST PARTIAL MATCH|SUGGESTION/);
    });

    it("provides detailed error message for ambiguous matches", async () => {
      const originalContent = ["foo", "bar", "baz", "bar", "qux"].join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(originalContent);

      await expect(
        searchReplaceTool.execute(
          {
            file_path: "test.ts",
            old_string: "bar",
            new_string: "BAR",
          },
          mockContext,
        ),
      ).rejects.toThrow(/MATCHED LOCATIONS|SUGGESTION|context/i);
    });
  });
});
