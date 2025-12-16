import { describe, it, expect } from "vitest";
import {
  isServerFunction,
  isSharedServerModule,
  extractFunctionNameFromPath,
} from "@/supabase_admin/supabase_utils";
import {
  toPosixPath,
  stripSupabaseFunctionsPrefix,
  buildSignature,
  type FileStatEntry,
} from "@/supabase_admin/supabase_management_client";

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
