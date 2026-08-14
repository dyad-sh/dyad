import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useSettings } from "@/hooks/useSettings";
import { showError, showSuccess } from "@/lib/toast";

export function useVercelAccount() {
  const queryClient = useQueryClient();
  const { settings, updateSettings } = useSettings();
  const isConnected = !!settings?.vercelAccessToken;

  const projectsQuery = useQuery({
    queryKey: queryKeys.vercel.projects,
    queryFn: () => ipc.vercel.listProjects(),
    enabled: isConnected,
    meta: { showErrorToast: true },
  });

  const connectMutation = useMutation({
    mutationFn: (token: string) => ipc.vercel.saveToken({ token }),
    onSuccess: async () => {
      // Settings first: the connected flag is read from there, and the main
      // process wrote the token, so the renderer's cached copy is stale until
      // this runs. Without it the toast says connected and nothing changes.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.settings.all,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.vercel.all });
      showSuccess("Connected to Vercel");
    },
    onError: (error) => showError(error),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const ok = await updateSettings({ vercelAccessToken: undefined });
      if (!ok) throw new Error("Failed to disconnect Vercel");
    },
    onSuccess: async () => {
      // Settings first: the connected flag is read from there, and the main
      // process wrote the token, so the renderer's cached copy is stale until
      // this runs. Without it the toast says connected and nothing changes.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.settings.all,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.vercel.all });
      showSuccess("Disconnected from Vercel");
    },
    onError: (error) => showError(error),
  });

  return {
    isConnected,
    projects: projectsQuery.data ?? [],
    isLoadingProjects: projectsQuery.isLoading,
    refetchProjects: projectsQuery.refetch,
    connect: connectMutation.mutateAsync,
    isConnecting: connectMutation.isPending,
    disconnect: disconnectMutation.mutateAsync,
    isDisconnecting: disconnectMutation.isPending,
  };
}
