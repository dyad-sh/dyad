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

// Shared, per-app keys so every `useVersions` instance for the *same app* can
// observe whether a version-modifying operation is in flight (via
// `useIsMutating`), not just its own. The keys include `appId` so a
// restore/revert running against one app does not disable version actions
// (message restore arrows, undo/retry) in an unrelated app. Both operations are
// serialized by `withLock(appId)` on the backend, but we also want to prevent
// the UI from kicking off a second one against state left by the first.
const restoreToMessageMutationKey = (appId: number | null) =>
  ["restoreToMessageVersion", appId] as const;
const revertVersionMutationKey = (appId: number | null) =>
  ["revertVersion", appId] as const;

export function useVersions(appId: number | null) {
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const queryClient = useQueryClient();
  const { restartApp } = useRunApp();
  const { settings } = useSettings();

  const updateVersionMetadataCache = (
    oid: string,
    updates: Partial<Pick<Version, "isFavorite" | "note">>,
    targetAppId = appId,
  ) => {
    queryClient.setQueryData<Version[]>(
      queryKeys.versions.list({ appId: targetAppId }),
      (oldVersions) =>
        oldVersions?.map((version) =>
          version.oid === oid ? { ...version, ...updates } : version,
        ),
    );
  };

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
      targetBranchName?: string;
    }
  >({
    mutationKey: revertVersionMutationKey(appId),
    mutationFn: async ({
      versionId,
      currentChatMessageId,
      targetBranchName,
    }: {
      versionId: string;
      currentChatMessageId?: { chatId: number; messageId: number };
      targetBranchName?: string;
    }) => {
      const currentAppId = appId;
      if (currentAppId === null) {
        throw new DyadError("App ID is null", DyadErrorKind.External);
      }
      return ipc.version.revertVersion({
        appId: currentAppId,
        previousVersionId: versionId,
        currentChatMessageId,
        targetBranchName,
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

  const setVersionFavoriteMutation = useMutation<
    { oid: string; isFavorite: boolean; note: string | null },
    Error,
    { appId?: number | null; versionId: string; isFavorite: boolean }
  >({
    mutationFn: async ({ appId: mutationAppId, versionId, isFavorite }) => {
      const targetAppId = mutationAppId === undefined ? appId : mutationAppId;
      if (targetAppId === null) {
        throw new DyadError("App ID is null", DyadErrorKind.External);
      }
      return ipc.version.setVersionFavorite({
        appId: targetAppId,
        versionId,
        isFavorite,
      });
    },
    onSuccess: (result, variables) => {
      updateVersionMetadataCache(
        result.oid,
        { isFavorite: result.isFavorite },
        variables.appId === undefined ? appId : variables.appId,
      );
    },
    meta: { showErrorToast: true },
  });

  const setVersionNoteMutation = useMutation<
    { oid: string; isFavorite: boolean; note: string | null },
    Error,
    { appId?: number | null; versionId: string; note: string | null }
  >({
    mutationFn: async ({ appId: mutationAppId, versionId, note }) => {
      const targetAppId = mutationAppId === undefined ? appId : mutationAppId;
      if (targetAppId === null) {
        throw new DyadError("App ID is null", DyadErrorKind.External);
      }
      return ipc.version.setVersionNote({
        appId: targetAppId,
        versionId,
        note,
      });
    },
    onSuccess: (result, variables) => {
      updateVersionMetadataCache(
        result.oid,
        { note: result.note },
        variables.appId === undefined ? appId : variables.appId,
      );
    },
    meta: { showErrorToast: true },
  });

  const restoreToMessageMutation = useMutation<
    RestoreToMessageResponse,
    Error,
    { chatId: number; messageId: number; restoreCodebase: boolean },
    { mutationAppId: number | null }
  >({
    mutationKey: restoreToMessageMutationKey(appId),
    // Capture the app the mutation targets so `onSuccess` invalidates *that*
    // app's caches. If the user switches apps while the IPC call is in flight,
    // the hook's `appId` closure would point at the newly selected app, leaving
    // the restored app's version/branch/problem caches stale.
    onMutate: () => ({ mutationAppId: appId }),
    mutationFn: async ({ chatId, messageId, restoreCodebase }) => {
      const currentAppId = appId;
      if (currentAppId === null) {
        throw new DyadError("App ID is null", DyadErrorKind.External);
      }
      return ipc.version.restoreToMessageVersion({
        appId: currentAppId,
        chatId,
        messageId,
        restoreCodebase,
      });
    },
    onSuccess: async (result, variables, context) => {
      // Invalidate the app the mutation ran against (see `onMutate`), falling
      // back to the current closure `appId` if no context was captured.
      const restoredAppId = context?.mutationAppId ?? appId;
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
      // These invalidations are independent, so run them concurrently. Since
      // `mutateAsync` only resolves after `onSuccess` completes, awaiting them
      // sequentially would delay navigation to the forked chat (the caller
      // navigates once `mutateAsync` resolves), leaving the user on a spinner.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.versions.list({ appId: restoredAppId }),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.branches.current({ appId: restoredAppId }),
        }),
        // restoreToMessageVersion creates a brand new chat, so refresh the chat
        // list (like every other chat-creation path) or the sidebar won't show
        // it.
        queryClient.invalidateQueries({
          queryKey: queryKeys.chats.all,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.problems.byApp({ appId: restoredAppId }),
        }),
      ]);
      const didRestoreCode = variables.restoreCodebase && "newChatId" in result;
      if (didRestoreCode && settings?.runtimeMode2 === "cloud") {
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
  // revert-version) is pending for THIS app across every `useVersions` instance
  // bound to it. The per-instance `isPending` flags above are local to the
  // component that triggered them, so we use `useIsMutating` on the shared
  // per-app keys to disable all version-modifying buttons (message restore
  // arrows and the version-pane revert button) while one is running, preventing
  // a confusing second operation from running against the state left by the
  // first. Scoping the keys by `appId` keeps a background mutation in another
  // app from disabling these actions here.
  // Both `useIsMutating` calls must run on every render — combining them with
  // `||` directly would short-circuit and skip the second hook whenever the
  // first is truthy, violating the rules of hooks ("Should have a queue").
  const restoreToMessagePending = useIsMutating({
    mutationKey: restoreToMessageMutationKey(appId),
  });
  const revertVersionPending = useIsMutating({
    mutationKey: revertVersionMutationKey(appId),
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
    setVersionFavorite: setVersionFavoriteMutation.mutateAsync,
    isSettingVersionFavorite: setVersionFavoriteMutation.isPending,
    setVersionNote: setVersionNoteMutation.mutateAsync,
    isSettingVersionNote: setVersionNoteMutation.isPending,
    restoreToMessage: restoreToMessageMutation.mutateAsync,
    isRestoringToMessage: restoreToMessageMutation.isPending,
    isAnyVersionMutationPending,
  };
}
