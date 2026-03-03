import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isServerFunction,
  isSharedServerModule,
  extractFunctionNameFromPath,
} from "@/supabase_admin/supabase_utils";
import {
  toPosixPath,
  stripSupabaseFunctionsPrefix,
  buildSignature,
  listFilesWithStats,
  type FileStatEntry,
} from "@/supabase_admin/supabase_management_client";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("isServerFunction", () => {
  describe("returns true for valid function paths", () => {
    it("should return true for function index.ts", () => {
      expect(isServerFunction("supabase/functions/hello/index.ts")).toBe(true);
    });

    it("should return true for nested function files", () => {
      expect(isServerFunction("supabase/functions/hello/lib/utils.ts")).toBe(
        true,
      );
    });

    it("should return true for function with complex name", () => {
      expect(isServerFunction("supabase/functions/send-email/index.ts")).toBe(
        true,
      );
    });

    it("should return true for deeply nested src/utils path (customer reported structure)", () => {
      expect(
        isServerFunction(
          "supabase/functions/incoming-call-router/src/utils/text.ts",
        ),
      ).toBe(true);
    });

    it("should return true for deeply nested src/controllers path (customer reported structure)", () => {
      expect(
        isServerFunction(
          "supabase/functions/incoming-call-router/src/controllers/conference.ts",
        ),
      ).toBe(true);
    });

    it("should return true for deeply nested src/services path (customer reported structure)", () => {
      expect(
        isServerFunction(
          "supabase/functions/incoming-call-router/src/services/supabase.ts",
        ),
      ).toBe(true);
    });
  });

  describe("returns false for non-function paths", () => {
    it("should return false for shared modules", () => {
      expect(isServerFunction("supabase/functions/_shared/utils.ts")).toBe(
        false,
      );
    });

    it("should return false for regular source files", () => {
      expect(isServerFunction("src/components/Button.tsx")).toBe(false);
    });

    it("should return false for root supabase files", () => {
      expect(isServerFunction("supabase/config.toml")).toBe(false);
    });

    it("should return false for non-supabase paths", () => {
      expect(isServerFunction("package.json")).toBe(false);
    });
  });
});

describe("isSharedServerModule", () => {
  describe("returns true for _shared paths", () => {
    it("should return true for files in _shared", () => {
      expect(isSharedServerModule("supabase/functions/_shared/utils.ts")).toBe(
        true,
      );
    });

    it("should return true for nested _shared files", () => {
      expect(
        isSharedServerModule("supabase/functions/_shared/lib/helpers.ts"),
      ).toBe(true);
    });

    it("should return true for _shared directory itself", () => {
      expect(isSharedServerModule("supabase/functions/_shared/")).toBe(true);
    });
  });

  describe("returns false for non-_shared paths", () => {
    it("should return false for regular functions", () => {
      expect(isSharedServerModule("supabase/functions/hello/index.ts")).toBe(
        false,
      );
    });

    it("should return false for similar but different paths", () => {
      expect(isSharedServerModule("supabase/functions/shared/utils.ts")).toBe(
        false,
      );
    });

    it("should return false for _shared in wrong location", () => {
      expect(isSharedServerModule("src/_shared/utils.ts")).toBe(false);
    });
  });
});

describe("extractFunctionNameFromPath", () => {
  describe("extracts function name correctly from nested paths", () => {
    it("should extract function name from index.ts path", () => {
      expect(
        extractFunctionNameFromPath("supabase/functions/hello/index.ts"),
      ).toBe("hello");
    });

    it("should extract function name from deeply nested path", () => {
      expect(
        extractFunctionNameFromPath("supabase/functions/hello/lib/utils.ts"),
      ).toBe("hello");
    });

    it("should extract function name from very deeply nested path", () => {
      expect(
        extractFunctionNameFromPath(
          "supabase/functions/hello/src/helpers/format.ts",
        ),
      ).toBe("hello");
    });

    it("should extract function name with dashes", () => {
      expect(
        extractFunctionNameFromPath("supabase/functions/send-email/index.ts"),
      ).toBe("send-email");
    });

    it("should extract function name with underscores", () => {
      expect(
        extractFunctionNameFromPath("supabase/functions/my_function/index.ts"),
      ).toBe("my_function");
    });
  });

  describe("throws for invalid paths", () => {
    it("should throw for _shared paths", () => {
      expect(() =>
        extractFunctionNameFromPath("supabase/functions/_shared/utils.ts"),
      ).toThrow(/Function names starting with "_" are reserved/);
    });

    it("should throw for other _ prefixed directories", () => {
      expect(() =>
        extractFunctionNameFromPath("supabase/functions/_internal/utils.ts"),
      ).toThrow(/Function names starting with "_" are reserved/);
    });

    it("should throw for non-supabase paths", () => {
      expect(() =>
        extractFunctionNameFromPath("src/components/Button.tsx"),
      ).toThrow(/Invalid Supabase function path/);
    });

    it("should throw for supabase root files", () => {
      expect(() => extractFunctionNameFromPath("supabase/config.toml")).toThrow(
        /Invalid Supabase function path/,
      );
    });

    it("should throw for partial matches", () => {
      expect(() => extractFunctionNameFromPath("supabase/functions")).toThrow(
        /Invalid Supabase function path/,
      );
    });
  });

  describe("handles edge cases", () => {
    it("should handle backslashes (Windows paths)", () => {
      expect(
        extractFunctionNameFromPath(
          "supabase\\functions\\hello\\lib\\utils.ts",
        ),
      ).toBe("hello");
    });

    it("should handle mixed slashes", () => {
      expect(
        extractFunctionNameFromPath("supabase/functions\\hello/lib\\utils.ts"),
      ).toBe("hello");
    });
  });
});

describe("toPosixPath", () => {
  it("should keep forward slashes unchanged", () => {
    expect(toPosixPath("supabase/functions/hello/index.ts")).toBe(
      "supabase/functions/hello/index.ts",
    );
  });

  it("should handle empty string", () => {
    expect(toPosixPath("")).toBe("");
  });

  it("should handle single filename", () => {
    expect(toPosixPath("index.ts")).toBe("index.ts");
  });

  // Note: On Unix, path.sep is "/", so backslashes won't be converted
  // This test is for documentation - actual behavior depends on platform
  it("should handle path with no separators", () => {
    expect(toPosixPath("filename")).toBe("filename");
  });
});

describe("stripSupabaseFunctionsPrefix", () => {
  describe("strips prefix correctly", () => {
    it("should strip full prefix from index.ts", () => {
      expect(
        stripSupabaseFunctionsPrefix(
          "supabase/functions/hello/index.ts",
          "hello",
        ),
      ).toBe("index.ts");
    });

    it("should strip prefix from nested file", () => {
      expect(
        stripSupabaseFunctionsPrefix(
          "supabase/functions/hello/lib/utils.ts",
          "hello",
        ),
      ).toBe("lib/utils.ts");
    });

    it("should handle leading slash", () => {
      expect(
        stripSupabaseFunctionsPrefix(
          "/supabase/functions/hello/index.ts",
          "hello",
        ),
      ).toBe("index.ts");
    });
  });

  describe("handles edge cases", () => {
    it("should return filename when no prefix match", () => {
      const result = stripSupabaseFunctionsPrefix("just-a-file.ts", "hello");
      expect(result).toBe("just-a-file.ts");
    });

    it("should handle paths without function name", () => {
      const result = stripSupabaseFunctionsPrefix(
        "supabase/functions/other/index.ts",
        "hello",
      );
      // Should strip base prefix and return the rest
      expect(result).toBe("other/index.ts");
    });

    it("should handle empty relative path after prefix", () => {
      // When the path is exactly the function directory
      const result = stripSupabaseFunctionsPrefix(
        "supabase/functions/hello",
        "hello",
      );
      expect(result).toBe("hello");
    });
  });
});

describe("buildSignature", () => {
  it("should build signature from single entry", () => {
    const entries: FileStatEntry[] = [
      {
        absolutePath: "/app/file.ts",
        relativePath: "file.ts",
        mtimeMs: 1000,
        size: 100,
      },
    ];
    const result = buildSignature(entries);
    expect(result).toBe("file.ts:3e8:64");
  });

  it("should build signature from multiple entries sorted by relativePath", () => {
    const entries: FileStatEntry[] = [
      {
        absolutePath: "/app/b.ts",
        relativePath: "b.ts",
        mtimeMs: 2000,
        size: 200,
      },
      {
        absolutePath: "/app/a.ts",
        relativePath: "a.ts",
        mtimeMs: 1000,
        size: 100,
      },
    ];
    const result = buildSignature(entries);
    // Should be sorted by relativePath
    expect(result).toBe("a.ts:3e8:64|b.ts:7d0:c8");
  });

  it("should return empty string for empty array", () => {
    const result = buildSignature([]);
    expect(result).toBe("");
  });

  it("should produce different signatures for different mtimes", () => {
    const entries1: FileStatEntry[] = [
      {
        absolutePath: "/app/file.ts",
        relativePath: "file.ts",
        mtimeMs: 1000,
        size: 100,
      },
    ];
    const entries2: FileStatEntry[] = [
      {
        absolutePath: "/app/file.ts",
        relativePath: "file.ts",
        mtimeMs: 2000,
        size: 100,
      },
    ];
    expect(buildSignature(entries1)).not.toBe(buildSignature(entries2));
  });

  it("should produce different signatures for different sizes", () => {
    const entries1: FileStatEntry[] = [
      {
        absolutePath: "/app/file.ts",
        relativePath: "file.ts",
        mtimeMs: 1000,
        size: 100,
      },
    ];
    const entries2: FileStatEntry[] = [
      {
        absolutePath: "/app/file.ts",
        relativePath: "file.ts",
        mtimeMs: 1000,
        size: 200,
      },
    ];
    expect(buildSignature(entries1)).not.toBe(buildSignature(entries2));
  });

  it("should include path in signature for cache invalidation", () => {
    const entries1: FileStatEntry[] = [
      {
        absolutePath: "/app/a.ts",
        relativePath: "a.ts",
        mtimeMs: 1000,
        size: 100,
      },
    ];
    const entries2: FileStatEntry[] = [
      {
        absolutePath: "/app/b.ts",
        relativePath: "b.ts",
        mtimeMs: 1000,
        size: 100,
      },
    ];
    expect(buildSignature(entries1)).not.toBe(buildSignature(entries2));
  });
});

describe("listFilesWithStats", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = join(
      tmpdir(),
      `supabase-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("nested directory structure (customer reported issue)", () => {
    it("should collect files from deeply nested src/utils directory", async () => {
      // Create the customer's reported structure:
      // supabase/functions/incoming-call-router/src/utils/text.ts
      const functionDir = join(tempDir, "incoming-call-router");
      const srcDir = join(functionDir, "src");
      const utilsDir = join(srcDir, "utils");

      mkdirSync(utilsDir, { recursive: true });
      writeFileSync(join(functionDir, "index.ts"), "export default {}");
      writeFileSync(join(utilsDir, "text.ts"), 'export const text = "hello"');

      const result = await listFilesWithStats(
        functionDir,
        "incoming-call-router",
      );

      const relativePaths = result.map((e) => e.relativePath).sort();
      expect(relativePaths).toEqual([
        "incoming-call-router/index.ts",
        "incoming-call-router/src/utils/text.ts",
      ]);
    });

    it("should collect files from deeply nested src/controllers directory", async () => {
      // supabase/functions/incoming-call-router/src/controllers/conference.ts
      const functionDir = join(tempDir, "incoming-call-router");
      const controllersDir = join(functionDir, "src", "controllers");

      mkdirSync(controllersDir, { recursive: true });
      writeFileSync(join(functionDir, "index.ts"), "export default {}");
      writeFileSync(
        join(controllersDir, "conference.ts"),
        "export const conf = {}",
      );

      const result = await listFilesWithStats(
        functionDir,
        "incoming-call-router",
      );

      const relativePaths = result.map((e) => e.relativePath).sort();
      expect(relativePaths).toEqual([
        "incoming-call-router/index.ts",
        "incoming-call-router/src/controllers/conference.ts",
      ]);
    });

    it("should collect all files from complex nested structure matching customer report", async () => {
      // Full customer structure:
      // supabase/functions/incoming-call-router/index.ts
      // supabase/functions/incoming-call-router/src/utils/text.ts
      // supabase/functions/incoming-call-router/src/controllers/conference.ts
      // supabase/functions/incoming-call-router/src/controllers/initial.ts
      // supabase/functions/incoming-call-router/src/controllers/ivr.ts
      // supabase/functions/incoming-call-router/src/services/supabase.ts

      const functionDir = join(tempDir, "incoming-call-router");
      const utilsDir = join(functionDir, "src", "utils");
      const controllersDir = join(functionDir, "src", "controllers");
      const servicesDir = join(functionDir, "src", "services");

      mkdirSync(utilsDir, { recursive: true });
      mkdirSync(controllersDir, { recursive: true });
      mkdirSync(servicesDir, { recursive: true });

      writeFileSync(
        join(functionDir, "index.ts"),
        `
import { createSupabaseClient } from './src/services/supabase.ts'
import { handleInitial } from './src/controllers/initial.ts'
import { handleIvrMenu, handleIvrNext } from './src/controllers/ivr.ts'
export default {}
`,
      );
      writeFileSync(join(utilsDir, "text.ts"), 'export const text = "hello"');
      writeFileSync(
        join(controllersDir, "conference.ts"),
        "export const conf = {}",
      );
      writeFileSync(
        join(controllersDir, "initial.ts"),
        "export const handleInitial = () => {}",
      );
      writeFileSync(
        join(controllersDir, "ivr.ts"),
        "export const handleIvrMenu = () => {}; export const handleIvrNext = () => {}",
      );
      writeFileSync(
        join(servicesDir, "supabase.ts"),
        "export const createSupabaseClient = () => {}",
      );

      const result = await listFilesWithStats(
        functionDir,
        "incoming-call-router",
      );

      const relativePaths = result.map((e) => e.relativePath).sort();
      expect(relativePaths).toEqual([
        "incoming-call-router/index.ts",
        "incoming-call-router/src/controllers/conference.ts",
        "incoming-call-router/src/controllers/initial.ts",
        "incoming-call-router/src/controllers/ivr.ts",
        "incoming-call-router/src/services/supabase.ts",
        "incoming-call-router/src/utils/text.ts",
      ]);
    });

    it("should preserve correct absolute paths for nested files", async () => {
      const functionDir = join(tempDir, "my-function");
      const nestedDir = join(functionDir, "src", "deep", "nested");

      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(join(functionDir, "index.ts"), "export default {}");
      writeFileSync(join(nestedDir, "file.ts"), "export const x = 1");

      const result = await listFilesWithStats(functionDir, "my-function");

      const nestedFile = result.find((e) =>
        e.relativePath.includes("deep/nested"),
      );
      expect(nestedFile).toBeDefined();
      expect(nestedFile!.absolutePath).toBe(join(nestedDir, "file.ts"));
    });

    it("should handle multiple levels of nesting (4+ levels deep)", async () => {
      const functionDir = join(tempDir, "deep-function");
      const deepDir = join(functionDir, "a", "b", "c", "d");

      mkdirSync(deepDir, { recursive: true });
      writeFileSync(join(functionDir, "index.ts"), "export default {}");
      writeFileSync(join(deepDir, "deep.ts"), "export const deep = true");

      const result = await listFilesWithStats(functionDir, "deep-function");

      const relativePaths = result.map((e) => e.relativePath).sort();
      expect(relativePaths).toEqual([
        "deep-function/a/b/c/d/deep.ts",
        "deep-function/index.ts",
      ]);
    });
  });

  describe("basic functionality", () => {
    it("should collect files from flat directory", async () => {
      const functionDir = join(tempDir, "simple-function");
      mkdirSync(functionDir, { recursive: true });
      writeFileSync(join(functionDir, "index.ts"), "export default {}");
      writeFileSync(
        join(functionDir, "helper.ts"),
        "export const help = () => {}",
      );

      const result = await listFilesWithStats(functionDir, "simple-function");

      const relativePaths = result.map((e) => e.relativePath).sort();
      expect(relativePaths).toEqual([
        "simple-function/helper.ts",
        "simple-function/index.ts",
      ]);
    });

    it("should return file stats (mtimeMs and size)", async () => {
      const functionDir = join(tempDir, "stats-test");
      mkdirSync(functionDir, { recursive: true });
      const content = "export const x = 1";
      writeFileSync(join(functionDir, "index.ts"), content);

      const result = await listFilesWithStats(functionDir, "stats-test");

      expect(result).toHaveLength(1);
      expect(result[0].size).toBe(content.length);
      expect(result[0].mtimeMs).toBeGreaterThan(0);
    });

    it("should return empty array for empty directory", async () => {
      const emptyDir = join(tempDir, "empty");
      mkdirSync(emptyDir, { recursive: true });

      const result = await listFilesWithStats(emptyDir, "empty");

      expect(result).toEqual([]);
    });

    it("should use POSIX path separators in relative paths", async () => {
      const functionDir = join(tempDir, "posix-test");
      const nestedDir = join(functionDir, "src", "utils");
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(join(nestedDir, "file.ts"), "export const x = 1");

      const result = await listFilesWithStats(functionDir, "posix-test");

      // All relative paths should use forward slashes (POSIX style)
      for (const entry of result) {
        expect(entry.relativePath).not.toContain("\\");
        expect(entry.relativePath).toContain("/");
      }
    });
  });

  describe("file content reading integration", () => {
    it("should read file content correctly for nested files", async () => {
      // This test verifies that the absolute paths are correct and files can be read
      const functionDir = join(tempDir, "content-test");
      const nestedDir = join(functionDir, "src", "utils");
      mkdirSync(nestedDir, { recursive: true });

      const indexContent =
        'import { helper } from "./src/utils/helper.ts"\nexport default {}';
      const helperContent = 'export const helper = () => "works"';

      writeFileSync(join(functionDir, "index.ts"), indexContent);
      writeFileSync(join(nestedDir, "helper.ts"), helperContent);

      const result = await listFilesWithStats(functionDir, "content-test");

      // Verify we can read all files using the absolute paths
      for (const entry of result) {
        const content = readFileSync(entry.absolutePath, "utf-8");
        expect(content.length).toBeGreaterThan(0);

        if (entry.relativePath.endsWith("index.ts")) {
          expect(content).toBe(indexContent);
        } else if (entry.relativePath.endsWith("helper.ts")) {
          expect(content).toBe(helperContent);
        }
      }
    });

    it("should preserve directory structure in relative paths matching customer example", async () => {
      // Exact structure from customer report
      const functionDir = join(tempDir, "incoming-call-router");

      // Create the nested structure
      const dirs = [
        join(functionDir, "src", "utils"),
        join(functionDir, "src", "controllers"),
        join(functionDir, "src", "services"),
      ];
      for (const dir of dirs) {
        mkdirSync(dir, { recursive: true });
      }

      // Create files with content
      writeFileSync(
        join(functionDir, "index.ts"),
        `import { createSupabaseClient } from './src/services/supabase.ts'
import { handleInitial } from './src/controllers/initial.ts'
import { handleIvrMenu, handleIvrNext } from './src/controllers/ivr.ts'

Deno.serve(async (req) => {
  return new Response("OK");
});`,
      );
      writeFileSync(
        join(functionDir, "src", "utils", "text.ts"),
        "export const formatText = (s: string) => s.trim();",
      );
      writeFileSync(
        join(functionDir, "src", "controllers", "conference.ts"),
        "export const handleConference = () => {};",
      );
      writeFileSync(
        join(functionDir, "src", "controllers", "initial.ts"),
        "export const handleInitial = () => {};",
      );
      writeFileSync(
        join(functionDir, "src", "controllers", "ivr.ts"),
        "export const handleIvrMenu = () => {};\nexport const handleIvrNext = () => {};",
      );
      writeFileSync(
        join(functionDir, "src", "services", "supabase.ts"),
        "export const createSupabaseClient = () => ({ from: () => ({}) });",
      );

      const result = await listFilesWithStats(
        functionDir,
        "incoming-call-router",
      );

      // Verify all expected files are present
      const relativePaths = result.map((e) => e.relativePath).sort();
      expect(relativePaths).toEqual([
        "incoming-call-router/index.ts",
        "incoming-call-router/src/controllers/conference.ts",
        "incoming-call-router/src/controllers/initial.ts",
        "incoming-call-router/src/controllers/ivr.ts",
        "incoming-call-router/src/services/supabase.ts",
        "incoming-call-router/src/utils/text.ts",
      ]);

      // Verify the entrypoint path matches what would be set in metadata
      const entrypointPath = "incoming-call-router/index.ts";
      expect(relativePaths).toContain(entrypointPath);

      // Verify that relative imports from index.ts would resolve correctly
      // Import "./src/services/supabase.ts" from "incoming-call-router/index.ts"
      // Should resolve to "incoming-call-router/src/services/supabase.ts"
      const expectedImportTarget =
        "incoming-call-router/src/services/supabase.ts";
      expect(relativePaths).toContain(expectedImportTarget);
    });
  });
});
