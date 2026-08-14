import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/ipc/types";
import type { StockImageOrientation } from "@/lib/stock_images/pixabay";

const AUTH_KEY = ["stock-images", "auth"] as const;

/** Whether a Pixabay key is saved. The key itself never comes back. */
export function useStockImageAuth() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: AUTH_KEY,
    queryFn: () => ipc.stockImages.authState(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: AUTH_KEY });

  const saveApiKey = useMutation({
    mutationFn: (apiKey: string) => ipc.stockImages.saveApiKey({ apiKey }),
    onSuccess: refresh,
  });

  const clearApiKey = useMutation({
    mutationFn: () => ipc.stockImages.clearApiKey(),
    onSuccess: refresh,
  });

  return {
    hasKey: data?.hasKey ?? false,
    isLoading,
    saveApiKey,
    clearApiKey,
  };
}

export type StockImageSearch = {
  query: string;
  page: number;
  orientation: StockImageOrientation;
};

/**
 * Results for a search.
 *
 * Disabled until there is both a key and something to search for, so opening
 * the page does not spend a request on an empty query.
 */
export function useStockImageSearch(
  search: StockImageSearch,
  { enabled }: { enabled: boolean },
) {
  const query = search.query.trim();

  return useQuery({
    queryKey: [
      "stock-images",
      "search",
      query,
      search.page,
      search.orientation,
    ],
    queryFn: () =>
      ipc.stockImages.search({
        query,
        page: search.page,
        orientation: search.orientation,
      }),
    enabled: enabled && query.length > 0,
    // Pixabay asks that results be cached rather than re-fetched, and paging
    // back and forth should not cost a request either way.
    staleTime: 24 * 60 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
