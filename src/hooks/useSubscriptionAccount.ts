import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useEffect } from "react";

export function useSubscriptionAccount(usageMenuOpen = false) {
  const query = useQuery({
    queryKey: queryKeys.settings.codexSubscription,
    queryFn: () => ipc.settings.getCodexSubscriptionStatus(),
    staleTime: 30 * 60_000,
    refetchInterval: (query) =>
      query.state.data?.pending ? 1500 : usageMenuOpen ? 30_000 : 30 * 60_000,
    retry: false,
  });
  const { refetch } = query;
  useEffect(() => {
    if (usageMenuOpen) void refetch();
  }, [usageMenuOpen, refetch]);
  return query;
}
