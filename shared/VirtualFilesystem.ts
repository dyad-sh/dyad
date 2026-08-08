import * as fs from "node:fs";
import * as path from "node:path";

import {
  SyncFileSystemDelegate,
  SyncVirtualFileSystem,
  VirtualChanges,
  VirtualFile,
} from "./tsc_types";
import { normalizePath } from "./normalizePath";

export interface AsyncFileSystemDelegate {
  fileExists?: (fileName: string) => Promise<boolean>;
  readFile?: (fileName: string) => Promise<string | undefined>;
}

/**
 * Base class containing shared virtual filesystem functionality
 */
export abstract class BaseVirtualFileSystem {
  protected virtualFiles = new Map<string, string>();
  protected deletedFiles = new Set<string>();
  protected baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
  }

  /**
   * Normalize path for consistent cross-platform behavior
   */
  private normalizePathForKey(filePath: string): string {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.baseDir, filePath);

    // Normalize separators and handle case-insensitive Windows paths
    const normalized = normalizePath(path.normalize(absolutePath));

    // Intentionally do NOT lowercase for Windows which is case-insensitive
    // because this avoids issues with path comparison.
    //
    // This is a trade-off and introduces a small edge case where
    // e.g. foo.txt and Foo.txt are treated as different files by the VFS
    // even though Windows treats them as the same file.
    //
    // This should be a pretty rare occurence and it's not worth the extra
    // complexity to handle it.
    return normalized;
  }

  /**
   * Convert normalized path back to platform-appropriate format
   */
  private denormalizePath(normalizedPath: string): string {
    return process.platform === "win32"
      ? normalizedPath.replace(/\//g, "\\")
      : normalizedPath;
  }

  /**
   * Apply changes from a response containing dyad tags
   */
  public applyResponseChanges({
    deletePaths,
    renameTags,
    writeTags,
  }: VirtualChanges): void {
    // Process deletions
    for (const deletePath of deletePaths) {
      this.deleteFile(deletePath);
    }

    // Process renames (delete old, create new)
    for (const rename of renameTags) {
      this.renameFile(rename.from, rename.to);
    }

    // Process writes
    for (const writeTag of writeTags) {
      this.writeFile(writeTag.path, writeTag.content);
    }
  }

  /**
   * Write a file to the virtual filesystem
   */
  protected writeFile(relativePath: string, content: string): void {
    const absolutePath = path.resolve(this.baseDir, relativePath);
    const normalizedKey = this.normalizePathForKey(absolutePath);

    this.virtualFiles.set(normalizedKey, content);
    // Remove from deleted files if it was previously deleted
    this.deletedFiles.delete(normalizedKey);
  }

  /**
   * Delete a file from the virtual filesystem
   */
  protected deleteFile(relativePath: string): void {
    const absolutePath = path.resolve(this.baseDir, relativePath);
    const normalizedKey = this.normalizePathForKey(absolutePath);

    this.deletedFiles.add(normalizedKey);
    // Remove from virtual files if it exists there
    this.virtualFiles.delete(normalizedKey);
  }

  /**
   * Rename a file in the virtual filesystem
   */
  protected renameFile(fromPath: string, toPath: string): void {
    const fromAbsolute = path.resolve(this.baseDir, fromPath);
    const toAbsolute = path.resolve(this.baseDir, toPath);
    const fromNormalized = this.normalizePathForKey(fromAbsolute);
    const toNormalized = this.normalizePathForKey(toAbsolute);

    // Mark old file as deleted
    this.deletedFiles.add(fromNormalized);

    // If the source file exists in virtual files, move its content
    if (this.virtualFiles.has(fromNormalized)) {
      const content = this.virtualFiles.get(fromNormalized)!;
      this.virtualFiles.delete(fromNormalized);
      this.virtualFiles.set(toNormalized, content);
    } else {
      // Try to read from actual filesystem
      try {
        const content = fs.readFileSync(fromAbsolute, "utf8");
        this.virtualFiles.set(toNormalized, content);
      } catch (error) {
        // If we can't read the source file, we'll let the consumer handle it
        console.warn(
          `Could not read source file for rename: ${fromPath}`,
          error,
        );
      }
    }

    // Remove destination from deleted files if it was previously deleted
    this.deletedFiles.delete(toNormalized);
  }

  /**
   * Get all virtual files (files that have been written or modified)
   */
  public getVirtualFiles(): VirtualFile[] {
    return Array.from(this.virtualFiles.entries()).map(
      ([normalizedKey, content]) => {
        // Convert normalized key back to relative path
        const denormalizedPath = this.denormalizePath(normalizedKey);

        return {
          path: path.relative(this.baseDir, denormalizedPath),
          content,
        };
      },
    );
  }

  /**
   * Get all deleted file paths (relative to base directory)
   */
  public getDeletedFiles(): string[] {
    return Array.from(this.deletedFiles).map((normalizedKey) => {
      // Convert normalized key back to relative path
      const denormalizedPath = this.denormalizePath(normalizedKey);
      return path.relative(this.baseDir, denormalizedPath);
    });
  }

  /**
   * Check if a file is deleted in the virtual filesystem
   */
  protected isDeleted(filePath: string): boolean {
    const normalizedKey = this.normalizePathForKey(filePath);
    return this.deletedFiles.has(normalizedKey);
  }

  /**
   * Check if a file exists in virtual files
   */
  protected hasVirtualFile(filePath: string): boolean {
    const normalizedKey = this.normalizePathForKey(filePath);
    return this.virtualFiles.has(normalizedKey);
  }

  /**
   * Get virtual file content
   */
  protected getVirtualFileContent(filePath: string): string | undefined {
    const normalizedKey = this.normalizePathForKey(filePath);
    return this.virtualFiles.get(normalizedKey);
  }
}

/**
 * Synchronous virtual filesystem
 */
export class SyncVirtualFileSystemImpl
  extends BaseVirtualFileSystem
  implements SyncVirtualFileSystem
{
  private delegate: SyncFileSystemDelegate;

  constructor(baseDir: string, delegate?: SyncFileSystemDelegate) {
    super(baseDir);
    this.delegate = delegate || {};
  }

  /**
   * Check if a file exists in the virtual filesystem
   */
  public fileExists(filePath: string): boolean {
    // Check if file is deleted
    if (this.isDeleted(filePath)) {
      return false;
    }

    // Check if file exists in virtual files
    if (this.hasVirtualFile(filePath)) {
      return true;
    }

    // Delegate to custom fileExists if provided
    if (this.delegate.fileExists) {
      return this.delegate.fileExists(filePath);
    }

    // Fall back to actual filesystem
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.baseDir, filePath);
    return fs.existsSync(absolutePath);
  }

  /**
   * Read a file from the virtual filesystem
   */
  public readFile(filePath: string): string | undefined {
    // Check if file is deleted
    if (this.isDeleted(filePath)) {
      return undefined;
    }

    // Check virtual files first
    const virtualContent = this.getVirtualFileContent(filePath);
    if (virtualContent !== undefined) {
      return virtualContent;
    }

    // Delegate to custom readFile if provided
    if (this.delegate.readFile) {
      return this.delegate.readFile(filePath);
    }

    // Fall back to actual filesystem
    try {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(this.baseDir, filePath);
      return fs.readFileSync(absolutePath, "utf8");
    } catch {
      return undefined;
    }
  }

  /**
   * Create a custom file system interface for other tools
   */
  public createFileSystemInterface() {
    return {
      fileExists: (fileName: string) => this.fileExists(fileName),
      readFile: (fileName: string) => this.readFile(fileName),
      writeFile: (fileName: string, content: string) =>
        this.writeFile(fileName, content),
      deleteFile: (fileName: string) => this.deleteFile(fileName),
    };
  }
}

/**
 * Asynchronous virtual filesystem
 */
export class AsyncVirtualFileSystem extends BaseVirtualFileSystem {
  private delegate: AsyncFileSystemDelegate;

  constructor(baseDir: string, delegate?: AsyncFileSystemDelegate) {
    super(baseDir);
    this.delegate = delegate || {};
  }

  /**
   * Check if a file exists in the virtual filesystem
   */
  public async fileExists(filePath: string): Promise<boolean> {
    // Check if file is deleted
    if (this.isDeleted(filePath)) {
      return false;
    }

    // Check if file exists in virtual files
    if (this.hasVirtualFile(filePath)) {
      return true;
    }

    // Delegate to custom fileExists if provided
    if (this.delegate.fileExists) {
      return this.delegate.fileExists(filePath);
    }

    // Fall back to actual filesystem
    try {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(this.baseDir, filePath);
      await fs.promises.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read a file from the virtual filesystem
   */
  public async readFile(filePath: string): Promise<string | undefined> {
    // Check if file is deleted
    if (this.isDeleted(filePath)) {
      return undefined;
    }

    // Check virtual files first
    const virtualContent = this.getVirtualFileContent(filePath);
    if (virtualContent !== undefined) {
      return virtualContent;
    }

    // Delegate to custom readFile if provided
    if (this.delegate.readFile) {
      return this.delegate.readFile(filePath);
    }

    // Fall back to actual filesystem
    try {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(this.baseDir, filePath);
      return await fs.promises.readFile(absolutePath, "utf8");
    } catch {
      return undefined;
    }
  }
}
