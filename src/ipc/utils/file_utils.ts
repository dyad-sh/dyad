import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import fsExtra from "fs-extra";
import { generateCuteAppName } from "../../lib/utils";
import { normalizePath } from "../../../shared/normalizePath";

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

  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const dirent of dirents) {
    const res = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      // For directories, concat the results of recursive call
      // Exclude specified directories
      if (!EXCLUDED_DIRS.includes(dirent.name)) {
        files.push(...getFilesRecursively(res, baseDir));
      }
    } else {
      // For files, add the relative path
      files.push(path.relative(baseDir, res));
    }
  }

  return files;
}

export async function copyDirectoryRecursive(
  source: string,
  destination: string,
) {
  await fsPromises.mkdir(destination, { recursive: true });
  const entries = await fsPromises.readdir(source, { withFileTypes: true });
  // Why do we sort? This ensures stable ordering of files across platforms
  // which is helpful for tests (and has no practical downsides).
  entries.sort();

  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      // Exclude node_modules directories
      if (entry.name !== "node_modules") {
        await copyDirectoryRecursive(srcPath, destPath);
      }
    } else {
      await fsPromises.copyFile(srcPath, destPath);
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
