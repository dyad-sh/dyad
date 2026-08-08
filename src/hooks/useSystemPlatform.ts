import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useSystemPlatform() {
  const { data } = useQuery({
    queryKey: queryKeys.system.platform,
    queryFn: () => ipc.system.getSystemPlatform(),
    staleTime: Infinity, // Platform never changes during a session
  });

  return data ?? null;
}
