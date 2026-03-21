import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  isWslPath,
  copyFileHandlingWsl,
  pathExistsHandlingWsl,
  pathExistsHandlingWslAsync,
} from "./wsl_path_utils";

vi.mock("./wsl_path_utils", async (importActual) => {
  const actual = await importActual<typeof import("./wsl_path_utils")>();
  return {
    ...actual,
    isWslPath: vi.fn(actual.isWslPath),
  };
});

describe("wsl_path_utils", () => {
  let tempDir: string;
  let sourceFile: string;
  let destFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wsl-path-test-"));
    sourceFile = path.join(tempDir, "source.txt");
    destFile = path.join(tempDir, "dest.txt");
    fs.writeFileSync(sourceFile, "test content");
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("isWslPath", () => {
    it("should detect wsl.localhost paths", () => {
      expect(isWslPath("\\\\wsl.localhost\\Ubuntu\\home\\user\\project")).toBe(
        true,
      );
      expect(isWslPath("\\\\wsl.localhost\\Debian\\tmp\\test")).toBe(true);
    });

    it("should detect wsl$ paths", () => {
      expect(isWslPath("\\\\wsl$\\Ubuntu\\home\\user\\project")).toBe(true);
      expect(isWslPath("\\\\wsl$\\Debian\\tmp\\test")).toBe(true);
    });

    it("should handle mixed forward and backslashes", () => {
      expect(isWslPath("//wsl.localhost/Ubuntu/home/user/project")).toBe(true);
      expect(isWslPath("\\\\wsl.localhost/Ubuntu\\home/user\\project")).toBe(
        true,
      );
    });

    it("should be case-insensitive", () => {
      expect(isWslPath("\\\\WSL.LOCALHOST\\Ubuntu\\home\\user\\project")).toBe(
        true,
      );
      expect(isWslPath("\\\\WSL$\\Ubuntu\\home\\user\\project")).toBe(true);
    });

    it("should return false for regular Windows paths", () => {
      expect(isWslPath("C:\\Users\\test\\project")).toBe(false);
      expect(isWslPath("\\\\shared-server\\share\\project")).toBe(false);
      expect(isWslPath("/home/user/project")).toBe(false);
    });

    it("should handle null/undefined gracefully", () => {
      expect(isWslPath("")).toBe(false);
      expect(isWslPath(null as any)).toBe(false);
      expect(isWslPath(undefined as any)).toBe(false);
    });
  });

  describe("copyFileHandlingWsl", () => {
    it("should copy regular files using fs.copyFile", async () => {
      await copyFileHandlingWsl(sourceFile, destFile);

      expect(fs.existsSync(destFile)).toBe(true);
      const content = fs.readFileSync(destFile, "utf-8");
      expect(content).toBe("test content");
    });

    it("should throw error if source file does not exist", async () => {
      const nonExistentFile = path.join(tempDir, "nonexistent.txt");
      await expect(
        copyFileHandlingWsl(nonExistentFile, destFile),
      ).rejects.toThrow();
    });

    it("should handle large files", async () => {
      const largeFile = path.join(tempDir, "large.bin");
      const largeContent = Buffer.alloc(10 * 1024 * 1024, "x");
      fs.writeFileSync(largeFile, largeContent);

      const largeDest = path.join(tempDir, "large-dest.bin");
      await copyFileHandlingWsl(largeFile, largeDest);

      expect(fs.existsSync(largeDest)).toBe(true);
      const destContent = fs.readFileSync(largeDest);
      expect(destContent.length).toBe(largeContent.length);
    });

    it("should preserve file permissions after copy", async () => {
      const permFile = path.join(tempDir, "perm-test.txt");
      fs.writeFileSync(permFile, "test");
      fs.chmodSync(permFile, 0o755);

      const permDest = path.join(tempDir, "perm-dest.txt");
      await copyFileHandlingWsl(permFile, permDest);

      const srcStats = fs.statSync(permFile);
      const destStats = fs.statSync(permDest);
      expect(destStats.mode).toBe(srcStats.mode);
      expect(fs.readFileSync(permDest, "utf-8")).toBe("test");
    });

    it("should correctly identify WSL paths for routing to streaming copy", () => {
      expect(isWslPath("\\\\wsl.localhost\\Ubuntu\\home\\user\\file.txt")).toBe(
        true,
      );
      expect(isWslPath("\\\\wsl$\\Ubuntu\\home\\user\\file.txt")).toBe(true);
      expect(isWslPath("C:\\Users\\test\\file.txt")).toBe(false);
    });
  });

  describe("pathExistsHandlingWsl", () => {
    it("should return true for existing files", () => {
      expect(pathExistsHandlingWsl(sourceFile)).toBe(true);
    });

    it("should return false for non-existing files", () => {
      const nonExistentFile = path.join(tempDir, "nonexistent.txt");
      expect(pathExistsHandlingWsl(nonExistentFile)).toBe(false);
    });

    it("should return true for existing directories", () => {
      expect(pathExistsHandlingWsl(tempDir)).toBe(true);
    });
  });

  describe("pathExistsHandlingWslAsync", () => {
    it("should return true for existing files", async () => {
      expect(await pathExistsHandlingWslAsync(sourceFile)).toBe(true);
    });

    it("should return false for non-existing files", async () => {
      const nonExistentFile = path.join(tempDir, "nonexistent.txt");
      expect(await pathExistsHandlingWslAsync(nonExistentFile)).toBe(false);
    });

    it("should return true for existing directories", async () => {
      expect(await pathExistsHandlingWslAsync(tempDir)).toBe(true);
    });

    it("should handle file stat errors gracefully", async () => {
      const result = await pathExistsHandlingWslAsync(
        path.join(tempDir, "definitely-does-not-exist-12345.txt"),
      );
      expect(result).toBe(false);
    });
  });
});
