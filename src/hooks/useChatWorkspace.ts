import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/** Where a chat's turns run and how its isolated work is being merged. */
export function useChatWorkspaceStatus(
  appId: number | null,
  chatId: number | undefined,
) {
  return useQuery({
    queryKey: queryKeys.workspaces.chat({ appId, chatId: chatId ?? null }),
    queryFn: () => ipc.workspace.getChatWorkspaceStatus({ chatId: chatId! }),
    enabled: appId !== null && chatId !== undefined,
    // A local lookup that fails (for example for a deleted chat) fails the
    // same way again; callers fall back to the app's own folder instead.
    retry: false,
  });
}

/** Running writable chats and isolated workspaces for an app. */
export function useAppWorkspaceOverview(appId: number | null) {
  return useQuery({
    queryKey: queryKeys.workspaces.overview({ appId }),
    queryFn: () => ipc.workspace.getAppWorkspaceOverview({ appId: appId! }),
    enabled: appId !== null,
  });
}

export function useRetryWorkspaceIntegration(appId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chatId: number) => ipc.workspace.retryIntegration({ chatId }),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.workspaces.byApp({ appId }),
      }),
  });
}
