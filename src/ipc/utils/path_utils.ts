import path from "node:path";

/**
 * Safely joins paths while ensuring the result stays within the base directory.
 * This prevents directory traversal attacks where malicious paths like "../../etc/passwd"
 * could be used to access files outside the intended directory.
 *
 * @param basePath The base directory that should contain the result
 * @param ...paths Path segments to join with the base path
 * @returns The joined path if it's within the base directory
 * @throws Error if the resulting path would be outside the base directory
 */
export function safeJoin(basePath: string, ...paths: string[]): string {
  // Check if any of the path segments are absolute paths (which would be unsafe)
  for (const pathSegment of paths) {
    if (path.isAbsolute(pathSegment)) {
      throw new Error(
        `Unsafe path: joining "${paths.join(", ")}" with base "${basePath}" would escape the base directory`,
      );
    }
    // Also check for home directory shortcuts which are effectively absolute
    if (pathSegment.startsWith("~/")) {
      throw new Error(
        `Unsafe path: joining "${paths.join(", ")}" with base "${basePath}" would escape the base directory`,
      );
    }
    // Check for Windows-style absolute paths (C:\, D:\, etc.)
    if (/^[A-Za-z]:[/\\]/.test(pathSegment)) {
      throw new Error(
        `Unsafe path: joining "${paths.join(", ")}" with base "${basePath}" would escape the base directory`,
      );
    }
    // Check for UNC paths (\\server\share)
    if (pathSegment.startsWith("\\\\")) {
      throw new Error(
        `Unsafe path: joining "${paths.join(", ")}" with base "${basePath}" would escape the base directory`,
      );
    }
  }

  // Join all the paths
  const joinedPath = path.join(basePath, ...paths);

  // Resolve both paths to absolute paths to handle any ".." components
  const resolvedBasePath = path.resolve(basePath);
  const resolvedJoinedPath = path.resolve(joinedPath);

  // Check if the resolved joined path starts with the base path
  // Use path.relative to ensure we're doing a proper path comparison
  const relativePath = path.relative(resolvedBasePath, resolvedJoinedPath);

  // If relativePath starts with ".." or is absolute, then resolvedJoinedPath is outside basePath
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `Unsafe path: joining "${paths.join(", ")}" with base "${basePath}" would escape the base directory`,
    );
  }

  return joinedPath;
}
