import { IpcClient } from "@/ipc/ipc_client";
import type { AppFileSearchResult } from "@/ipc/ipc_types";
import { useQuery } from "@tanstack/react-query";
import { useRef, useEffect } from "react";

export function useSearchAppFiles(appId: number | null, query: string) {
  const trimmedQuery = query.trim();
  const enabled = Boolean(appId && trimmedQuery.length > 0);
  const lastDataAppIdRef = useRef<number | null>(null);

  const { data, isFetching, isLoading, error } = useQuery({
    queryKey: ["search-app-files", appId, trimmedQuery],
    enabled,
    queryFn: async (): Promise<AppFileSearchResult[]> => {
      if (!appId) {
        return [];
      }
      return IpcClient.getInstance().searchAppFiles(appId, trimmedQuery);
    },
    placeholderData: (previousData) => {
      // Only use previous data if it's from the same appId to prevent
      // stale results from a different app being used as placeholder
      if (previousData && appId === lastDataAppIdRef.current) {
        return previousData;
      }
      return undefined;
    },
    retry: 0,
  });

  // Track which appId the data belongs to when we receive it
  useEffect(() => {
    if (data && appId !== null) {
      lastDataAppIdRef.current = appId;
    }
  }, [data, appId]);

  // Reset the ref when appId changes to null to prevent stale data
  useEffect(() => {
    if (appId === null) {
      lastDataAppIdRef.current = null;
    }
  }, [appId]);

  return {
    results: data ?? [],
    loading: enabled ? isFetching || isLoading : false,
    error: enabled ? error : null,
  };
}
