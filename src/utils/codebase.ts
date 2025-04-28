import fs from "node:fs";
import path from "node:path";
import { isIgnored } from "isomorphic-git";

// File extensions to include in the extraction
const ALLOWED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".css", ".html"];

// Directories to always exclude
const EXCLUDED_DIRS = ["node_modules", ".git", "dist", "build"];

// Files to always include, regardless of extension
const ALWAYS_INCLUDE_FILES = ["package.json"];

// Maximum file size to include (in bytes) - 100KB
const MAX_FILE_SIZE = 100 * 1024;

/**
 * Check if a path should be ignored based on git ignore rules
 */
async function isGitIgnored(
  filePath: string,
  baseDir: string
): Promise<boolean> {
  try {
    const relativePath = path.relative(baseDir, filePath);
    return await isIgnored({ fs, dir: baseDir, filepath: relativePath });
  } catch (error) {
    console.error(`Error checking if path is git ignored: ${filePath}`, error);
    return false;
  }
}

/**
 * Recursively walk a directory and collect all relevant files
 */
async function collectFiles(dir: string, baseDir: string): Promise<string[]> {
  const files: string[] = [];

  // Check if directory exists
  if (!fs.existsSync(dir)) {
    return files;
  }

  try {
    // Read directory contents
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip excluded directories
      if (entry.isDirectory() && EXCLUDED_DIRS.includes(entry.name)) {
        continue;
      }

      // Skip if the entry is git ignored
      if (await isGitIgnored(fullPath, baseDir)) {
        continue;
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
          const stats = fs.statSync(fullPath);
          if (stats.size > MAX_FILE_SIZE) {
            continue;
          }
        } catch (error) {
          console.error(`Error checking file size: ${fullPath}`, error);
          continue;
        }

        if (ALLOWED_EXTENSIONS.includes(ext) || shouldAlwaysInclude) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }

  return files;
}

/**
 * Format a file for inclusion in the codebase extract
 */
function formatFile(filePath: string, baseDir: string): string {
  try {
    const relativePath = path.relative(baseDir, filePath);

    // Skip large configuration files or generated code (just include the path)
    if (
      relativePath.includes(path.join("src", "components", "ui")) ||
      relativePath.includes("eslint.config") ||
      relativePath.includes("tsconfig.json") ||
      relativePath.includes("package-lock.json") ||
      // These should already be excluded based on file type, but
      // just in case, we'll redact the contents here.
      relativePath.includes(".env")
    ) {
      return `<dyad-file path="${relativePath}">
// Contents omitted for brevity
</dyad-file>

`;
    }

    const content = fs.readFileSync(filePath, "utf-8");

    return `<dyad-file path="${relativePath}">
${content}
</dyad-file>

`;
  } catch (error) {
    console.error(`Error reading file: ${filePath}`, error);
    return `<dyad-file path="${path.relative(baseDir, filePath)}">
// Error reading file: ${error}
</dyad-file>

`;
  }
}

/**
 * Extract and format codebase files as a string to be included in prompts
 * @param appPath - Path to the codebase to extract
 * @returns A string containing formatted file contents
 */
export async function extractCodebase(appPath: string): Promise<string> {
  if (!fs.existsSync(appPath)) {
    return `# Error: Directory ${appPath} does not exist`;
  }

  // Collect all relevant files
  const files = await collectFiles(appPath, appPath);

  // Sort files to prioritize important files
  const sortedFiles = sortFilesByImportance(files, appPath);

  // Format files
  let output = "";

  for (const file of sortedFiles) {
    output += formatFile(file, appPath);
  }

  return output;
}

/**
 * Sort files by their importance for context
 */
function sortFilesByImportance(files: string[], baseDir: string): string[] {
  // Define patterns for important files
  const highPriorityPatterns = [
    new RegExp(`(^|/)${ALWAYS_INCLUDE_FILES[0]}$`),
    /tsconfig\.json$/,
    /README\.md$/,
    /index\.(ts|js)x?$/,
    /main\.(ts|js)x?$/,
    /app\.(ts|js)x?$/,
  ];

  // Custom sorting function
  return [...files].sort((a, b) => {
    const relativeA = path.relative(baseDir, a);
    const relativeB = path.relative(baseDir, b);

    // Check if file A matches any high priority pattern
    const aIsHighPriority = highPriorityPatterns.some((pattern) =>
      pattern.test(relativeA)
    );

    // Check if file B matches any high priority pattern
    const bIsHighPriority = highPriorityPatterns.some((pattern) =>
      pattern.test(relativeB)
    );

    // Sort by priority first
    if (aIsHighPriority && !bIsHighPriority) return -1;
    if (!aIsHighPriority && bIsHighPriority) return 1;

    // If both are same priority, sort alphabetically
    return relativeA.localeCompare(relativeB);
  });
}
