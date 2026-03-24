/**
 * Builds a proteaai-media:// protocol URL for serving media files in Electron.
 */
export function buildProteaAIMediaUrl(appPath: string, fileName: string): string {
  return `proteaai-media://media/${encodeURIComponent(appPath)}/.proteaai/media/${encodeURIComponent(fileName)}`;
}
