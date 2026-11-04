import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

// Keyed by the linked repo as well as the app, so re-linking an app to another
// repo never shows the previous repo's collaborators.
export function useGithubCollaborators(params: {
  appId: number;
  owner: string;
  repo: string;
}) {
  return useQuery({
    queryKey: queryKeys.github.collaborators(params),
    queryFn: () => ipc.github.listCollaborators({ appId: params.appId }),
    // Refetch on every mount so access changes on GitHub show up promptly,
    // but not on window focus, which would repeat the error toast for a
    // failure that persists.
    staleTime: 0,
    refetchOnWindowFocus: false,
    meta: { showErrorToast: true },
  });
}
