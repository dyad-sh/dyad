import fs from "node:fs";
import fsAsync from "node:fs/promises";
import path from "node:path";
import { isIgnored } from "isomorphic-git";
import log from "electron-log";
import { IS_TEST_BUILD } from "../ipc/utils/test_utils";
import { glob } from "glob";
import { AppChatContext } from "../lib/schemas";
import { readSettings } from "@/main/settings";

const logger = log.scope("utils/codebase");

// File extensions to include in the extraction
const ALLOWED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".css",
  ".html",
  ".md",
];

// Directories to always exclude
const EXCLUDED_DIRS = ["node_modules", ".git", "dist", "build"];

// Files to always include, regardless of extension
const ALWAYS_INCLUDE_FILES = ["package.json"];

// Maximum file size to include (in bytes) - 100KB
const MAX_FILE_SIZE = 100 * 1024;

// Maximum size for fileContentCache
const MAX_FILE_CACHE_SIZE = 500;

// File content cache with timestamps
type FileCache = {
  content: string;
  mtime: number;
};

// Cache for file contents
const fileContentCache = new Map<string, FileCache>();

// Cache for git ignored paths
const gitIgnoreCache = new Map<string, boolean>();
// Map to store .gitignore file paths and their modification times
const gitIgnoreMtimes = new Map<string, number>();

/**
 * Check if a path should be ignored based on git ignore rules
 */
async function isGitIgnored(
  filePath: string,
  baseDir: string,
): Promise<boolean> {
  try {
    // Check if any relevant .gitignore has been modified
    // Git checks .gitignore files in the path from the repo root to the file
    let currentDir = baseDir;
    const pathParts = path.relative(baseDir, filePath).split(path.sep);
    let shouldClearCache = false;

    // Check root .gitignore
    const rootGitIgnorePath = path.join(baseDir, ".gitignore");
    try {
      const stats = await fsAsync.stat(rootGitIgnorePath);
      const lastMtime = gitIgnoreMtimes.get(rootGitIgnorePath) || 0;
      if (stats.mtimeMs > lastMtime) {
        gitIgnoreMtimes.set(rootGitIgnorePath, stats.mtimeMs);
        shouldClearCache = true;
      }
    } catch {
      // Root .gitignore might not exist, which is fine
    }

    // Check .gitignore files in parent directories
    for (let i = 0; i < pathParts.length - 1; i++) {
      currentDir = path.join(currentDir, pathParts[i]);
      const gitIgnorePath = path.join(currentDir, ".gitignore");

      try {
        const stats = await fsAsync.stat(gitIgnorePath);
        const lastMtime = gitIgnoreMtimes.get(gitIgnorePath) || 0;
        if (stats.mtimeMs > lastMtime) {
          gitIgnoreMtimes.set(gitIgnorePath, stats.mtimeMs);
          shouldClearCache = true;
        }
      } catch {
        // This directory might not have a .gitignore, which is fine
      }
    }

    // Clear cache if any .gitignore was modified
    if (shouldClearCache) {
      gitIgnoreCache.clear();
    }

    const cacheKey = `${baseDir}:${filePath}`;

    if (gitIgnoreCache.has(cacheKey)) {
      return gitIgnoreCache.get(cacheKey)!;
    }

    const relativePath = path.relative(baseDir, filePath);
    const result = await isIgnored({
      fs,
      dir: baseDir,
      filepath: relativePath,
    });

    gitIgnoreCache.set(cacheKey, result);
    return result;
  } catch (error) {
    logger.error(`Error checking if path is git ignored: ${filePath}`, error);
    return false;
  }
}

/**
 * Read file contents with caching based on last modified time
 */
async function readFileWithCache(filePath: string): Promise<string | null> {
  try {
    // Get file stats to check the modification time
    const stats = await fsAsync.stat(filePath);
    const currentMtime = stats.mtimeMs;

    // If file is in cache and hasn't been modified, use cached content
    if (fileContentCache.has(filePath)) {
      const cache = fileContentCache.get(filePath)!;
      if (cache.mtime === currentMtime) {
        return cache.content;
      }
    }

    // Read file and update cache
    const rawContent = await fsAsync.readFile(filePath, "utf-8");
    const content = cleanContent({ content: rawContent, filePath });
    fileContentCache.set(filePath, {
      content,
      mtime: currentMtime,
    });

    // Manage cache size by clearing oldest entries when it gets too large
    if (fileContentCache.size > MAX_FILE_CACHE_SIZE) {
      // Get the oldest 25% of entries to remove
      const entriesToDelete = Math.ceil(MAX_FILE_CACHE_SIZE * 0.25);
      const keys = Array.from(fileContentCache.keys());

      // Remove oldest entries (first in, first out)
      for (let i = 0; i < entriesToDelete; i++) {
        fileContentCache.delete(keys[i]);
      }
    }

    return content;
  } catch (error) {
    logger.error(`Error reading file: ${filePath}`, error);
    return null;
  }
}

function cleanContent({
  content,
  filePath,
}: {
  content: string;
  filePath: string;
}): string {
  // Why are we cleaning package.json?
  // 1. It contains unnecessary information for LLM context
  // 2. Fields like packageManager cause diffs in e2e test snapshots.
  if (path.basename(filePath) === "package.json") {
    try {
      const { dependencies, devDependencies } = JSON.parse(content);
      const cleanPackageJson = {
        dependencies,
        devDependencies,
      };
      return JSON.stringify(cleanPackageJson, null, 2);
    } catch (error) {
      logger.error(`Error cleaning package.json: ${filePath}`, error);
      return content;
    }
  }
  return content;
}

/**
 * Recursively walk a directory and collect all relevant files
 */
async function collectFiles(dir: string, baseDir: string): Promise<string[]> {
  const files: string[] = [];

  // Check if directory exists
  try {
    await fsAsync.access(dir);
  } catch {
    // Directory doesn't exist or is not accessible
    return files;
  }

  try {
    // Read directory contents
    const entries = await fsAsync.readdir(dir, { withFileTypes: true });

    // Process entries concurrently
    const promises = entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);

      // Skip excluded directories
      if (entry.isDirectory() && EXCLUDED_DIRS.includes(entry.name)) {
        return;
      }

      // Skip if the entry is git ignored
      if (await isGitIgnored(fullPath, baseDir)) {
        return;
      }

      if (entry.isDirectory()) {
        // Recursively process subdirectories
        const subDirFiles = await collectFiles(fullPath, baseDir);
        files.push(...subDirFiles);
      } else if (entry.isFile()) {
        // Check file extension and filename
        const ext = path.extname(entry.name).toLowerCase();
        const shouldAlwaysInclude = ALWAYS_INCLUDE_FILES.includes(entry.name);

        // Skip files that are too large
        try {
          const stats = await fsAsync.stat(fullPath);
          if (stats.size > MAX_FILE_SIZE) {
            return;
          }
        } catch (error) {
          logger.error(`Error checking file size: ${fullPath}`, error);
          return;
        }

        if (ALLOWED_EXTENSIONS.includes(ext) || shouldAlwaysInclude) {
          files.push(fullPath);
        }
      }
    });

    await Promise.all(promises);
  } catch (error) {
    logger.error(`Error reading directory ${dir}:`, error);
  }

  return files;
}

// Skip large configuration files or generated code (just include the path)
function isOmittedFile(relativePath: string): boolean {
  return (
    // Why are we not using path.join here?
    // Because we have already normalized the path to use /.
    relativePath.includes("src/components/ui") ||
    relativePath.includes("eslint.config") ||
    relativePath.includes("tsconfig.json") ||
    relativePath.includes("package-lock.json") ||
    // These should already be excluded based on file type, but
    // just in case, we'll redact the contents here.
    relativePath.includes(".env")
  );
}

const OMITTED_FILE_CONTENT = "// Contents omitted for brevity";

/**
 * Format a file for inclusion in the codebase extract
 */
async function formatFile(filePath: string, baseDir: string): Promise<string> {
  try {
    const relativePath = path
      .relative(baseDir, filePath)
      // Why? Normalize Windows-style paths which causes lots of weird issues (e.g. Git commit)
      .split(path.sep)
      .join("/");

    if (isOmittedFile(relativePath)) {
      return `<dyad-file path="${relativePath}">
${OMITTED_FILE_CONTENT}
</dyad-file>

`;
    }

    const content = await readFileWithCache(filePath);

    if (content === null) {
      return `<dyad-file path="${relativePath}">
// Error reading file
</dyad-file>

`;
    }

    return `<dyad-file path="${relativePath}">
${content}
</dyad-file>

`;
  } catch (error) {
    logger.error(`Error reading file: ${filePath}`, error);
    return `<dyad-file path="${path.relative(baseDir, filePath)}">
// Error reading file: ${error}
</dyad-file>

`;
  }
}

export type CodebaseFile = {
  path: string;
  content: string;
  force?: boolean;
};

/**
 * Extract and format codebase files as a string to be included in prompts
 * @param appPath - Path to the codebase to extract
 * @returns Object containing formatted output and individual files
 */
export async function extractCodebase({
  appPath,
  chatContext,
}: {
  appPath: string;
  chatContext: AppChatContext;
}): Promise<{
  formattedOutput: string;
  files: CodebaseFile[];
}> {
  const settings = readSettings();
  const isSmartContextEnabled =
    settings?.enableDyadPro && settings?.enableProSmartFilesContextMode;

  try {
    await fsAsync.access(appPath);
  } catch {
    return {
      formattedOutput: `# Error: Directory ${appPath} does not exist or is not accessible`,
      files: [],
    };
  }
  const startTime = Date.now();

  // Collect all relevant files
  let files = await collectFiles(appPath, appPath);

  // Collect files from contextPaths and smartContextAutoIncludes
  const { contextPaths, smartContextAutoIncludes } = chatContext;
  const includedFiles = new Set<string>();
  const autoIncludedFiles = new Set<string>();

  // Add files from contextPaths
  if (contextPaths && contextPaths.length > 0) {
    for (const p of contextPaths) {
      const pattern = createFullGlobPath({
        appPath,
        globPath: p.globPath,
      });
      const matches = await glob(pattern, {
        nodir: true,
        absolute: true,
        ignore: "**/node_modules/**",
      });
      matches.forEach((file) => {
        const normalizedFile = path.normalize(file);
        includedFiles.add(normalizedFile);
      });
    }
  }

  // Add files from smartContextAutoIncludes
  if (
    isSmartContextEnabled &&
    smartContextAutoIncludes &&
    smartContextAutoIncludes.length > 0
  ) {
    for (const p of smartContextAutoIncludes) {
      const pattern = createFullGlobPath({
        appPath,
        globPath: p.globPath,
      });
      const matches = await glob(pattern, {
        nodir: true,
        absolute: true,
      });
      matches.forEach((file) => {
        const normalizedFile = path.normalize(file);
        autoIncludedFiles.add(normalizedFile);
        includedFiles.add(normalizedFile); // Also add to included files
      });
    }
  }

  // Only filter files if contextPaths are provided
  // If only smartContextAutoIncludes are provided, keep all files and just mark auto-includes as forced
  if (contextPaths && contextPaths.length > 0) {
    files = files.filter((file) => includedFiles.has(path.normalize(file)));
  }

  // Sort files by modification time (oldest first)
  // This is important for cache-ability.
  const sortedFiles = await sortFilesByModificationTime([...new Set(files)]);

  // Format files and collect individual file contents
  const filesArray: CodebaseFile[] = [];
  const formatPromises = sortedFiles.map(async (file) => {
    const formattedContent = await formatFile(file, appPath);

    // Get raw content for the files array
    const relativePath = path
      .relative(appPath, file)
      // Why? Normalize Windows-style paths which causes lots of weird issues (e.g. Git commit)
      .split(path.sep)
      .join("/");

    const isForced = autoIncludedFiles.has(path.normalize(file));

    const fileContent = isOmittedFile(relativePath)
      ? OMITTED_FILE_CONTENT
      : await readFileWithCache(file);
    if (fileContent !== null) {
      filesArray.push({
        path: relativePath,
        content: fileContent,
        force: isForced,
      });
    }

    return formattedContent;
  });

  const formattedFiles = await Promise.all(formatPromises);
  const formattedOutput = formattedFiles.join("");

  const endTime = Date.now();
  logger.log("extractCodebase: time taken", endTime - startTime);
  if (IS_TEST_BUILD) {
    // Why? For some reason, file ordering is not stable on Windows.
    // This is a workaround to ensure stable ordering, although
    // ideally we'd like to sort it by modification time which is
    // important for cache-ability.
    filesArray.sort((a, b) => a.path.localeCompare(b.path));
  }
  return {
    formattedOutput,
    files: filesArray,
  };
}

/**
 * Sort files by their modification timestamp (oldest first)
 */
async function sortFilesByModificationTime(files: string[]): Promise<string[]> {
  // Get stats for all files
  const fileStats = await Promise.all(
    files.map(async (file) => {
      try {
        const stats = await fsAsync.stat(file);
        return { file, mtime: stats.mtimeMs };
      } catch (error) {
        // If there's an error getting stats, use current time as fallback
        logger.error(`Error getting file stats for ${file}:`, error);
        return { file, mtime: Date.now() };
      }
    }),
  );

  if (IS_TEST_BUILD) {
    // Why? For some reason, file ordering is not stable on Windows.
    // This is a workaround to ensure stable ordering, although
    // ideally we'd like to sort it by modification time which is
    // important for cache-ability.
    return fileStats
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((item) => item.file);
  }
  // Sort by modification time (oldest first)
  return fileStats.sort((a, b) => a.mtime - b.mtime).map((item) => item.file);
}

function createFullGlobPath({
  appPath,
  globPath,
}: {
  appPath: string;
  globPath: string;
}): string {
  // By default the glob package treats "\" as an escape character.
  // We want the path to use forward slash for all platforms.
  return `${appPath.replace(/\\/g, "/")}/${globPath}`;
}
