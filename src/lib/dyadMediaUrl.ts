/**
 * Builds a dyad-media:// protocol URL for serving media files in Electron.
 */
export function buildDyadMediaUrl(appPath: string, fileName: string): string {
  return `dyad-media://media/${encodeURIComponent(appPath)}/.dyad/media/${encodeURIComponent(fileName)}`;
}

/**
 * Builds a dyad-media:// URL from a project-relative path (e.g. an image path
 * stored in a design spec like ".dyad/media/generated-123.png"). Returns "" if
 * the path is empty or contains a directory traversal segment.
 */
export function buildDyadMediaUrlFromRelativePath(
  appPath: string,
  relativePath: string,
): string {
  const normalized = relativePath.split("\\").join("/");
  const hasTraversal = normalized.split("/").some((seg) => seg === "..");
  if (!appPath || !normalized || hasTraversal) {
    return "";
  }
  return `dyad-media://media/${encodeURIComponent(appPath)}/${normalized
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}
