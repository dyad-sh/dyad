import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import fsExtra from "fs-extra";
import { generateCuteAppName } from "../../lib/utils";
import { normalizePath } from "../../../shared/normalizePath";
import { copyFileHandlingWsl } from "./wsl_path_utils";

// Directories to exclude when scanning files
const EXCLUDED_DIRS = ["node_modules", ".git", ".next"];

/**
 * Recursively gets all files in a directory, excluding node_modules and .git
 * @param dir The directory to scan
 * @param baseDir The base directory for calculating relative paths
 * @returns Array of file paths relative to the base directory
 */
export function getFilesRecursively(dir: string, baseDir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const files: string[] = [];

  for (const dirent of dirents) {
    const res = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      if (!EXCLUDED_DIRS.includes(dirent.name)) {
        files.push(...getFilesRecursively(res, baseDir));
      }
    } else {
      files.push(path.relative(baseDir, res));
    }
  }

  return files;
}

export async function copyDirectoryRecursive(
  source: string,
  destination: string,
  options?: {
    filter?: (source: string) => boolean;
    excludeNodeModules?: boolean;
  },
) {
  // Track the current recursion path to detect cycles (not global visited set)
  const visitingPaths = new Set<string>();
  const sourceRoot = path.resolve(source);
  // Seed with sourceRoot to prevent top-level symlinks (e.g., link -> ..) from bypassing cycle detection
  visitingPaths.add(sourceRoot);
  try {
    return await copyDirectoryRecursiveInternal(
      source,
      destination,
      options,
      visitingPaths,
      sourceRoot,
    );
  } finally {
    visitingPaths.delete(sourceRoot);
  }
}

async function copyDirectoryRecursiveInternal(
  source: string,
  destination: string,
  options:
    | {
        filter?: (source: string) => boolean;
        excludeNodeModules?: boolean;
      }
    | undefined,
  visitingPaths: Set<string>,
  sourceRoot: string,
) {
  const excludeNodeModules = options?.excludeNodeModules !== false;
  const filter = options?.filter;

  await fsPromises.mkdir(destination, { recursive: true });
  const entries = await fsPromises.readdir(source, { withFileTypes: true });
  // Why do we sort? This ensures stable ordering of files across platforms
  // which is helpful for tests (and has no practical downsides).
  entries.sort();

  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);

    // Check filter if provided
    if (filter && !filter(srcPath)) {
      continue;
    }

    if (entry.isSymbolicLink()) {
      // Skip node_modules symlinks if excludeNodeModules is set
      if (excludeNodeModules && entry.name === "node_modules") {
        continue;
      }

      // Handle symlinks by resolving their target and checking boundaries
      const linkTarget = await fsPromises.readlink(srcPath);

      // Resolve symlink target to absolute path for boundary checking
      let resolvedTarget: string;
      try {
        // For absolute paths, use as-is; for relative, resolve relative to symlink's directory
        if (path.isAbsolute(linkTarget)) {
          resolvedTarget = path.resolve(linkTarget);
        } else {
          resolvedTarget = path.resolve(path.dirname(srcPath), linkTarget);
        }
      } catch {
        // If resolution fails, skip this symlink
        continue;
      }

      // Check if symlink target stays within source tree boundary
      const isWithinSourceTree =
        resolvedTarget.startsWith(sourceRoot + path.sep) ||
        resolvedTarget === sourceRoot;

      // Determine if symlink target is a directory (needed for Windows symlink creation)
      let symlinkType: "file" | "dir" = "file";
      try {
        const stats = await fsPromises.stat(srcPath);
        if (stats.isDirectory()) {
          symlinkType = "dir";
        }
      } catch {
        // If stat fails (broken symlink, etc), default to 'file'
      }

      if (isWithinSourceTree) {
        // Target is within source tree - safe to preserve as symlink
        try {
          await fsPromises.symlink(linkTarget, destPath, symlinkType);
        } catch (error: any) {
          // On Windows without Developer Mode, symlink creation can fail with EPERM.
          // Fall back to copying the symlink target contents instead.
          if (error.code === "EPERM") {
            // Dereference the symlink by copying its contents
            if (symlinkType === "dir") {
              let realPath: string;
              try {
                realPath = await fsPromises.realpath(srcPath);
              } catch {
                // If realpath fails (broken symlink), skip
                continue;
              }

              const resolvedPath = path.resolve(realPath);

              // Double-check boundary before copying (should be true already)
              if (
                !resolvedPath.startsWith(sourceRoot + path.sep) &&
                resolvedPath !== sourceRoot
              ) {
                continue;
              }

              // Check if this path is currently being visited (cycle detection)
              if (visitingPaths.has(resolvedPath)) {
                // Avoid infinite recursion from circular symlinks
                continue;
              }

              // Add to current recursion path
              visitingPaths.add(resolvedPath);
              try {
                // Recursively copy symlinked directory with cycle protection
                await copyDirectoryRecursiveInternal(
                  realPath,
                  destPath,
                  options,
                  visitingPaths,
                  sourceRoot,
                );
              } finally {
                // Remove from current recursion path when backtracking
                visitingPaths.delete(resolvedPath);
              }
            } else {
              // Copy symlinked file by dereferencing
              try {
                await fsPromises.realpath(srcPath);
              } catch {
                // If realpath fails (broken symlink), skip
                continue;
              }

              await copyFileHandlingWsl(srcPath, destPath);
            }
          } else {
            throw error;
          }
        }
      } else {
        // Target escapes source tree boundary - dereference by copying contents
        if (symlinkType === "dir") {
          let realPath: string;
          try {
            realPath = await fsPromises.realpath(srcPath);
          } catch {
            // If realpath fails (broken symlink), skip
            continue;
          }

          const resolvedPath = path.resolve(realPath);

          // Verify resolved path is within boundary (sanity check)
          if (
            !resolvedPath.startsWith(sourceRoot + path.sep) &&
            resolvedPath !== sourceRoot
          ) {
            // Symlink target is truly outside tree, skip to prevent unintended copying
            continue;
          }

          // Check if this path is currently being visited (cycle detection)
          if (visitingPaths.has(resolvedPath)) {
            // Avoid infinite recursion from circular symlinks
            continue;
          }

          // Add to current recursion path
          visitingPaths.add(resolvedPath);
          try {
            // Recursively copy symlinked directory with cycle protection
            await copyDirectoryRecursiveInternal(
              realPath,
              destPath,
              options,
              visitingPaths,
              sourceRoot,
            );
          } finally {
            // Remove from current recursion path when backtracking
            visitingPaths.delete(resolvedPath);
          }
        } else {
          // File symlink that escapes source tree boundary - skip to prevent
          // importing external files (e.g., config/.env -> ../.env would pull
          // host files into the copied app)
          continue;
        }
      }
    } else if (entry.isDirectory()) {
      // Exclude node_modules directories if option is set
      if (excludeNodeModules && entry.name === "node_modules") {
        continue;
      }

      // Add current directory to recursion path for cycle detection
      const resolvedSource = path.resolve(srcPath);
      if (visitingPaths.has(resolvedSource)) {
        // Skip if already in current recursion chain (cycle)
        continue;
      }

      visitingPaths.add(resolvedSource);
      try {
        await copyDirectoryRecursiveInternal(
          srcPath,
          destPath,
          options,
          visitingPaths,
          sourceRoot,
        );
      } finally {
        // Remove from current recursion path when backtracking
        visitingPaths.delete(resolvedSource);
      }
    } else {
      await copyFileHandlingWsl(srcPath, destPath);
    }
  }
}

export async function writeMigrationFile(
  appPath: string,
  queryContent: string,
  queryDescription?: string,
): Promise<string> {
  const migrationsDir = path.join(appPath, "supabase", "migrations");
  await fsExtra.ensureDir(migrationsDir);

  const files = await fsExtra.readdir(migrationsDir);
  const migrationNumbers = files
    .map((file) => {
      const match = file.match(/^(\d{4})_/);
      return match ? parseInt(match[1], 10) : -1;
    })
    .filter((num) => num !== -1);

  const nextMigrationNumber =
    migrationNumbers.length > 0 ? Math.max(...migrationNumbers) + 1 : 0;
  const paddedNumber = String(nextMigrationNumber).padStart(4, "0");

  let description = "migration";
  if (queryDescription) {
    description = queryDescription.toLowerCase().replace(/[\s\W-]+/g, "_");
  } else {
    description = generateCuteAppName().replace(/-/g, "_");
  }

  const migrationFileName = `${paddedNumber}_${description}.sql`;
  const migrationFilePath = path.join(migrationsDir, migrationFileName);

  await fsExtra.writeFile(migrationFilePath, queryContent);
  return normalizePath(path.relative(appPath, migrationFilePath));
}

export async function fileExists(filePath: string) {
  return fsPromises
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}
