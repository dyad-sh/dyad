import { describe, it, expect } from "vitest";
import { safeJoin } from "../ipc/utils/path_utils";

describe("Error Handling", () => {
  describe("Path Traversal Prevention", () => {
    it("should prevent path traversal with ..", () => {
      expect(() => safeJoin("/base", "../etc/passwd")).toThrow(
+        /Unsafe path/
      );
    });

    it("should prevent absolute paths", () => {
      expect(() => safeJoin("/base", "/etc/passwd")).toThrow(
        "Invalid path"
      );
    });

    it("should prevent home directory shortcuts", () => {
      expect(() => safeJoin("/base", "~/secrets")).toThrow(
        "Invalid path"
      );
    });

    it("should allow safe relative paths", () => {
      expect(() => safeJoin("/base", "folder/file.txt")).not.toThrow();
      expect(() => safeJoin("/base", "sub/dir/file.js")).not.toThrow();
    });

    it("should prevent Windows-style paths", () => {
      expect(() => safeJoin("/base", "C:\\Windows\\System32")).toThrow(
        "Invalid path"
      );
    });

    it("should prevent UNC paths", () => {
      expect(() => safeJoin("/base", "\\\\server\\share")).toThrow(
        "Invalid path"
      );
    });

    it("should handle edge cases", () => {
      expect(() => safeJoin("/base", "")).toThrow();
      expect(() => safeJoin("/base", ".")).not.toThrow();
      expect(() => safeJoin("/base", "./file.txt")).not.toThrow();
    });

    it("should validate final path is within base", () => {
      // Even if individual components seem safe, final path must be within base
      const base = "/home/user/app";
      const safe = safeJoin(base, "src/index.ts");
      expect(safe).toContain(base);
    });
  });

  describe("Input Validation", () => {
    it("should reject null inputs", () => {
      expect(() => safeJoin(null as any, "file")).toThrow();
      expect(() => safeJoin("/base", null as any)).toThrow();
    });

    it("should reject undefined inputs", () => {
      expect(() => safeJoin(undefined as any, "file")).toThrow();
      expect(() => safeJoin("/base", undefined as any)).toThrow();
    });

    it("should handle empty strings", () => {
      expect(() => safeJoin("", "file")).toThrow();
      expect(() => safeJoin("/base", "")).toThrow();
    });
  });
});
