import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useAppMediaFiles() {
  const query = useQuery({
    queryKey: queryKeys.media.all,
    queryFn: () => ipc.media.listAllMedia(),
  });

  return {
    mediaApps: query.data?.apps ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
