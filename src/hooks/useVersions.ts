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

// Shared keys so every `useVersions` instance can observe whether *any*
// version-modifying operation is in flight (via `useIsMutating`), not just its
// own. Both operations are serialized by `withLock(appId)` on the backend, but
// we also want to prevent the UI from kicking off a second one against state
// left by the first.
const restoreToMessageMutationKey = ["restoreToMessageVersion"] as const;
const revertVersionMutationKey = ["revertVersion"] as const;

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
    mutationKey: revertVersionMutationKey,
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
        // When `newChatId` is present the codebase *was* reverted and only a
        // secondary step (e.g. the Neon DB restore) failed. Make the partial
        // success explicit so the user isn't left thinking nothing happened.
        if ("newChatId" in result) {
          toast.warning(`Code restored, but: ${result.warningMessage}`);
        } else {
          toast.warning(result.warningMessage);
        }
      } else {
        toast.success(result.successMessage);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.versions.list({ appId }),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.branches.current({ appId }),
      });
      // restoreToMessageVersion creates a brand new chat, so refresh the chat
      // list (like every other chat-creation path) or the sidebar won't show it.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.chats.all,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.problems.byApp({ appId }),
      });
      if (settings?.runtimeMode2 === "cloud") {
        await restartApp();
      }
    },
    // No `meta.showErrorToast` here: `handleRestoreToMessage` in
    // `ChatMessage.tsx` already wraps this `mutateAsync` (and the preceding
    // `cancelStream` call) in a try/catch that surfaces the error via
    // `showError`. Enabling the global toast too would show the same error
    // twice.
  });

  // True when *any* version-modifying operation (restore-to-message or
  // revert-version) is pending across every `useVersions` instance. The
  // per-instance `isPending` flags above are local to the component that
  // triggered them, so we use `useIsMutating` on the shared keys to disable all
  // version-modifying buttons (message restore arrows and the version-pane
  // revert button) while one is running, preventing a confusing second
  // operation from running against the state left by the first.
  // Both `useIsMutating` calls must run on every render — combining them with
  // `||` directly would short-circuit and skip the second hook whenever the
  // first is truthy, violating the rules of hooks ("Should have a queue").
  const restoreToMessagePending = useIsMutating({
    mutationKey: restoreToMessageMutationKey,
  });
  const revertVersionPending = useIsMutating({
    mutationKey: revertVersionMutationKey,
  });
  const isAnyVersionMutationPending =
    restoreToMessagePending > 0 || revertVersionPending > 0;

  return {
    versions: versions || [],
    loading,
    error,
    refreshVersions,
    revertVersion: revertVersionMutation.mutateAsync,
    isRevertingVersion: revertVersionMutation.isPending,
    restoreToMessage: restoreToMessageMutation.mutateAsync,
    isRestoringToMessage: restoreToMessageMutation.isPending,
    isAnyVersionMutationPending,
  };
}
