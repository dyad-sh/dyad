// Dependency-free so low-level modules (process_manager) can import it.

export function getAppNodeModulesVolumeName(appId: number): string {
  return `dyad-nm-${appId}`;
}

/** Pre-isolation Docker mode kept only the pnpm store in a volume. */
export function getLegacyAppPnpmStoreVolumeName(appId: number): string {
  return `dyad-pnpm-${appId}`;
}

export function getAppDevServerContainerName(appId: number): string {
  return `dyad-app-${appId}`;
}
