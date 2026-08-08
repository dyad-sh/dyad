import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useSettings } from "@/hooks/useSettings";
import { showError, showSuccess } from "@/lib/toast";

export function useGithubAccount() {
  const queryClient = useQueryClient();
  const { settings, updateSettings } = useSettings();
  const hasToken = !!settings?.githubAccessToken;

  const accountQuery = useQuery({
    queryKey: queryKeys.github.account,
    queryFn: () => ipc.github.getAccount(),
    enabled: hasToken,
    meta: { showErrorToast: false },
  });

  const setTokenMutation = useMutation({
    mutationFn: (token: string) => ipc.github.setAccessToken({ token }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.github.all });
      showSuccess("Connected to GitHub");
    },
    onError: (error) => showError(error),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const ok = await updateSettings({
        githubAccessToken: undefined,
        githubUser: undefined,
      });
      if (!ok) throw new Error("Failed to disconnect GitHub");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.github.all });
      showSuccess("Disconnected from GitHub");
    },
    onError: (error) => showError(error),
  });

  return {
    isConnected: hasToken,
    account: accountQuery.data,
    isLoadingAccount: accountQuery.isLoading,
    setAccessToken: setTokenMutation.mutateAsync,
    isConnecting: setTokenMutation.isPending,
    disconnect: disconnectMutation.mutateAsync,
    isDisconnecting: disconnectMutation.isPending,
  };
}
