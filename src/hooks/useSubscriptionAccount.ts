import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useSubscriptionAccount() {
  return useQuery({
    queryKey: queryKeys.settings.codexSubscription,
    queryFn: () => ipc.settings.getCodexSubscriptionStatus(),
    staleTime: 10_000,
    refetchInterval: (query) => (query.state.data?.pending ? 1500 : 30_000),
    retry: false,
  });
}
