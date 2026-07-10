import fsAsync from "node:fs/promises";
import path from "node:path";
import { gitIsIgnoredIso, gitListFilesNative } from "../ipc/utils/git_utils";
import log from "electron-log";
import { IS_TEST_BUILD } from "../ipc/utils/test_utils";
import { glob } from "glob";
import { AppChatContext } from "../lib/schemas";
import { readSettings } from "@/main/settings";
import { AsyncVirtualFileSystem } from "../../shared/VirtualFilesystem";

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

export interface CodebaseExtractionLimits {
  maxFiles: number;
  maxTotalBytes: number;
  ioConcurrency: number;
}

/**
 * Keep codebase extraction comfortably below the Electron main process heap
 * ceiling even when callers retain both the formatted prompt and raw files.
 */
export const DEFAULT_CODEBASE_EXTRACTION_LIMITS: CodebaseExtractionLimits = {
  maxFiles: 2_000,
  maxTotalBytes: 20 * 1024 * 1024,
  ioConcurrency: 16,
};

// Maximum size for fileContentCache
const MAX_FILE_CACHE_SIZE = 500;
const MAX_FILE_CACHE_BYTES = 50 * 1024 * 1024;

// File content cache with timestamps
type FileCache = {
  content: string;
  mtime: number;
  byteLength: number;
};

// Cache for file contents
const fileContentCache = new Map<string, FileCache>();
let fileContentCacheBytes = 0;

// Cache for git ignored paths
const gitIgnoreCache = new Map<string, boolean>();
// Map to store .gitignore file paths and their modification times
const gitIgnoreMtimes = new Map<string, number>();

/**
 * Map items with bounded concurrency while preserving input order.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results: R[] = [];
  results.length = items.length;
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await mapper(items[index], index);
      }
    }),
  );

  return results;
}

/**
 * Check if a path should be ignored based on git ignore rules. Uses isomorphic-git
 */
async function isGitIgnoredIso(
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
    const result = await gitIsIgnoredIso({
      path: baseDir,
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
    const previousEntry = fileContentCache.get(filePath);
    if (previousEntry) {
      fileContentCacheBytes -= previousEntry.byteLength;
    }
    const byteLength = Buffer.byteLength(content, "utf8");
    fileContentCache.set(filePath, {
      content,
      mtime: currentMtime,
      byteLength,
    });
    fileContentCacheBytes += byteLength;

    // Manage cache size by clearing oldest entries when it gets too large
    if (fileContentCache.size > MAX_FILE_CACHE_SIZE) {
      // Get the oldest 25% of entries to remove
      const entriesToDelete = Math.ceil(MAX_FILE_CACHE_SIZE * 0.25);
      const keys = Array.from(fileContentCache.keys());

      // Remove oldest entries (first in, first out)
      for (let i = 0; i < entriesToDelete; i++) {
        const entry = fileContentCache.get(keys[i]);
        if (entry) {
          fileContentCacheBytes -= entry.byteLength;
          fileContentCache.delete(keys[i]);
        }
      }
    }

    while (
      fileContentCacheBytes > MAX_FILE_CACHE_BYTES &&
      fileContentCache.size > 0
    ) {
      const oldestKey = fileContentCache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      const entry = fileContentCache.get(oldestKey);
      if (entry) {
        fileContentCacheBytes -= entry.byteLength;
      }
      fileContentCache.delete(oldestKey);
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
async function collectFilesNativeGit(
  dir: string,
  ioConcurrency: number,
): Promise<string[]> {
  let files: string[] = [];

  try {
    // We put the vast majority of the computational burden on Git for the
    // sake of performance. Nonetheless, the behavior of this function
    // should still be as close as possible to collectFilesIsoGit.
    files = (
      await gitListFilesNative({
        path: dir,
        excludedFiles: EXCLUDED_FILES,
        excludedDirs: EXCLUDED_DIRS,
      })
    ).map((file) => path.join(dir, file));
  } catch (error) {
    logger.error(
      `Git failed to read directory ${dir} and is falling back to isomorphic-git:`,
      error,
    );
    // Since collectFilesIsoGit traverses the directory tree manually,
    // we'll still be able to collect the files even if git fails
    return await collectFilesIsoGit(dir, dir, ioConcurrency);
  }

  // Git cannot exclude files by size, so we still need to do that manually
  return (
    await mapWithConcurrency(files, ioConcurrency, async (file) => {
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
    })
  ).filter(Boolean);
}

/**
 * Recursively walk a directory and collect all relevant files. Uses
 * isomorphic-git to check whether files and directories are gitignored.
 */
async function collectFilesIsoGit(
  dir: string,
  baseDir: string,
  ioConcurrency: number,
): Promise<string[]> {
  const files: string[] = [];

  // Check if directory exists
  try {
    await fsAsync.access(dir);
  } catch {
    // Directory doesn't exist or is not accessible
    return files;
  }

  const directories = [dir];

  while (directories.length > 0) {
    const currentDir = directories.pop()!;
    try {
      const entries = await fsAsync.readdir(currentDir, {
        withFileTypes: true,
      });
      const results = await mapWithConcurrency(
        entries,
        ioConcurrency,
        async (entry) => {
          const fullPath = path.join(currentDir, entry.name);

          if (entry.isDirectory() && EXCLUDED_DIRS.includes(entry.name)) {
            return undefined;
          }

          if (await isGitIgnoredIso(fullPath, baseDir)) {
            return undefined;
          }

          if (entry.isDirectory()) {
            return { directory: fullPath };
          }

          if (!entry.isFile() || EXCLUDED_FILES.includes(entry.name)) {
            return undefined;
          }

          try {
            const stats = await fsAsync.stat(fullPath);
            if (stats.size > MAX_FILE_SIZE) {
              return undefined;
            }
          } catch (error) {
            logger.error(`Error checking file size: ${fullPath}`, error);
            return undefined;
          }

          return { file: fullPath };
        },
      );

      for (const result of results) {
        if (result?.directory) {
          directories.push(result.directory);
        } else if (result?.file) {
          files.push(result.file);
        }
      }
    } catch (error) {
      logger.error(`Error reading directory ${currentDir}:`, error);
    }
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
function formatFile({
  filePath,
  normalizedRelativePath,
  content,
}: {
  filePath: string;
  normalizedRelativePath: string;
  content: string | undefined;
}): string {
  if (!shouldReadFileContents({ filePath, normalizedRelativePath })) {
    return `<dyad-file path="${normalizedRelativePath}">
${OMITTED_FILE_CONTENT}
</dyad-file>

`;
  }

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

export type CodebaseTruncationReason = "file-count" | "total-bytes";

export interface CodebaseTruncation {
  totalFileCount: number;
  includedFileCount: number;
  omittedFileCount: number;
  includedContentBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  reasons: CodebaseTruncationReason[];
}

interface PreparedCodebaseFile {
  absolutePath: string;
  path: string;
  force: boolean;
  estimatedContentBytes: number;
}

function resolveExtractionLimits(
  limits?: Partial<CodebaseExtractionLimits>,
): CodebaseExtractionLimits {
  return {
    maxFiles: Math.max(
      0,
      Math.floor(
        limits?.maxFiles ?? DEFAULT_CODEBASE_EXTRACTION_LIMITS.maxFiles,
      ),
    ),
    maxTotalBytes: Math.max(
      0,
      Math.floor(
        limits?.maxTotalBytes ??
          DEFAULT_CODEBASE_EXTRACTION_LIMITS.maxTotalBytes,
      ),
    ),
    ioConcurrency: Math.max(
      1,
      Math.floor(
        limits?.ioConcurrency ??
          DEFAULT_CODEBASE_EXTRACTION_LIMITS.ioConcurrency,
      ),
    ),
  };
}

async function prepareCodebaseFiles({
  appPath,
  chatContext,
  virtualFileSystem,
  limits,
}: {
  appPath: string;
  chatContext: AppChatContext;
  virtualFileSystem?: AsyncVirtualFileSystem;
  limits: CodebaseExtractionLimits;
}): Promise<PreparedCodebaseFile[] | undefined> {
  try {
    await fsAsync.access(appPath);
  } catch {
    return undefined;
  }

  const settings = readSettings();
  const isSmartContextEnabled =
    settings?.enableDyadPro && settings?.enableProSmartFilesContextMode;

  let files = settings.enableNativeGit
    ? await collectFilesNativeGit(appPath, limits.ioConcurrency)
    : await collectFilesIsoGit(appPath, appPath, limits.ioConcurrency);

  const virtualContentByPath = new Map<string, string>();

  if (virtualFileSystem) {
    const deletedFiles = new Set(
      virtualFileSystem
        .getDeletedFiles()
        .map((relativePath) => path.resolve(appPath, relativePath)),
    );
    files = files.filter((file) => !deletedFiles.has(file));

    const oversizedVirtualFiles = new Set<string>();
    for (const virtualFile of virtualFileSystem.getVirtualFiles()) {
      const absolutePath = path.resolve(appPath, virtualFile.path);
      const contentBytes = Buffer.byteLength(virtualFile.content, "utf8");
      if (contentBytes > MAX_FILE_SIZE) {
        oversizedVirtualFiles.add(absolutePath);
        continue;
      }

      virtualContentByPath.set(absolutePath, virtualFile.content);
      if (!files.includes(absolutePath)) {
        files.push(absolutePath);
      }
    }
    files = files.filter((file) => !oversizedVirtualFiles.has(file));
  }

  const { contextPaths, smartContextAutoIncludes, excludePaths } = chatContext;
  const includedFiles = new Set<string>();
  const autoIncludedFiles = new Set<string>();
  const excludedFiles = new Set<string>();

  if (contextPaths && contextPaths.length > 0) {
    for (const contextPath of contextPaths) {
      const pattern = createFullGlobPath({
        appPath,
        globPath: contextPath.globPath,
      });
      const matches = await glob(pattern, {
        nodir: true,
        absolute: true,
        ignore: "**/node_modules/**",
      });
      matches.forEach((file) => includedFiles.add(path.normalize(file)));
    }
  }

  if (
    isSmartContextEnabled &&
    smartContextAutoIncludes &&
    smartContextAutoIncludes.length > 0
  ) {
    for (const contextPath of smartContextAutoIncludes) {
      const pattern = createFullGlobPath({
        appPath,
        globPath: contextPath.globPath,
      });
      const matches = await glob(pattern, {
        nodir: true,
        absolute: true,
        ignore: "**/node_modules/**",
      });
      matches.forEach((file) => {
        const normalizedFile = path.normalize(file);
        autoIncludedFiles.add(normalizedFile);
        includedFiles.add(normalizedFile);
      });
    }
  }

  if (excludePaths && excludePaths.length > 0) {
    for (const excludePath of excludePaths) {
      const pattern = createFullGlobPath({
        appPath,
        globPath: excludePath.globPath,
      });
      const matches = await glob(pattern, {
        nodir: true,
        absolute: true,
        ignore: "**/node_modules/**",
      });
      matches.forEach((file) => excludedFiles.add(path.normalize(file)));
    }
  }

  if (contextPaths && contextPaths.length > 0) {
    files = files.filter((file) => includedFiles.has(path.normalize(file)));
  }

  if (excludedFiles.size > 0) {
    files = files.filter((file) => !excludedFiles.has(path.normalize(file)));
  }

  const sortedFileStats = await sortFilesByModificationTime(
    [...new Set(files)],
    Boolean(settings.isTestMode),
    limits.ioConcurrency,
  );

  return sortedFileStats.map(({ file, size }) => {
    const normalizedRelativePath = path
      .relative(appPath, file)
      .split(path.sep)
      .join("/");
    const needsContent = shouldReadFileContentsForSmartContext({
      filePath: file,
      normalizedRelativePath,
    });
    const virtualContent = virtualContentByPath.get(file);

    return {
      absolutePath: file,
      path: normalizedRelativePath,
      force:
        autoIncludedFiles.has(path.normalize(file)) &&
        !excludedFiles.has(path.normalize(file)),
      estimatedContentBytes: needsContent
        ? virtualContent === undefined
          ? size
          : Buffer.byteLength(virtualContent, "utf8")
        : 0,
    };
  });
}

/**
 * List codebase files without reading their contents. This is used by tools
 * that only need paths and avoids constructing two full codebase copies.
 */
export async function listCodebaseFileMetadata({
  appPath,
  chatContext,
}: {
  appPath: string;
  chatContext: AppChatContext;
}): Promise<BaseFile[]> {
  const files = await prepareCodebaseFiles({
    appPath,
    chatContext,
    limits: DEFAULT_CODEBASE_EXTRACTION_LIMITS,
  });

  return (files ?? []).map((file) => ({
    path: file.path,
    force: file.force,
  }));
}

function selectFilesWithinLimits(
  files: PreparedCodebaseFile[],
  limits: CodebaseExtractionLimits,
): {
  files: PreparedCodebaseFile[];
  truncation: Omit<CodebaseTruncation, "includedContentBytes"> | undefined;
} {
  const prioritizedFiles = [
    ...files.filter((file) => file.force),
    ...files.filter((file) => !file.force),
  ];
  const selectedPaths = new Set<string>();
  const reasons = new Set<CodebaseTruncationReason>();
  let selectedBytes = 0;

  for (const file of prioritizedFiles) {
    const exceedsFileLimit = selectedPaths.size >= limits.maxFiles;
    const exceedsByteLimit =
      file.estimatedContentBytes > limits.maxTotalBytes - selectedBytes;

    if (exceedsFileLimit || exceedsByteLimit) {
      if (exceedsFileLimit) {
        reasons.add("file-count");
      }
      if (exceedsByteLimit) {
        reasons.add("total-bytes");
      }
      continue;
    }

    selectedPaths.add(file.absolutePath);
    selectedBytes += file.estimatedContentBytes;
  }

  const selectedFiles = files.filter((file) =>
    selectedPaths.has(file.absolutePath),
  );
  if (selectedFiles.length === files.length) {
    return { files: selectedFiles, truncation: undefined };
  }

  return {
    files: selectedFiles,
    truncation: {
      totalFileCount: files.length,
      includedFileCount: selectedFiles.length,
      omittedFileCount: files.length - selectedFiles.length,
      maxFiles: limits.maxFiles,
      maxTotalBytes: limits.maxTotalBytes,
      reasons: Array.from(reasons),
    },
  };
}

function formatTruncationMarker(truncation: CodebaseTruncation): string {
  return `<dyad-codebase-truncated included_files="${truncation.includedFileCount}" omitted_files="${truncation.omittedFileCount}" included_content_bytes="${truncation.includedContentBytes}" max_files="${truncation.maxFiles}" max_total_bytes="${truncation.maxTotalBytes}" reasons="${truncation.reasons.join(",")}" />\n`;
}

/**
 * Extract and format codebase files as a string to be included in prompts
 * @param appPath - Path to the codebase to extract
 * @param virtualFileSystem - Optional virtual filesystem to apply modifications
 * @returns Object containing formatted output and individual files
 */
export async function extractCodebase({
  appPath,
  chatContext,
  virtualFileSystem,
  limits: requestedLimits,
}: {
  appPath: string;
  chatContext: AppChatContext;
  virtualFileSystem?: AsyncVirtualFileSystem;
  limits?: Partial<CodebaseExtractionLimits>;
}): Promise<{
  formattedOutput: string;
  files: CodebaseFile[];
  truncation?: CodebaseTruncation;
}> {
  const limits = resolveExtractionLimits(requestedLimits);
  const startTime = Date.now();
  const preparedFiles = await prepareCodebaseFiles({
    appPath,
    chatContext,
    virtualFileSystem,
    limits,
  });

  if (!preparedFiles) {
    return {
      formattedOutput: `# Error: Directory ${appPath} does not exist or is not accessible`,
      files: [],
    };
  }

  const selection = selectFilesWithinLimits(preparedFiles, limits);
  const formattedResults = await mapWithConcurrency(
    selection.files,
    limits.ioConcurrency,
    async (file) => {
      const needsContent = shouldReadFileContentsForSmartContext({
        filePath: file.absolutePath,
        normalizedRelativePath: file.path,
      });
      let content = needsContent
        ? await readFileWithCache(file.absolutePath, virtualFileSystem)
        : undefined;
      if (
        content != null &&
        Buffer.byteLength(content, "utf8") > MAX_FILE_SIZE
      ) {
        logger.warn(
          `Skipping file that grew beyond the size limit: ${file.path}`,
        );
        content = undefined;
      }

      return {
        formattedContent: formatFile({
          filePath: file.absolutePath,
          normalizedRelativePath: file.path,
          content,
        }),
        contentBytes: content == null ? 0 : Buffer.byteLength(content, "utf8"),
        file: {
          path: file.path,
          content: needsContent
            ? (content ?? "// Error reading file")
            : OMITTED_FILE_CONTENT,
          force: file.force,
        } satisfies CodebaseFile,
      };
    },
  );

  const truncation = selection.truncation
    ? {
        ...selection.truncation,
        includedContentBytes: formattedResults.reduce(
          (total, result) => total + result.contentBytes,
          0,
        ),
      }
    : undefined;
  const filesArray = formattedResults.map((result) => result.file);
  let formattedOutput = formattedResults
    .map((result) => result.formattedContent)
    .join("");
  if (truncation) {
    formattedOutput += formatTruncationMarker(truncation);
    logger.warn("Codebase extraction truncated", truncation);
  }

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
    truncation,
  };
}

/**
 * Sort files by their modification timestamp (oldest first)
 */
async function sortFilesByModificationTime(
  files: string[],
  forcePathSort = false,
  ioConcurrency = DEFAULT_CODEBASE_EXTRACTION_LIMITS.ioConcurrency,
): Promise<Array<{ file: string; mtime: number; size: number }>> {
  // Get stats for all files
  const fileStats = await mapWithConcurrency(
    files,
    ioConcurrency,
    async (file) => {
      try {
        const stats = await fsAsync.stat(file);
        return { file, mtime: stats.mtimeMs, size: stats.size };
      } catch (error) {
        // If there's an error getting stats, use current time as fallback
        // This can happen with virtual files, so it's not a big deal.
        logger.warn(`Error getting file stats for ${file}:`, error);
        return { file, mtime: Date.now(), size: 0 };
      }
    },
  );

  if (IS_TEST_BUILD || forcePathSort) {
    // Why? For some reason, file ordering is not stable on Windows.
    // This is a workaround to ensure stable ordering, although
    // ideally we'd like to sort it by modification time which is
    // important for cache-ability.
    return fileStats.sort((a, b) => a.file.localeCompare(b.file));
  }
  // Sort by modification time (oldest first)
  return fileStats.sort(
    (a, b) => a.mtime - b.mtime || a.file.localeCompare(b.file),
  );
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
