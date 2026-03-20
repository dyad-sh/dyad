import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  isWslPath,
  copyFileHandlingWsl,
  copyFileSyncHandlingWsl,
  pathExistsHandlingWsl,
} from "./wsl_path_utils";

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
      const largeContent = Buffer.alloc(10 * 1024 * 1024, "x"); // 10MB
      fs.writeFileSync(largeFile, largeContent);

      const largeDest = path.join(tempDir, "large-dest.bin");
      await copyFileHandlingWsl(largeFile, largeDest);

      expect(fs.existsSync(largeDest)).toBe(true);
      const destContent = fs.readFileSync(largeDest);
      expect(destContent.length).toBe(largeContent.length);
    });
  });

  describe("copyFileSyncHandlingWsl", () => {
    it("should copy regular files using fs.copyFileSync", () => {
      copyFileSyncHandlingWsl(sourceFile, destFile);

      expect(fs.existsSync(destFile)).toBe(true);
      const content = fs.readFileSync(destFile, "utf-8");
      expect(content).toBe("test content");
    });

    it("should throw error if source file does not exist", () => {
      const nonExistentFile = path.join(tempDir, "nonexistent.txt");
      expect(() =>
        copyFileSyncHandlingWsl(nonExistentFile, destFile),
      ).toThrow();
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
});
