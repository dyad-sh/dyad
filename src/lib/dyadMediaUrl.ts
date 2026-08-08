/**
 * Builds a dyad-media:// protocol URL for serving media files in Electron.
 */
export function buildDyadMediaUrl(appPath: string, fileName: string): string {
  return `dyad-media://media/${encodeURIComponent(appPath)}/.dyad/media/${encodeURIComponent(fileName)}`;
}
