import fsAsync from "node:fs/promises";
import path from "node:path";
import { gitListFilesNative } from "../ipc/utils/git_utils";
import { isPathIgnoredByGitIgnore } from "../ipc/utils/gitignore_utils";
import log from "electron-log";
import { IS_TEST_BUILD } from "../ipc/utils/test_utils";
import { glob } from "glob";
import { AppChatContext } from "../lib/schemas";
import { readSettings } from "@/main/settings";
import { AsyncVirtualFileSystem } from "../../shared/VirtualFilesystem";
import {
  extractCodebaseStarted,
  extractCodebaseFinished,
} from "./memory_activity";

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
  ".astro",
  ".vue",
  ".svelte",
  ".scss",
  ".sass",
  ".less",
  // Shader source files for WebGL/WebGPU/Three.js projects
  ".glsl",
  ".wgsl",
  ".vert",
  ".frag",
  ".vs",
  ".fs",
  ".comp",
  // Oftentimes used as config (e.g. package.json, vercel.json) or data files (e.g. translations)
  ".json",
  // GitHub Actions
  ".yml",
  ".yaml",
  // Needed for Capacitor projects
  ".xml",
  ".plist",
  ".entitlements",
  ".kt",
  ".java",
  ".gradle",
  ".swift",
  // Edge cases
  // https://github.com/dyad-sh/dyad/issues/880
  ".py",
  // https://github.com/dyad-sh/dyad/issues/1221
  ".php",
];

// Directories to always exclude
// Normally these files are excluded by the gitignore, but sometimes
// people don't have their gitignore setup correctly so we want to
// be conservative and never include these directories.
//
// ex: https://github.com/dyad-sh/dyad/issues/727
const EXCLUDED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".venv",
  "venv",
];

// Files to always exclude
const EXCLUDED_FILES = [
  ".gitattributes",
  "pnpm-lock.yaml",
  "package-lock.json",
  "pnpm-workspace.yaml",
];

// Files to always include, regardless of extension
const ALWAYS_INCLUDE_FILES = [".gitignore"];

// File patterns to always omit (contents will be replaced with a placeholder)
// We don't want to send environment variables to the LLM because they
// are sensitive and users should be configuring them via the UI.
const ALWAYS_OMITTED_FILES = [".env", ".env.local"];

// File patterns to omit (contents will be replaced with a placeholder)
//
// Why are we not using path.join here?
// Because we have already normalized the path to use /.
//
// Note: these files are only omitted when NOT using smart context.
//
// Why do we omit these files when not using smart context?
//
// Because these files are typically low-signal and adding them
// to the context can cause users to much more quickly hit their
// free rate limits.
const OMITTED_FILES = [
  ...ALWAYS_OMITTED_FILES,
  "src/components/ui",
  "eslint.config",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "tsconfig.base.json",
  "components.json",
];

// Maximum file size to include (in bytes) - 1MB
const MAX_FILE_SIZE = 1000 * 1024;

// Maximum size for fileContentCache
const MAX_FILE_CACHE_SIZE = 500;

// File content cache with timestamps
type FileCache = {
  content: string;
  mtime: number;
};

// Cache for file contents
const fileContentCache = new Map<string, FileCache>();

/**
 * Read file contents with caching based on last modified time
 */
export async function readFileWithCache(
  filePath: string,
  virtualFileSystem?: AsyncVirtualFileSystem,
): Promise<string | undefined> {
  try {
    // Check virtual filesystem first if provided
    if (virtualFileSystem) {
      const virtualContent = await virtualFileSystem.readFile(filePath);
      if (virtualContent != null) {
        return virtualContent;
      }
    }

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
    const content = rawContent;
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
    return undefined;
  }
}

/**
 * Traverses a directory and collects all relevant files using native Git.
 */
async function collectFilesNativeGit(dir: string): Promise<string[]> {
  let files: string[] = [];

  try {
    // We put the vast majority of the computational burden on Git for the
    // sake of performance. Nonetheless, the behavior of this function
    // should still be as close as possible to collectFilesByTraversal.
    files = (
      await gitListFilesNative({
        path: dir,
        excludedFiles: EXCLUDED_FILES,
        excludedDirs: EXCLUDED_DIRS,
      })
    ).map((file) => path.join(dir, file));
  } catch (error) {
    logger.error(
      `Git failed to read directory ${dir} and is falling back to filesystem traversal:`,
      error,
    );
    // Since collectFilesByTraversal traverses the directory tree manually,
    // we'll still be able to collect the files even if git fails
    return await collectFilesByTraversal(dir, dir);
  }

  // Git cannot exclude files by size, so we still need to do that manually
  return (
    await Promise.all(
      files.map(async (file) => {
        try {
          const stats = await fsAsync.lstat(file);
          if (!stats.isFile() || stats.size > MAX_FILE_SIZE) {
            return "";
          }
          return file;
        } catch (error) {
          logger.error(`Failed to read file ${file}:`, error);
          return "";
        }
      }),
    )
  ).filter(Boolean);
}

/**
 * Recursively walk a directory and collect all relevant files.
 */
async function collectFilesByTraversal(
  dir: string,
  baseDir: string,
): Promise<string[]> {
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
      if (
        await isPathIgnoredByGitIgnore({
          basePath: baseDir,
          filePath: fullPath,
          isDirectory: entry.isDirectory(),
        })
      ) {
        return;
      }

      if (entry.isDirectory()) {
        // Recursively process subdirectories
        const subDirFiles = await collectFilesByTraversal(fullPath, baseDir);
        files.push(...subDirFiles);
      } else if (entry.isFile()) {
        // Skip excluded files
        if (EXCLUDED_FILES.includes(entry.name)) {
          return;
        }

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

        // Include all files in the list
        files.push(fullPath);
      }
    });

    await Promise.all(promises);
  } catch (error) {
    logger.error(`Error reading directory ${dir}:`, error);
  }

  return files;
}

const OMITTED_FILE_CONTENT = "// File contents excluded from context";

/**
 * Check if file contents should be read based on extension and inclusion rules
 */
function shouldReadFileContents({
  filePath,
  normalizedRelativePath,
}: {
  filePath: string;
  normalizedRelativePath: string;
}): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  // OMITTED_FILES takes precedence - never read if omitted
  if (
    OMITTED_FILES.some((pattern) => normalizedRelativePath.includes(pattern))
  ) {
    return false;
  }

  // Check if file should be included based on extension or filename
  return (
    ALLOWED_EXTENSIONS.includes(ext) || ALWAYS_INCLUDE_FILES.includes(fileName)
  );
}

function shouldReadFileContentsForSmartContext({
  filePath,
  normalizedRelativePath,
}: {
  filePath: string;
  normalizedRelativePath: string;
}): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  // ALWAYS__OMITTED_FILES takes precedence - never read if omitted
  if (
    ALWAYS_OMITTED_FILES.some((pattern) =>
      normalizedRelativePath.includes(pattern),
    )
  ) {
    return false;
  }

  // Check if file should be included based on extension or filename
  return (
    ALLOWED_EXTENSIONS.includes(ext) || ALWAYS_INCLUDE_FILES.includes(fileName)
  );
}

/**
 * Format a file for inclusion in the codebase extract
 */
async function formatFile({
  filePath,
  normalizedRelativePath,
  virtualFileSystem,
}: {
  filePath: string;
  normalizedRelativePath: string;
  virtualFileSystem?: AsyncVirtualFileSystem;
}): Promise<string> {
  try {
    // Check if we should read file contents
    if (!shouldReadFileContents({ filePath, normalizedRelativePath })) {
      return `<dyad-file path="${normalizedRelativePath}">
${OMITTED_FILE_CONTENT}
</dyad-file>

`;
    }

    const content = await readFileWithCache(filePath, virtualFileSystem);

    if (content == null) {
      return `<dyad-file path="${normalizedRelativePath}">
// Error reading file
</dyad-file>

`;
    }

    return `<dyad-file path="${normalizedRelativePath}">
${content}
</dyad-file>

`;
  } catch (error) {
    logger.error(`Error reading file: ${filePath}`, error);
    return `<dyad-file path="${normalizedRelativePath}">
// Error reading file: ${error}
</dyad-file>

`;
  }
}

export interface BaseFile {
  path: string;
  focused?: boolean;
  force?: boolean;
}

export interface CodebaseFile extends BaseFile {
  content: string;
}

export interface CodebaseFileReference extends BaseFile {
  fileId: string;
}

interface PreparedCodebaseFile extends BaseFile {
  absolutePath: string;
}

async function prepareCodebaseFiles({
  appPath,
  chatContext,
  virtualFileSystem,
}: {
  appPath: string;
  chatContext: AppChatContext;
  virtualFileSystem?: AsyncVirtualFileSystem;
}): Promise<PreparedCodebaseFile[] | undefined> {
  const settings = readSettings();
  const isSmartContextEnabled =
    settings?.enableDyadPro && settings?.enableProSmartFilesContextMode;

  try {
    await fsAsync.access(appPath);
  } catch {
    return undefined;
  }

  let files = await collectFilesNativeGit(appPath);

  if (virtualFileSystem) {
    const deletedFiles = new Set(
      virtualFileSystem
        .getDeletedFiles()
        .map((relativePath) => path.resolve(appPath, relativePath)),
    );
    files = files.filter((file) => !deletedFiles.has(file));

    for (const virtualFile of virtualFileSystem.getVirtualFiles()) {
      const absolutePath = path.resolve(appPath, virtualFile.path);
      if (!files.includes(absolutePath)) {
        files.push(absolutePath);
      }
    }
  }

  const { contextPaths, smartContextAutoIncludes, excludePaths } = chatContext;
  const includedFiles = new Set<string>();
  const autoIncludedFiles = new Set<string>();
  const excludedFiles = new Set<string>();

  if (contextPaths && contextPaths.length > 0) {
    for (const contextPath of contextPaths) {
      const matches = await glob(
        createFullGlobPath({ appPath, globPath: contextPath.globPath }),
        {
          nodir: true,
          absolute: true,
          ignore: "**/node_modules/**",
        },
      );
      matches.forEach((file) => includedFiles.add(path.normalize(file)));
    }
  }

  if (
    isSmartContextEnabled &&
    smartContextAutoIncludes &&
    smartContextAutoIncludes.length > 0
  ) {
    for (const autoInclude of smartContextAutoIncludes) {
      const matches = await glob(
        createFullGlobPath({ appPath, globPath: autoInclude.globPath }),
        {
          nodir: true,
          absolute: true,
          ignore: "**/node_modules/**",
        },
      );
      matches.forEach((file) => {
        const normalizedFile = path.normalize(file);
        autoIncludedFiles.add(normalizedFile);
        includedFiles.add(normalizedFile);
      });
    }
  }

  if (excludePaths && excludePaths.length > 0) {
    for (const excludePath of excludePaths) {
      const matches = await glob(
        createFullGlobPath({ appPath, globPath: excludePath.globPath }),
        {
          nodir: true,
          absolute: true,
          ignore: "**/node_modules/**",
        },
      );
      matches.forEach((file) => excludedFiles.add(path.normalize(file)));
    }
  }

  if (contextPaths && contextPaths.length > 0) {
    files = files.filter((file) => includedFiles.has(path.normalize(file)));
  }
  if (excludedFiles.size > 0) {
    files = files.filter((file) => !excludedFiles.has(path.normalize(file)));
  }

  const sortedFiles = await sortFilesByModificationTime(
    [...new Set(files)],
    Boolean(settings.isTestMode),
  );

  return sortedFiles.map((file) => ({
    absolutePath: file,
    path: path.relative(appPath, file).split(path.sep).join("/"),
    force:
      autoIncludedFiles.has(path.normalize(file)) &&
      !excludedFiles.has(path.normalize(file)),
  }));
}

/**
 * List codebase files without reading their contents.
 */
export async function listCodebaseFileMetadata({
  appPath,
  chatContext,
}: {
  appPath: string;
  chatContext: AppChatContext;
}): Promise<{ files: BaseFile[]; totalFileCount: number }> {
  const preparedFiles =
    (await prepareCodebaseFiles({ appPath, chatContext })) ?? [];

  return {
    files: preparedFiles.map(({ path: filePath, force }) => ({
      path: filePath,
      force,
    })),
    totalFileCount: preparedFiles.length,
  };
}

/**
 * Extract and format codebase files as a string to be included in prompts
 * @param params.appPath - Path to the codebase to extract
 * @param params.chatContext - Chat context selecting which paths to include
 * @param params.virtualFileSystem - Optional virtual filesystem to apply modifications
 * @returns Object containing formatted output and individual files
 */
export async function extractCodebase(params: {
  appPath: string;
  chatContext: AppChatContext;
  virtualFileSystem?: AsyncVirtualFileSystem;
}): Promise<{
  formattedOutput: string;
  files: CodebaseFile[];
}> {
  // Tracked so memory snapshots can tell when an extraction was running.
  extractCodebaseStarted();
  try {
    return await extractCodebaseInner(params);
  } finally {
    extractCodebaseFinished();
  }
}

async function extractCodebaseInner({
  appPath,
  chatContext,
  virtualFileSystem,
}: {
  appPath: string;
  chatContext: AppChatContext;
  virtualFileSystem?: AsyncVirtualFileSystem;
}): Promise<{
  formattedOutput: string;
  files: CodebaseFile[];
}> {
  const startTime = Date.now();
  const preparedFiles = await prepareCodebaseFiles({
    appPath,
    chatContext,
    virtualFileSystem,
  });
  if (!preparedFiles) {
    return {
      formattedOutput: `# Error: Directory ${appPath} does not exist or is not accessible`,
      files: [],
    };
  }

  // Format files and collect individual file contents
  const formatPromises = preparedFiles.map(async (preparedFile) => {
    const file = preparedFile.absolutePath;
    const normalizedRelativePath = preparedFile.path;
    const formattedContent = await formatFile({
      filePath: file,
      normalizedRelativePath,
      virtualFileSystem,
    });

    // Determine file content based on whether we should read it
    let fileContent: string;
    if (
      !shouldReadFileContentsForSmartContext({
        filePath: file,
        normalizedRelativePath,
      })
    ) {
      fileContent = OMITTED_FILE_CONTENT;
    } else {
      const readContent = await readFileWithCache(file, virtualFileSystem);
      fileContent = readContent ?? "// Error reading file";
    }

    return {
      formattedContent,
      file: {
        path: normalizedRelativePath,
        content: fileContent,
        force: preparedFile.force,
      } satisfies CodebaseFile,
    };
  });

  const formattedResults = await Promise.all(formatPromises);
  const formattedFiles = formattedResults.map(
    (result) => result.formattedContent,
  );
  const filesArray = formattedResults.map((result) => result.file);
  const formattedOutput = formattedFiles.join("");

  const endTime = Date.now();
  logger.debug("extractCodebase: time taken", endTime - startTime);
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
async function sortFilesByModificationTime(
  files: string[],
  forcePathSort = false,
): Promise<string[]> {
  // Get stats for all files
  const fileStats = await Promise.all(
    files.map(async (file) => {
      try {
        const stats = await fsAsync.stat(file);
        return { file, mtime: stats.mtimeMs };
      } catch (error) {
        // If there's an error getting stats, use current time as fallback
        // This can happen with virtual files, so it's not a big deal.
        logger.warn(`Error getting file stats for ${file}:`, error);
        return { file, mtime: Date.now() };
      }
    }),
  );

  if (IS_TEST_BUILD || forcePathSort) {
    // Why? For some reason, file ordering is not stable on Windows.
    // This is a workaround to ensure stable ordering, although
    // ideally we'd like to sort it by modification time which is
    // important for cache-ability.
    return fileStats
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((item) => item.file);
  }
  // Sort by modification time (oldest first)
  return fileStats
    .sort((a, b) => a.mtime - b.mtime || a.file.localeCompare(b.file))
    .map((item) => item.file);
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
