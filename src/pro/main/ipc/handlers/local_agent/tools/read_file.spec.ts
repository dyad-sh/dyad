import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readFileTool } from "./read_file";
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

describe("readFileTool", () => {
  let testDir: string;
  let mockContext: AgentContext;

  const testFileContent = `line 1
line 2
line 3
line 4
line 5`;

  beforeEach(async () => {
    testDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "read-file-test-"),
    );

    await fs.promises.writeFile(
      path.join(testDir, "test.txt"),
      testFileContent,
    );

    await fs.promises.writeFile(path.join(testDir, "empty.txt"), "");

    await fs.promises.writeFile(
      path.join(testDir, "single-line.txt"),
      "only one line",
    );

    await fs.promises.writeFile(
      path.join(testDir, "trailing-newline.txt"),
      "line 1\nline 2\nline 3\n",
    );

    mockContext = {
      event: {} as any,
      appId: 1,
      appPath: testDir,
      referencedApps: new Map(),
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
  });

  afterEach(async () => {
    await fs.promises.rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("schema validation", () => {
    it("has the correct name", () => {
      expect(readFileTool.name).toBe("read_file");
    });

    it("has defaultConsent set to always", () => {
      expect(readFileTool.defaultConsent).toBe("always");
    });

    it("requires path", () => {
      const schema = readFileTool.inputSchema;
      expect(() => schema.parse({})).toThrow();
      expect(() => schema.parse({ path: "foo.txt" })).not.toThrow();
    });

    it("accepts optional start_line_one_indexed", () => {
      const schema = readFileTool.inputSchema;
      expect(() =>
        schema.parse({ path: "foo.txt", start_line_one_indexed: 5 }),
      ).not.toThrow();
    });

    it("accepts optional end_line_one_indexed_inclusive", () => {
      const schema = readFileTool.inputSchema;
      expect(() =>
        schema.parse({ path: "foo.txt", end_line_one_indexed_inclusive: 10 }),
      ).not.toThrow();
    });

    it("accepts both line range params together", () => {
      const schema = readFileTool.inputSchema;
      expect(() =>
        schema.parse({
          path: "foo.txt",
          start_line_one_indexed: 2,
          end_line_one_indexed_inclusive: 4,
        }),
      ).not.toThrow();
    });

    it("rejects start_line_one_indexed less than 1", () => {
      const schema = readFileTool.inputSchema;
      expect(() =>
        schema.parse({ path: "foo.txt", start_line_one_indexed: 0 }),
      ).toThrow();
    });

    it("rejects end_line_one_indexed_inclusive less than 1", () => {
      const schema = readFileTool.inputSchema;
      expect(() =>
        schema.parse({ path: "foo.txt", end_line_one_indexed_inclusive: 0 }),
      ).toThrow();
    });

    it("rejects non-integer line numbers", () => {
      const schema = readFileTool.inputSchema;
      expect(() =>
        schema.parse({ path: "foo.txt", start_line_one_indexed: 1.5 }),
      ).toThrow();
    });

    it("rejects start_line > end_line", () => {
      const schema = readFileTool.inputSchema;
      expect(() =>
        schema.parse({
          path: "foo.txt",
          start_line_one_indexed: 4,
          end_line_one_indexed_inclusive: 2,
        }),
      ).toThrow(
        "start_line_one_indexed must be <= end_line_one_indexed_inclusive",
      );
    });
  });

  describe("execute - full file read", () => {
    it("reads entire file when no line range is specified", async () => {
      const result = await readFileTool.execute(
        { path: "test.txt" },
        mockContext,
      );
      expect(result).toBe(testFileContent);
    });

    it("returns empty string for empty files", async () => {
      const result = await readFileTool.execute(
        { path: "empty.txt" },
        mockContext,
      );
      expect(result).toBe("");
    });

    it("throws error for non-existent file", async () => {
      await expect(
        readFileTool.execute({ path: "nope.txt" }, mockContext),
      ).rejects.toThrow("File does not exist: nope.txt");
    });
  });

  describe("execute - start_line_one_indexed only", () => {
    it("reads from start line to end of file", async () => {
      const result = await readFileTool.execute(
        { path: "test.txt", start_line_one_indexed: 3 },
        mockContext,
      );
      expect(result).toBe("line 3\nline 4\nline 5");
    });

    it("reads from line 1 (same as full file)", async () => {
      const result = await readFileTool.execute(
        { path: "test.txt", start_line_one_indexed: 1 },
        mockContext,
      );
      expect(result).toBe(testFileContent);
    });

    it("reads last line when start equals line count", async () => {
      const result = await readFileTool.execute(
        { path: "test.txt", start_line_one_indexed: 5 },
        mockContext,
      );
      expect(result).toBe("line 5");
    });

    it("returns empty string when start exceeds line count", async () => {
      const result = await readFileTool.execute(
        { path: "test.txt", start_line_one_indexed: 100 },
        mockContext,
      );
      expect(result).toBe("");
    });
  });

  describe("execute - end_line_one_indexed_inclusive only", () => {
    it("reads from beginning to end line", async () => {
      const result = await readFileTool.execute(
        { path: "test.txt", end_line_one_indexed_inclusive: 3 },
        mockContext,
      );
      expect(result).toBe("line 1\nline 2\nline 3");
    });

    it("reads first line only", async () => {
      const result = await readFileTool.execute(
        { path: "test.txt", end_line_one_indexed_inclusive: 1 },
        mockContext,
      );
      expect(result).toBe("line 1");
    });

    it("reads entire file when end equals line count", async () => {
      const result = await readFileTool.execute(
        { path: "test.txt", end_line_one_indexed_inclusive: 5 },
        mockContext,
      );
      expect(result).toBe(testFileContent);
    });

    it("clamps to file length when end exceeds line count", async () => {
      const result = await readFileTool.execute(
        { path: "test.txt", end_line_one_indexed_inclusive: 100 },
        mockContext,
      );
      expect(result).toBe(testFileContent);
    });
  });

  describe("execute - both start and end", () => {
    it("reads a middle range", async () => {
      const result = await readFileTool.execute(
        {
          path: "test.txt",
          start_line_one_indexed: 2,
          end_line_one_indexed_inclusive: 4,
        },
        mockContext,
      );
      expect(result).toBe("line 2\nline 3\nline 4");
    });

    it("reads a single line when start equals end", async () => {
      const result = await readFileTool.execute(
        {
          path: "test.txt",
          start_line_one_indexed: 3,
          end_line_one_indexed_inclusive: 3,
        },
        mockContext,
      );
      expect(result).toBe("line 3");
    });

    it("clamps both to valid range", async () => {
      const result = await readFileTool.execute(
        {
          path: "test.txt",
          start_line_one_indexed: 4,
          end_line_one_indexed_inclusive: 100,
        },
        mockContext,
      );
      expect(result).toBe("line 4\nline 5");
    });
  });

  describe("execute - single-line file", () => {
    it("reads full single-line file", async () => {
      const result = await readFileTool.execute(
        { path: "single-line.txt" },
        mockContext,
      );
      expect(result).toBe("only one line");
    });

    it("reads single-line file with line range", async () => {
      const result = await readFileTool.execute(
        {
          path: "single-line.txt",
          start_line_one_indexed: 1,
          end_line_one_indexed_inclusive: 1,
        },
        mockContext,
      );
      expect(result).toBe("only one line");
    });
  });

  describe("execute - trailing newline file", () => {
    it("preserves trailing newline on full read via line range", async () => {
      const result = await readFileTool.execute(
        {
          path: "trailing-newline.txt",
          start_line_one_indexed: 1,
          end_line_one_indexed_inclusive: 3,
        },
        mockContext,
      );
      expect(result).toBe("line 1\nline 2\nline 3\n");
    });

    it("does not add trailing newline for partial range", async () => {
      const result = await readFileTool.execute(
        {
          path: "trailing-newline.txt",
          start_line_one_indexed: 1,
          end_line_one_indexed_inclusive: 2,
        },
        mockContext,
      );
      expect(result).toBe("line 1\nline 2");
    });

    it("full file read matches line-range full read", async () => {
      const fullRead = await readFileTool.execute(
        { path: "trailing-newline.txt" },
        mockContext,
      );
      const rangeRead = await readFileTool.execute(
        {
          path: "trailing-newline.txt",
          start_line_one_indexed: 1,
          end_line_one_indexed_inclusive: 3,
        },
        mockContext,
      );
      expect(rangeRead).toBe(fullRead);
    });
  });

  describe("getConsentPreview", () => {
    it("shows path only when no line range", () => {
      const preview = readFileTool.getConsentPreview?.({
        path: "src/App.tsx",
      });
      expect(preview).toBe("Read src/App.tsx");
    });

    it("shows start and end when both provided", () => {
      const preview = readFileTool.getConsentPreview?.({
        path: "src/App.tsx",
        start_line_one_indexed: 10,
        end_line_one_indexed_inclusive: 50,
      });
      expect(preview).toBe("Read src/App.tsx (lines 10-50)");
    });

    it("shows start only", () => {
      const preview = readFileTool.getConsentPreview?.({
        path: "src/App.tsx",
        start_line_one_indexed: 10,
      });
      expect(preview).toBe("Read src/App.tsx (from line 10)");
    });

    it("shows end only", () => {
      const preview = readFileTool.getConsentPreview?.({
        path: "src/App.tsx",
        end_line_one_indexed_inclusive: 50,
      });
      expect(preview).toBe("Read src/App.tsx (to line 50)");
    });
  });

  describe("buildXml", () => {
    it("returns undefined when path is missing", () => {
      const result = readFileTool.buildXml?.({}, false);
      expect(result).toBeUndefined();
    });

    it("builds XML with path only", () => {
      const result = readFileTool.buildXml?.({ path: "src/App.tsx" }, false);
      expect(result).toBe('<dyad-read path="src/App.tsx"></dyad-read>');
    });

    it("includes start_line attribute when provided", () => {
      const result = readFileTool.buildXml?.(
        { path: "src/App.tsx", start_line_one_indexed: 10 },
        false,
      );
      expect(result).toBe(
        '<dyad-read path="src/App.tsx" start_line="10"></dyad-read>',
      );
    });

    it("includes end_line attribute when provided", () => {
      const result = readFileTool.buildXml?.(
        { path: "src/App.tsx", end_line_one_indexed_inclusive: 50 },
        false,
      );
      expect(result).toBe(
        '<dyad-read path="src/App.tsx" end_line="50"></dyad-read>',
      );
    });

    it("includes both line range attributes", () => {
      const result = readFileTool.buildXml?.(
        {
          path: "src/App.tsx",
          start_line_one_indexed: 10,
          end_line_one_indexed_inclusive: 50,
        },
        false,
      );
      expect(result).toBe(
        '<dyad-read path="src/App.tsx" start_line="10" end_line="50"></dyad-read>',
      );
    });

    it("escapes special characters in path", () => {
      const result = readFileTool.buildXml?.(
        { path: 'file "with" <special>.ts' },
        false,
      );
      expect(result).toContain("&quot;");
      expect(result).toContain("&lt;");
      expect(result).toContain("&gt;");
    });

    it("includes app_name attribute when provided", () => {
      const result = readFileTool.buildXml?.(
        { path: "src/App.tsx", app_name: "other-app" },
        false,
      );
      expect(result).toBe(
        '<dyad-read path="src/App.tsx" app_name="other-app"></dyad-read>',
      );
    });
  });

  describe("execute - app_name (referenced apps)", () => {
    let otherAppDir: string;

    beforeEach(async () => {
      otherAppDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "read-file-other-app-"),
      );
      await fs.promises.writeFile(
        path.join(otherAppDir, "other.txt"),
        "hello from the other app",
      );
    });

    afterEach(async () => {
      await fs.promises.rm(otherAppDir, { recursive: true, force: true });
    });

    it("reads from referenced app when app_name matches", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      const result = await readFileTool.execute(
        { path: "other.txt", app_name: "other-app" },
        mockContext,
      );
      expect(result).toBe("hello from the other app");
    });

    it("reads from current app when app_name is omitted even if referencedApps is populated", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      const result = await readFileTool.execute(
        { path: "test.txt" },
        mockContext,
      );
      expect(result).toBe(testFileContent);
    });

    it("throws a clear error when app_name is not in the allow-list", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      await expect(
        readFileTool.execute(
          { path: "other.txt", app_name: "does-not-exist" },
          mockContext,
        ),
      ).rejects.toThrow(/Unknown app_name 'does-not-exist'/);
    });

    it("error lists available referenced apps", async () => {
      mockContext.referencedApps.set("app-a", otherAppDir);
      mockContext.referencedApps.set("app-b", otherAppDir);
      await expect(
        readFileTool.execute(
          { path: "other.txt", app_name: "nope" },
          mockContext,
        ),
      ).rejects.toThrow(/app-a, app-b/);
    });

    it("error indicates none available when referencedApps is empty", async () => {
      await expect(
        readFileTool.execute(
          { path: "other.txt", app_name: "whatever" },
          mockContext,
        ),
      ).rejects.toThrow(/\(none available\)/);
    });

    it("file-not-found error includes app_name when reading from a referenced app", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      await expect(
        readFileTool.execute(
          { path: "missing.txt", app_name: "other-app" },
          mockContext,
        ),
      ).rejects.toThrow("File does not exist: missing.txt (in app: other-app)");
    });

    it("blocks .dyad/ paths when targeting a referenced app", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      await expect(
        readFileTool.execute(
          { path: ".dyad/chats/secret.md", app_name: "other-app" },
          mockContext,
        ),
      ).rejects.toThrow(/Cannot read \.dyad\/ paths from referenced apps/);
    });

    it("blocks .dyad/ paths reached via traversal aliases (e.g. src/../.dyad/...)", async () => {
      mockContext.referencedApps.set("other-app", otherAppDir);
      const dyadDir = path.join(otherAppDir, ".dyad");
      await fs.promises.mkdir(dyadDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(dyadDir, "secret.md"),
        "should not be exposed",
      );
      await fs.promises.mkdir(path.join(otherAppDir, "src"), {
        recursive: true,
      });

      await expect(
        readFileTool.execute(
          { path: "src/../.dyad/secret.md", app_name: "other-app" },
          mockContext,
        ),
      ).rejects.toThrow(/Cannot read \.dyad\/ paths from referenced apps/);
    });

    it("allows .dyad/ paths on the current app (no app_name)", async () => {
      const dyadDir = path.join(testDir, ".dyad");
      await fs.promises.mkdir(dyadDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(dyadDir, "notes.md"),
        "local dyad metadata",
      );
      const result = await readFileTool.execute(
        { path: ".dyad/notes.md" },
        mockContext,
      );
      expect(result).toBe("local dyad metadata");
    });
  });

  describe("getConsentPreview with app_name", () => {
    it("prefixes the location with the app_name", () => {
      const preview = readFileTool.getConsentPreview?.({
        path: "src/App.tsx",
        app_name: "other-app",
      });
      expect(preview).toBe("Read other-app:src/App.tsx");
    });

    it("prefixes the location when line range is provided", () => {
      const preview = readFileTool.getConsentPreview?.({
        path: "src/App.tsx",
        app_name: "other-app",
        start_line_one_indexed: 10,
        end_line_one_indexed_inclusive: 50,
      });
      expect(preview).toBe("Read other-app:src/App.tsx (lines 10-50)");
    });
  });
});
