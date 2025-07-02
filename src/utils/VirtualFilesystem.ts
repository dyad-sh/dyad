import * as fs from "node:fs";
import * as path from "node:path";
import {
  getDyadWriteTags,
  getDyadRenameTags,
  getDyadDeleteTags,
} from "../ipc/processors/response_processor";

import log from "electron-log";

const logger = log.scope("VirtualFileSystem");

export interface VirtualFile {
  path: string;
  content: string;
}

export interface VirtualRename {
  from: string;
  to: string;
}

export interface SyncFileSystemDelegate {
  fileExists?: (fileName: string) => boolean;
  readFile?: (fileName: string) => string | undefined;
}

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
    this.baseDir = baseDir;
  }

  /**
   * Apply changes from a response containing dyad tags
   */
  public applyResponseChanges(fullResponse: string): void {
    const writeTags = getDyadWriteTags(fullResponse);
    const renameTags = getDyadRenameTags(fullResponse);
    const deletePaths = getDyadDeleteTags(fullResponse);

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
  public writeFile(relativePath: string, content: string): void {
    const absolutePath = path.resolve(this.baseDir, relativePath);
    this.virtualFiles.set(absolutePath, content);
    // Remove from deleted files if it was previously deleted
    this.deletedFiles.delete(absolutePath);
  }

  /**
   * Delete a file from the virtual filesystem
   */
  public deleteFile(relativePath: string): void {
    const absolutePath = path.resolve(this.baseDir, relativePath);
    this.deletedFiles.add(absolutePath);
    // Remove from virtual files if it exists there
    this.virtualFiles.delete(absolutePath);
  }

  /**
   * Rename a file in the virtual filesystem
   */
  public renameFile(fromPath: string, toPath: string): void {
    const fromAbsolute = path.resolve(this.baseDir, fromPath);
    const toAbsolute = path.resolve(this.baseDir, toPath);

    // Mark old file as deleted
    this.deletedFiles.add(fromAbsolute);

    // If the source file exists in virtual files, move its content
    if (this.virtualFiles.has(fromAbsolute)) {
      const content = this.virtualFiles.get(fromAbsolute)!;
      this.virtualFiles.delete(fromAbsolute);
      this.virtualFiles.set(toAbsolute, content);
    } else {
      // Try to read from actual filesystem
      try {
        const content = fs.readFileSync(fromAbsolute, "utf8");
        this.virtualFiles.set(toAbsolute, content);
      } catch (error) {
        // If we can't read the source file, we'll let the consumer handle it
        logger.warn(
          `Could not read source file for rename: ${fromPath}`,
          error,
        );
      }
    }

    // Remove destination from deleted files if it was previously deleted
    this.deletedFiles.delete(toAbsolute);
  }

  /**
   * Get all virtual files (files that have been written or modified)
   */
  public getVirtualFiles(): VirtualFile[] {
    return Array.from(this.virtualFiles.entries()).map(
      ([absolutePath, content]) => ({
        path: path.relative(this.baseDir, absolutePath),
        content,
      }),
    );
  }

  /**
   * Get all deleted file paths (relative to base directory)
   */
  public getDeletedFiles(): string[] {
    return Array.from(this.deletedFiles).map((absolutePath) =>
      path.relative(this.baseDir, absolutePath),
    );
  }

  /**
   * Get all files that should be considered (existing + virtual - deleted)
   */
  public getAllFiles(): string[] {
    const allFiles = new Set<string>();

    // Add virtual files
    for (const [absolutePath] of this.virtualFiles.entries()) {
      allFiles.add(path.relative(this.baseDir, absolutePath));
    }

    // Add existing files (this is a simplified version - in practice you might want to scan the directory)
    // This method is mainly for getting the current state, consumers can combine with directory scanning

    return Array.from(allFiles);
  }

  /**
   * Check if a file has been modified in the virtual filesystem
   */
  public isFileModified(filePath: string): boolean {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.baseDir, filePath);

    return (
      this.virtualFiles.has(absolutePath) || this.deletedFiles.has(absolutePath)
    );
  }

  /**
   * Clear all virtual changes
   */
  public clear(): void {
    this.virtualFiles.clear();
    this.deletedFiles.clear();
  }

  /**
   * Get the base directory
   */
  public getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * Check if a file is deleted in the virtual filesystem
   */
  protected isDeleted(filePath: string): boolean {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.baseDir, filePath);
    return this.deletedFiles.has(absolutePath);
  }

  /**
   * Check if a file exists in virtual files
   */
  protected hasVirtualFile(filePath: string): boolean {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.baseDir, filePath);
    return this.virtualFiles.has(absolutePath);
  }

  /**
   * Get virtual file content
   */
  protected getVirtualFileContent(filePath: string): string | undefined {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.baseDir, filePath);
    return this.virtualFiles.get(absolutePath);
  }
}

/**
 * Synchronous virtual filesystem
 */
export class SyncVirtualFileSystem extends BaseVirtualFileSystem {
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
