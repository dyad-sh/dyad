import { useAtomValue, useSetAtom } from "jotai";
import {
  ipc,
  type RestoreToMessageResponse,
  type RevertVersionResponse,
  type Version,
} from "@/ipc/types";

import { chatMessagesByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import {
  useQuery,
  useMutation,
  useQueryClient,
  useIsMutating,
} from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "sonner";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { useRunApp } from "./useRunApp";
import { useSettings } from "./useSettings";

// Shared key so every per-message `useVersions` instance can observe whether
// *any* restore-to-message is in flight (via `useIsMutating`), not just its own.
const restoreToMessageMutationKey = ["restoreToMessageVersion"] as const;

export function useVersions(appId: number | null) {
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const queryClient = useQueryClient();
  const { restartApp } = useRunApp();
  const { settings } = useSettings();

  const {
    data: versions,
    isLoading: loading,
    error,
    refetch: refreshVersions,
  } = useQuery<Version[], Error>({
    queryKey: queryKeys.versions.list({ appId }),
    queryFn: async (): Promise<Version[]> => {
      if (appId === null) {
        return [];
      }
      return ipc.version.listVersions({ appId });
    },
    enabled: appId !== null,
    placeholderData: [],
    meta: { showErrorToast: true },
  });

  const revertVersionMutation = useMutation<
    RevertVersionResponse,
    Error,
    {
      versionId: string;
      currentChatMessageId?: { chatId: number; messageId: number };
    }
  >({
    mutationFn: async ({
      versionId,
      currentChatMessageId,
    }: {
      versionId: string;
      currentChatMessageId?: { chatId: number; messageId: number };
    }) => {
      const currentAppId = appId;
      if (currentAppId === null) {
        throw new DyadError("App ID is null", DyadErrorKind.External);
      }
      return ipc.version.revertVersion({
        appId: currentAppId,
        previousVersionId: versionId,
        currentChatMessageId,
      });
    },
    onSuccess: async (result) => {
      if ("successMessage" in result) {
        toast.success(result.successMessage);
      } else if ("warningMessage" in result) {
        toast.warning(result.warningMessage);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.versions.list({ appId }),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.branches.current({ appId }),
      });
      if (selectedChatId) {
        const chat = await ipc.chat.getChat(selectedChatId);
        setMessagesById((prev) => {
          const next = new Map(prev);
          next.set(selectedChatId, chat.messages);
          return next;
        });
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.problems.byApp({ appId }),
      });
      if (settings?.runtimeMode2 === "cloud") {
        await restartApp();
      }
    },
    meta: { showErrorToast: true },
  });

  const restoreToMessageMutation = useMutation<
    RestoreToMessageResponse,
    Error,
    { chatId: number; messageId: number }
  >({
    mutationKey: restoreToMessageMutationKey,
    mutationFn: async ({ chatId, messageId }) => {
      const currentAppId = appId;
      if (currentAppId === null) {
        throw new DyadError("App ID is null", DyadErrorKind.External);
      }
      return ipc.version.restoreToMessageVersion({
        appId: currentAppId,
        chatId,
        messageId,
      });
    },
    onSuccess: async (result) => {
      if ("warningMessage" in result) {
        toast.warning(result.warningMessage);
      } else {
        toast.success(result.successMessage);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.versions.list({ appId }),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.branches.current({ appId }),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.problems.byApp({ appId }),
      });
      if (settings?.runtimeMode2 === "cloud") {
        await restartApp();
      }
    },
    meta: { showErrorToast: true },
  });

  // True when *any* restore-to-message is pending across all messages. Used to
  // disable every restore button while one restore is running, since the
  // per-instance `isPending` above is local to the message that was clicked.
  const isAnyRestoreToMessagePending =
    useIsMutating({ mutationKey: restoreToMessageMutationKey }) > 0;

  return {
    versions: versions || [],
    loading,
    error,
    refreshVersions,
    revertVersion: revertVersionMutation.mutateAsync,
    isRevertingVersion: revertVersionMutation.isPending,
    restoreToMessage: restoreToMessageMutation.mutateAsync,
    isRestoringToMessage: restoreToMessageMutation.isPending,
    isAnyRestoreToMessagePending,
  };
}
