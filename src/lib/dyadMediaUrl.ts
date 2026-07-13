/**
 * Builds a dyad-media:// protocol URL for serving media files in Electron.
 */
export function buildDyadMediaUrl(appPath: string, fileName: string): string {
  return `dyad-media://media/${encodeURIComponent(appPath)}/.dyad/media/${encodeURIComponent(fileName)}`;
}

/**
 * Builds a versioned URL for a bounded media-library thumbnail derivative.
 * The source version lets Chromium cache the derivative without showing stale
 * content after an image is replaced in place.
 */
export function buildDyadMediaThumbnailUrl(
  appPath: string,
  fileName: string,
  modifiedAtMs: number,
  sizeBytes: number,
): string {
  const url = new URL(buildDyadMediaUrl(appPath, fileName));
  url.searchParams.set("thumbnail", "1");
  url.searchParams.set("v", `${modifiedAtMs}:${sizeBytes}`);
  return url.toString();
}
