const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function getAppPreviewHostname(appId: number): string {
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    throw new Error(`Invalid app id for preview hostname: ${appId}`);
  }
  return `app-${appId}.localhost`;
}

/**
 * Give a loopback preview a stable host boundary without changing its port,
 * path, or protocol. Non-loopback URLs (cloud and sandbox previews) pass
 * through unchanged.
 */
export function toAppPreviewUrl(appId: number, runtimeUrl: string): string {
  const url = new URL(runtimeUrl);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    return runtimeUrl;
  }
  url.hostname = getAppPreviewHostname(appId);
  return url.toString();
}

export function isAppPreviewHostname(appId: number, hostname: string): boolean {
  return hostname === getAppPreviewHostname(appId);
}
