import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useGithubCollaborators(appId: number) {
  return useQuery({
    queryKey: queryKeys.github.collaborators({ appId }),
    queryFn: () => ipc.github.listCollaborators({ appId }),
    meta: { showErrorToast: true },
  });
}
