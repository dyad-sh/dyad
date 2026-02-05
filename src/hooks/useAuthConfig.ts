import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { ipc } from "@/ipc/types";
import type { AuthConfig } from "@/ipc/types/supabase";

interface UseAuthConfigParams {
  projectId: string | null;
  organizationSlug: string | null;
}

export function useAuthConfig({
  projectId,
  organizationSlug,
}: UseAuthConfigParams) {
  return useQuery<AuthConfig, Error>({
    queryKey: queryKeys.supabase.authConfig({
      projectId: projectId ?? "",
      organizationSlug,
    }),
    queryFn: () =>
      ipc.supabase.getAuthConfig({
        projectId: projectId!,
        organizationSlug,
      }),
    enabled: !!projectId,
  });
}
