import fs from "node:fs";
import path from "node:path";

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
      // Exclude node_modules and .git directories
      if (dirent.name !== "node_modules" && dirent.name !== ".git") {
        files.push(...getFilesRecursively(res, baseDir));
      }
    } else {
      // For files, add the relative path
      files.push(path.relative(baseDir, res));
    }
  }

  return files;
}
