import type { ListedApp } from "@/ipc/types/app";

/**
 * Sort apps for the home showcase and /apps grid: favorites first, then by
 * most-recently updated (falling back to createdAt if updatedAt is missing).
 */
export function sortAppsForShowcase(apps: ListedApp[]): ListedApp[] {
  return [...apps].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) {
      return a.isFavorite ? -1 : 1;
    }
    const aTime = new Date(a.updatedAt ?? a.createdAt).getTime();
    const bTime = new Date(b.updatedAt ?? b.createdAt).getTime();
    return bTime - aTime;
  });
}
