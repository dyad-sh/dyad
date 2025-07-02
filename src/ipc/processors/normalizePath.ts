/**
 * Normalize the path to use forward slashes instead of backslashes.
 * This is important to prevent weird Git issues, particularly on Windows.
 * @param path Source path.
 * @returns Normalized path.
 */

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}
