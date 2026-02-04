import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

interface UseAuthUsersParams {
  projectId: string | null;
  organizationSlug: string | null;
  page?: number;
  perPage?: number;
}

export function useAuthUsers({
  projectId,
  organizationSlug,
  page = 1,
  perPage = 25,
}: UseAuthUsersParams) {
  return useQuery({
    queryKey: queryKeys.supabase.authUsers({
      projectId: projectId ?? "",
      organizationSlug,
      page,
      perPage,
    }),
    queryFn: async () => {
      if (!projectId) {
        throw new Error("No project selected");
      }
      return ipc.supabase.listAuthUsers({
        projectId,
        organizationSlug,
        page,
        perPage,
      });
    },
    enabled: !!projectId,
  });
}
