import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { grepTool } from "./grep";
import type { AgentContext } from "./types";

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

// Mock only the ripgrep path resolver to point to the real binary in node_modules
vi.mock("@/ipc/utils/ripgrep_utils", () => ({
  getRgExecutablePath: () => {
    const isWindows = os.platform() === "win32";
    const executableName = isWindows ? "rg.exe" : "rg";
    // Point to the actual ripgrep binary in node_modules
    return path.join(
      process.cwd(),
      "node_modules",
      "@vscode",
      "ripgrep",
      "bin",
      executableName,
    );
  },
  MAX_FILE_SEARCH_SIZE: 1024 * 1024,
  RIPGREP_EXCLUDED_GLOBS: ["!node_modules/**", "!.git/**", "!.next/**"],
}));

describe("grepTool", () => {
  let testDir: string;
  let mockContext: AgentContext;

  beforeEach(async () => {
    // Create a temp directory with test files
    testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "grep-test-"));

    // Create test files
    await fs.promises.writeFile(
      path.join(testDir, "test1.ts"),
      `function hello() {
  console.log("hello world");
  return true;
}

function goodbye() {
  console.log("goodbye world");
  return false;
}`,
    );

    await fs.promises.writeFile(
      path.join(testDir, "test2.ts"),
      `const HELLO = "greeting";
const GOODBYE = "farewell";

export function greet(name: string) {
  return \`Hello, \${name}!\`;
}`,
    );

    await fs.promises.writeFile(
      path.join(testDir, "readme.md"),
      `# Hello Project
This is a hello world example.
Say goodbye when you leave.`,
    );

    await fs.promises.mkdir(path.join(testDir, "nested"));
    await fs.promises.writeFile(
      path.join(testDir, "nested", "deep.ts"),
      `// Deep nested file
function deepHello() {
  return "hello from the deep";
}`,
    );

    mockContext = {
      event: {} as any,
      appId: 1,
      appPath: testDir,
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
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.promises.rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("schema validation", () => {
    it("has the correct name", () => {
      expect(grepTool.name).toBe("grep");
    });

    it("has defaultConsent set to always", () => {
      expect(grepTool.defaultConsent).toBe("always");
    });

    it("validates required query field", () => {
      const schema = grepTool.inputSchema;

      // Missing query
      expect(() => schema.parse({})).toThrow();

      // With query
      expect(() => schema.parse({ query: "hello" })).not.toThrow();
    });

    it("validates limit bounds", () => {
      const schema = grepTool.inputSchema;

      // Limit too low
      expect(() => schema.parse({ query: "test", limit: 0 })).toThrow();

      // Limit too high
      expect(() => schema.parse({ query: "test", limit: 251 })).toThrow();

      // Valid limits
      expect(() => schema.parse({ query: "test", limit: 1 })).not.toThrow();
      expect(() => schema.parse({ query: "test", limit: 250 })).not.toThrow();
    });
  });

  describe("execute - basic search", () => {
    it("finds matches across multiple files", async () => {
      const result = await grepTool.execute({ query: "hello" }, mockContext);

      expect(result).toContain("test1.ts");
      expect(result).toContain("test2.ts");
      expect(result).toContain("readme.md");
      expect(result).toContain("nested/deep.ts");
    });

    it("returns line numbers", async () => {
      const result = await grepTool.execute({ query: "goodbye" }, mockContext);

      // Should contain file:line: format
      expect(result).toMatch(/test1\.ts:\d+:/);
      expect(result).toMatch(/test2\.ts:\d+:/);
    });

    it("returns no matches found when nothing matches", async () => {
      const result = await grepTool.execute(
        { query: "nonexistent_pattern_xyz" },
        mockContext,
      );

      expect(result).toBe("No matches found.");
    });

    it("calls onXmlComplete with proper XML for no matches", async () => {
      await grepTool.execute({ query: "nonexistent_pattern_xyz" }, mockContext);

      expect(mockContext.onXmlComplete).toHaveBeenCalledWith(
        expect.stringContaining("No matches found."),
      );
      expect(mockContext.onXmlComplete).toHaveBeenCalledWith(
        expect.stringContaining("query="),
      );
    });

    it("calls onXmlComplete with proper XML for matches", async () => {
      await grepTool.execute({ query: "hello" }, mockContext);

      expect(mockContext.onXmlComplete).toHaveBeenCalledWith(
        expect.stringContaining("<dyad-grep"),
      );
      expect(mockContext.onXmlComplete).toHaveBeenCalledWith(
        expect.stringContaining("</dyad-grep>"),
      );
    });
  });

  describe("execute - case sensitivity", () => {
    it("is case-insensitive by default", async () => {
      const result = await grepTool.execute({ query: "HELLO" }, mockContext);

      // Should find lowercase "hello" too
      expect(result).toContain("test1.ts");
      expect(result).toContain("hello world");
    });

    it("respects case_sensitive option", async () => {
      const result = await grepTool.execute(
        { query: "HELLO", case_sensitive: true },
        mockContext,
      );

      // Should only find "HELLO" (uppercase constant in test2.ts)
      expect(result).toContain("test2.ts");
      expect(result).not.toContain("hello world");
    });
  });

  describe("execute - file filtering", () => {
    it("filters by include_pattern", async () => {
      const result = await grepTool.execute(
        { query: "hello", include_pattern: "*.md" },
        mockContext,
      );

      expect(result).toContain("readme.md");
      expect(result).not.toContain("test1.ts");
      expect(result).not.toContain("test2.ts");
    });

    it("filters by exclude_pattern", async () => {
      const result = await grepTool.execute(
        { query: "hello", exclude_pattern: "*.md" },
        mockContext,
      );

      expect(result).toContain("test1.ts");
      expect(result).not.toContain("readme.md");
    });

    it("supports glob patterns for nested files", async () => {
      const result = await grepTool.execute(
        { query: "hello", include_pattern: "nested/**" },
        mockContext,
      );

      expect(result).toContain("nested/deep.ts");
      expect(result).not.toContain("test1.ts");
    });

    it("does not search node_modules even with include_pattern '*'", async () => {
      // Create a node_modules directory with a matching file
      const nodeModulesDir = path.join(testDir, "node_modules", "some-pkg");
      await fs.promises.mkdir(nodeModulesDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(nodeModulesDir, "index.js"),
        `function hello() { return "hello from node_modules"; }`,
      );

      const result = await grepTool.execute(
        { query: "hello", include_pattern: "*" },
        mockContext,
      );

      // Should find matches in project files but NOT in node_modules
      expect(result).toContain("test1.ts");
      expect(result).not.toContain("node_modules");
      // Should warn the LLM that "*" was ignored
      expect(result).toContain(
        'include_pattern="*" was ignored because it matches all files',
      );
    });

    it("does not search node_modules without include_pattern", async () => {
      // Create a node_modules directory with a matching file
      const nodeModulesDir = path.join(testDir, "node_modules", "some-pkg");
      await fs.promises.mkdir(nodeModulesDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(nodeModulesDir, "index.js"),
        `function hello() { return "hello from node_modules"; }`,
      );

      const result = await grepTool.execute({ query: "hello" }, mockContext);

      // Should find matches in project files but NOT in node_modules
      expect(result).toContain("test1.ts");
      expect(result).not.toContain("node_modules");
    });
  });

  describe("execute - regex patterns", () => {
    it("supports basic regex", async () => {
      const result = await grepTool.execute(
        { query: "function \\w+" },
        mockContext,
      );

      expect(result).toContain("function hello");
      expect(result).toContain("function goodbye");
      expect(result).toContain("function greet");
    });

    it("supports character classes", async () => {
      const result = await grepTool.execute({ query: "[hg]ello" }, mockContext);

      expect(result).toContain("hello");
    });

    it("supports alternation", async () => {
      const result = await grepTool.execute(
        { query: "hello|goodbye" },
        mockContext,
      );

      expect(result).toContain("hello");
      expect(result).toContain("goodbye");
    });
  });

  describe("execute - result limiting", () => {
    it("respects limit parameter", async () => {
      const result = await grepTool.execute(
        { query: "hello", limit: 2 },
        mockContext,
      );

      // Count the number of result lines (file:line: format)
      const matchLines = result
        .split("\n")
        .filter((line) => line.match(/:\d+:/));
      expect(matchLines.length).toBeLessThanOrEqual(2);
    });

    it("includes truncation notice when results are limited", async () => {
      const result = await grepTool.execute(
        { query: "hello", limit: 1 },
        mockContext,
      );

      expect(result).toMatchInlineSnapshot(`
        "nested/deep.ts:2: function deepHello() {

        [TRUNCATED: Showing 1 of 8 matches. Use include_pattern to narrow your search (e.g., include_pattern="*.tsx") or use a more specific query.]"
      `);
    });

    it("includes truncation info in XML attributes", async () => {
      await grepTool.execute({ query: "hello", limit: 1 }, mockContext);

      expect(mockContext.onXmlComplete).toHaveBeenCalledWith(
        expect.stringContaining('truncated="true"'),
      );
      expect(mockContext.onXmlComplete).toHaveBeenCalledWith(
        expect.stringContaining('total="'),
      );
    });
  });

  describe("execute - result sorting", () => {
    it("returns results sorted by path then line number", async () => {
      const result = await grepTool.execute({ query: "hello" }, mockContext);

      const lines = result.split("\n").filter((line) => line.match(/:\d+:/));
      const paths = lines.map((line) => line.split(":")[0]);

      // Verify paths are sorted
      const sortedPaths = [...paths].sort();
      expect(paths).toEqual(sortedPaths);

      // Verify line numbers within same file are sorted
      const pathToLines = new Map<string, number[]>();
      for (const line of lines) {
        const [path, lineNum] = line.split(":");
        if (!pathToLines.has(path)) {
          pathToLines.set(path, []);
        }
        pathToLines.get(path)!.push(Number.parseInt(lineNum, 10));
      }

      // Check each file's line numbers are sorted
      for (const [_path, lineNums] of pathToLines.entries()) {
        const sortedLineNums = [...lineNums].sort((a, b) => a - b);
        expect(lineNums).toEqual(sortedLineNums);
      }
    });
  });

  describe("execute - line truncation", () => {
    it("truncates lines longer than 500 characters", async () => {
      // Create a file with a very long line
      const longLine = "x".repeat(600);
      await fs.promises.writeFile(
        path.join(testDir, "long.ts"),
        `const short = "hello";\nconst veryLongVariable = "${longLine}";\n`,
      );

      const result = await grepTool.execute(
        { query: "veryLongVariable" },
        mockContext,
      );

      const lines = result.split("\n").filter((line) => line.match(/:\d+:/));
      expect(lines.length).toBe(1);

      // Extract the content after "path:lineNum: "
      const match = lines[0].match(/^[^:]+:\d+:\s+(.*)$/);
      expect(match).toBeTruthy();
      const content = match![1];

      // Should be truncated to 500 chars + "..." suffix (503 total)
      expect(content.length).toBe(503);
      expect(content.endsWith("...")).toBe(true);
    });
  });

  describe("buildXml", () => {
    it("returns undefined when query is missing", () => {
      const result = grepTool.buildXml?.({}, false);
      expect(result).toBeUndefined();
    });

    it("returns undefined when complete (execute handles final XML)", () => {
      const result = grepTool.buildXml?.({ query: "hello" }, true);
      expect(result).toBeUndefined();
    });

    it("builds partial XML during streaming", () => {
      const result = grepTool.buildXml?.({ query: "hello" }, false);
      expect(result).toContain("<dyad-grep");
      expect(result).toContain('query="hello"');
      expect(result).toContain("Searching...");
    });

    it("escapes special XML characters in query", () => {
      const result = grepTool.buildXml?.(
        { query: 'test <tag> & "quote"' },
        false,
      );
      expect(result).toContain("&lt;tag&gt;");
      expect(result).toContain("&amp;");
      expect(result).toContain("&quot;");
    });

    it("includes include_pattern in attributes", () => {
      const result = grepTool.buildXml?.(
        { query: "test", include_pattern: "*.ts" },
        false,
      );
      expect(result).toContain('include="*.ts"');
    });

    it("includes exclude_pattern in attributes", () => {
      const result = grepTool.buildXml?.(
        { query: "test", exclude_pattern: "*.md" },
        false,
      );
      expect(result).toContain('exclude="*.md"');
    });

    it("includes case-sensitive in attributes when true", () => {
      const result = grepTool.buildXml?.(
        { query: "test", case_sensitive: true },
        false,
      );
      expect(result).toContain('case-sensitive="true"');
    });
  });

  describe("getConsentPreview", () => {
    it("returns preview with query", () => {
      const preview = grepTool.getConsentPreview?.({ query: "hello" });
      expect(preview).toBe('Search for "hello"');
    });

    it("includes include_pattern in preview", () => {
      const preview = grepTool.getConsentPreview?.({
        query: "hello",
        include_pattern: "*.ts",
      });
      expect(preview).toBe('Search for "hello" in *.ts');
    });
  });
});
