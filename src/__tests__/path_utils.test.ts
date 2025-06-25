import { safeJoin } from "@/ipc/utils/path_utils";
import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";

describe("safeJoin", () => {
  const testBaseDir = "/app/workspace";
  const testBaseDirWindows = "C:\\app\\workspace";

  describe("safe paths", () => {
    it("should join simple relative paths", () => {
      const result = safeJoin(testBaseDir, "src", "components", "Button.tsx");
      expect(result).toBe(
        path.join(testBaseDir, "src", "components", "Button.tsx"),
      );
    });

    it("should handle single file names", () => {
      const result = safeJoin(testBaseDir, "package.json");
      expect(result).toBe(path.join(testBaseDir, "package.json"));
    });

    it("should handle nested directories", () => {
      const result = safeJoin(testBaseDir, "src/pages/home/index.tsx");
      expect(result).toBe(path.join(testBaseDir, "src/pages/home/index.tsx"));
    });

    it("should handle paths with dots in filename", () => {
      const result = safeJoin(testBaseDir, "config.test.js");
      expect(result).toBe(path.join(testBaseDir, "config.test.js"));
    });

    it("should handle empty path segments", () => {
      const result = safeJoin(testBaseDir, "", "src", "", "file.ts");
      expect(result).toBe(path.join(testBaseDir, "", "src", "", "file.ts"));
    });

    it("should handle multiple path segments", () => {
      const result = safeJoin(testBaseDir, "a", "b", "c", "d", "file.txt");
      expect(result).toBe(
        path.join(testBaseDir, "a", "b", "c", "d", "file.txt"),
      );
    });

    it("should work with actual temp directory", () => {
      const tempDir = os.tmpdir();
      const result = safeJoin(tempDir, "test", "file.txt");
      expect(result).toBe(path.join(tempDir, "test", "file.txt"));
    });

    it("should handle Windows-style relative paths with backslashes", () => {
      const result = safeJoin(testBaseDir, "src\\components\\Button.tsx");
      expect(result).toBe(
        path.join(testBaseDir, "src\\components\\Button.tsx"),
      );
    });

    it("should handle mixed forward/backslashes in relative paths", () => {
      const result = safeJoin(testBaseDir, "src/components\\ui/button.tsx");
      expect(result).toBe(
        path.join(testBaseDir, "src/components\\ui/button.tsx"),
      );
    });

    it("should handle Windows-style nested directories", () => {
      const result = safeJoin(
        testBaseDir,
        "pages\\home\\components\\index.tsx",
      );
      expect(result).toBe(
        path.join(testBaseDir, "pages\\home\\components\\index.tsx"),
      );
    });

    it("should handle relative paths starting with dot and backslash", () => {
      const result = safeJoin(testBaseDir, ".\\src\\file.txt");
      expect(result).toBe(path.join(testBaseDir, ".\\src\\file.txt"));
    });
  });

  describe("unsafe paths - directory traversal", () => {
    it("should throw on simple parent directory traversal", () => {
      expect(() => safeJoin(testBaseDir, "../outside.txt")).toThrow(
        /would escape the base directory/,
      );
    });

    it("should throw on multiple parent directory traversals", () => {
      expect(() => safeJoin(testBaseDir, "../../etc/passwd")).toThrow(
        /would escape the base directory/,
      );
    });

    it("should throw on complex traversal paths", () => {
      expect(() => safeJoin(testBaseDir, "src/../../../etc/passwd")).toThrow(
        /would escape the base directory/,
      );
    });

    it("should throw on mixed traversal with valid components", () => {
      expect(() =>
        safeJoin(
          testBaseDir,
          "src",
          "components",
          "..",
          "..",
          "..",
          "outside.txt",
        ),
      ).toThrow(/would escape the base directory/);
    });

    it("should throw on absolute Unix paths", () => {
      expect(() => safeJoin(testBaseDir, "/etc/passwd")).toThrow(
        /would escape the base directory/,
      );
    });

    it("should throw on absolute Windows paths", () => {
      expect(() =>
        safeJoin(testBaseDir, "C:\\Windows\\System32\\config"),
      ).toThrow(/would escape the base directory/);
    });

    it("should throw on Windows UNC paths", () => {
      expect(() =>
        safeJoin(testBaseDir, "\\\\server\\share\\file.txt"),
      ).toThrow(/would escape the base directory/);
    });

    it("should throw on home directory shortcuts", () => {
      expect(() => safeJoin(testBaseDir, "~/secrets.txt")).toThrow(
        /would escape the base directory/,
      );
    });
  });

  describe("edge cases", () => {
    it("should handle Windows-style base paths", () => {
      const result = safeJoin(testBaseDirWindows, "src", "file.txt");
      expect(result).toBe(path.join(testBaseDirWindows, "src", "file.txt"));
    });

    it("should throw on Windows traversal from Unix base", () => {
      expect(() => safeJoin(testBaseDir, "..\\..\\file.txt")).toThrow(
        /would escape the base directory/,
      );
    });

    it("should handle current directory references safely", () => {
      const result = safeJoin(testBaseDir, "./src/file.txt");
      expect(result).toBe(path.join(testBaseDir, "./src/file.txt"));
    });

    it("should handle nested current directory references", () => {
      const result = safeJoin(testBaseDir, "src/./components/./Button.tsx");
      expect(result).toBe(
        path.join(testBaseDir, "src/./components/./Button.tsx"),
      );
    });

    it("should throw when current dir plus traversal escapes", () => {
      expect(() => safeJoin(testBaseDir, "./../../outside.txt")).toThrow(
        /would escape the base directory/,
      );
    });

    it("should handle very long paths safely", () => {
      const longPath = Array(50).fill("subdir").join("/") + "/file.txt";
      const result = safeJoin(testBaseDir, longPath);
      expect(result).toBe(path.join(testBaseDir, longPath));
    });

    it("should allow Windows-style paths that look like drive letters but aren't", () => {
      // These look like they could be problematic but are actually safe relative paths
      const result1 = safeJoin(testBaseDir, "C_drive\\file.txt");
      expect(result1).toBe(path.join(testBaseDir, "C_drive\\file.txt"));

      const result2 = safeJoin(testBaseDir, "src\\C-file.txt");
      expect(result2).toBe(path.join(testBaseDir, "src\\C-file.txt"));
    });

    it("should handle Windows paths with multiple backslashes (not UNC)", () => {
      // Single backslashes in the middle are fine - it's only \\ at the start that's UNC
      const result = safeJoin(testBaseDir, "src\\\\components\\\\Button.tsx");
      expect(result).toBe(
        path.join(testBaseDir, "src\\\\components\\\\Button.tsx"),
      );
    });

    it("should provide descriptive error messages", () => {
      expect(() => safeJoin("/base", "../outside.txt")).toThrow(
        'Unsafe path: joining "../outside.txt" with base "/base" would escape the base directory',
      );
    });

    it("should provide descriptive error for multiple segments", () => {
      expect(() => safeJoin("/base", "src", "..", "..", "outside.txt")).toThrow(
        'Unsafe path: joining "src, .., .., outside.txt" with base "/base" would escape the base directory',
      );
    });
  });

  describe("boundary conditions", () => {
    it("should allow paths at the exact boundary", () => {
      const result = safeJoin(testBaseDir, ".");
      expect(result).toBe(path.join(testBaseDir, "."));
    });

    it("should handle paths that approach but don't cross boundary", () => {
      const result = safeJoin(testBaseDir, "deep/nested/../file.txt");
      expect(result).toBe(path.join(testBaseDir, "deep/nested/../file.txt"));
    });

    it("should handle root directory as base", () => {
      const result = safeJoin("/", "tmp/file.txt");
      expect(result).toBe(path.join("/", "tmp/file.txt"));
    });

    it("should throw when trying to escape root", () => {
      expect(() => safeJoin("/tmp", "../etc/passwd")).toThrow(
        /would escape the base directory/,
      );
    });
  });
});
