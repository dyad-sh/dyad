/**
 * Builds a URL for serving a media file.
 *
 * - Electron renderer/main: returns a proteaai-media:// protocol URL.
 * - Web mode (browser or Express server): returns an HTTP /media/ path.
 *
 * Detection strategy:
 *   - Browser web build: import.meta.env.PROTEAAI_WEB_MODE injected by Vite.
 *   - Node.js server: absence of process.versions.electron.
 */
export function buildProteaAIMediaUrl(appPath: string, fileName: string): string {
  const isWeb =
    // Vite injects this for the browser web build
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: { PROTEAAI_WEB_MODE?: string } }).env
        ?.PROTEAAI_WEB_MODE === "true") ||
    // Node.js server running outside Electron
    (typeof process !== "undefined" && !process.versions?.electron);

  if (isWeb) {
    return `/media/${encodeURIComponent(appPath)}/${encodeURIComponent(fileName)}`;
  }
  return `proteaai-media://media/${encodeURIComponent(appPath)}/.proteaai/media/${encodeURIComponent(fileName)}`;
}
