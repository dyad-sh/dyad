import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

interface UseSecretsParams {
  projectId: string | null;
  organizationSlug: string | null;
}

export function useSecrets({ projectId, organizationSlug }: UseSecretsParams) {
  return useQuery({
    queryKey: queryKeys.supabase.secrets({
      projectId: projectId ?? "",
      organizationSlug,
    }),
    queryFn: async () => {
      if (!projectId) {
        throw new Error("No project selected");
      }
      return ipc.supabase.listSecrets({
        projectId,
        organizationSlug,
      });
    },
    enabled: !!projectId,
  });
}

export function useCreateSecret({
  projectId,
  organizationSlug,
}: UseSecretsParams) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name, value }: { name: string; value: string }) => {
      if (!projectId) {
        throw new Error("No project selected");
      }
      return ipc.supabase.createSecret({
        projectId,
        organizationSlug,
        name,
        value,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.supabase.secrets({
          projectId: projectId ?? "",
          organizationSlug,
        }),
      });
    },
  });
}

export function useDeleteSecret({
  projectId,
  organizationSlug,
}: UseSecretsParams) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      if (!projectId) {
        throw new Error("No project selected");
      }
      return ipc.supabase.deleteSecrets({
        projectId,
        organizationSlug,
        names: [name],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.supabase.secrets({
          projectId: projectId ?? "",
          organizationSlug,
        }),
      });
    },
  });
}
