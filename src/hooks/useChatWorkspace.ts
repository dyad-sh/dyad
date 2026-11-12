import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc, type ChatWorkspaceStatus } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Where a chat's turns run and how its isolated work is being merged.
 *
 * `data` is undefined once the lookup succeeds for a chat of another app: the
 * lookup is by chat id only, and during navigation the selected chat can
 * still belong to the previously selected app for a moment.
 */
export function useChatWorkspaceStatus(
  appId: number | null,
  chatId: number | undefined,
) {
  const selectForApp = useCallback(
    (status: ChatWorkspaceStatus) =>
      status.appId === appId ? status : undefined,
    [appId],
  );
  return useQuery({
    queryKey: queryKeys.workspaces.chat({ appId, chatId: chatId ?? null }),
    queryFn: () => ipc.workspace.getChatWorkspaceStatus({ chatId: chatId! }),
    enabled: appId !== null && chatId !== undefined,
    select: selectForApp,
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

/** Deletes a chat's worktree; the chat's next writable turn gets a new one. */
export function useDeleteChatWorkspace(appId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chatId: number) =>
      ipc.workspace.deleteChatWorkspace({ chatId }),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.workspaces.byApp({ appId }),
      }),
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
