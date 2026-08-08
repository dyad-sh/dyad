import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Fetches thumbnails for the given app ids and exposes them as a
 * `Map<appId, thumbnailUrl>`. Pass the full, stable set of app ids (not a
 * filtered subset) so the underlying IPC call can be cached across searches
 * and shared between consumers.
 */
export function useAppThumbnails(appIds: number[]): Map<number, string | null> {
  const sortedIds = useMemo(() => [...appIds].sort((a, b) => a - b), [appIds]);

  const { data } = useQuery({
    queryKey: [...queryKeys.apps.thumbnails, sortedIds],
    queryFn: () => ipc.app.listAppThumbnails({ appIds: sortedIds }),
    enabled: sortedIds.length > 0,
  });

  return useMemo(() => {
    const map = new Map<number, string | null>();
    for (const t of data?.thumbnails ?? []) {
      map.set(t.appId, t.thumbnailUrl);
    }
    return map;
  }, [data]);
}
