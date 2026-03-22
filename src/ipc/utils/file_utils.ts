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
  // Initialize cycle detection and boundary tracking for the top-level call
  const visitedInodes = new Set<string>();
  const sourceRoot = path.resolve(source);
  return copyDirectoryRecursiveInternal(
    source,
    destination,
    options,
    visitedInodes,
    sourceRoot,
  );
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
  visitedInodes: Set<string>,
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

      // Preserve symlinks as-is (copy symlink itself, not the target)
      const linkTarget = await fsPromises.readlink(srcPath);
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

      try {
        await fsPromises.symlink(linkTarget, destPath, symlinkType);
      } catch (error: any) {
        // On Windows without Developer Mode, symlink creation can fail with EPERM.
        // Fall back to copying the symlink target as a regular file/directory,
        // but with cycle and boundary detection to prevent infinite recursion and out-of-tree copying.
        if (error.code === "EPERM") {
          if (symlinkType === "dir") {
            // Check for cycles using inode tracking
            let realPath: string;
            try {
              realPath = await fsPromises.realpath(srcPath);
            } catch {
              // If realpath fails (broken symlink), skip the symlink
              continue;
            }

            // Check if this inode has been visited (cycle detection)
            const stat = await fsPromises.stat(srcPath);
            const inoKey = `${stat.dev}-${stat.ino}`;
            if (visitedInodes.has(inoKey)) {
              // Avoid infinite recursion from circular symlinks
              continue;
            }

            // Check if realPath is within the source tree boundary
            const resolvedPath = path.resolve(realPath);
            if (
              !resolvedPath.startsWith(sourceRoot + path.sep) &&
              resolvedPath !== sourceRoot
            ) {
              // Symlink target is outside source tree, skip to prevent unintended copying
              continue;
            }

            visitedInodes.add(inoKey);
            // Recursively copy symlinked directory with cycle protection
            await copyDirectoryRecursiveInternal(
              realPath,
              destPath,
              options,
              visitedInodes,
              sourceRoot,
            );
          } else {
            // Copy symlinked file
            await copyFileHandlingWsl(srcPath, destPath);
          }
        } else {
          throw error;
        }
      }
    } else if (entry.isDirectory()) {
      // Exclude node_modules directories if option is set
      if (excludeNodeModules && entry.name === "node_modules") {
        continue;
      }
      await copyDirectoryRecursiveInternal(
        srcPath,
        destPath,
        options,
        visitedInodes,
        sourceRoot,
      );
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
