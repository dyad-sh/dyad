import type { QueryClient } from "@tanstack/react-query";
import type { createStore } from "jotai";
import { toast } from "sonner";
import { ipc, type VersionCommandResult } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import { activeCheckoutCounterAtom } from "@/store/appAtoms";
import { chatMessagesByIdAtom } from "@/atoms/chatAtoms";
import type { VersionPreviewRuntime } from "./controller";

type JotaiStore = ReturnType<typeof createStore>;

const NO_BRANCH = "<no-branch>";
const recoveryToastId = (appId: number) => `version-preview-recovery-${appId}`;

export interface VersionPreviewAdapterDeps {
  queryClient: QueryClient;
  store: JotaiStore;
  restartApp: (appId: number) => Promise<void>;
  navigateToChat?: (input: { appId: number; chatId: number }) => void;
}

export function createVersionPreviewRuntime({
  queryClient,
  store,
  restartApp,
  navigateToChat,
}: VersionPreviewAdapterDeps): VersionPreviewRuntime {
  async function runCheckout(
    input:
      | { purpose: "preview"; appId: number; versionId: string }
      | { purpose: "return"; appId: number; branch: string },
  ) {
    store.set(activeCheckoutCounterAtom, (count) => count + 1);
    try {
      return await ipc.version.checkoutVersion(input);
    } finally {
      store.set(activeCheckoutCounterAtom, (count) => count - 1);
    }
  }

  async function invalidateGitQueries(appId: number) {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.branches.current({ appId }),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.versions.list({ appId }),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.apps.detail({ appId }),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.problems.byApp({ appId }),
      }),
    ]);
  }

  async function applyVersionCommandResult(
    appId: number,
    result: VersionCommandResult,
  ): Promise<void> {
    if (result.notification?.kind === "success") {
      toast.success(result.notification.message);
    } else if (result.notification?.kind === "warning") {
      toast.warning(result.notification.message, { duration: 8000 });
    }

    const effects: Promise<unknown>[] = [invalidateGitQueries(appId)];

    if (result.affectedChatId !== null) {
      effects.push(
        ipc.chat.getChat(result.affectedChatId).then((chat) => {
          store.set(chatMessagesByIdAtom, (previous) => {
            const next = new Map(previous);
            next.set(result.affectedChatId!, chat.messages);
            return next;
          });
        }),
      );
    }

    if (result.createdChatId !== null) {
      navigateToChat?.({ appId, chatId: result.createdChatId });
      effects.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.chats.all }),
      );
    }

    if (result.runtimeAction === "restart") {
      effects.push(restartApp(appId));
    }

    const outcomes = await Promise.allSettled(effects);
    const failure = outcomes.find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected",
    );
    if (failure) {
      throw failure.reason;
    }
  }

  async function mutate(
    appId: number,
    label: string,
    operation: () => Promise<VersionCommandResult>,
  ): Promise<VersionCommandResult> {
    let result: VersionCommandResult;
    try {
      result = await operation();
    } catch (error) {
      showError(error);
      throw error;
    }
    try {
      await applyVersionCommandResult(appId, result);
    } catch (error) {
      console.error(`version_preview: ${label} post-effects failed`, error);
      toast.warning(
        "The version operation completed, but Dyad could not refresh every related view.",
      );
    }
    return result;
  }

  async function mutateAndDiscard(
    appId: number,
    label: string,
    operation: () => Promise<VersionCommandResult>,
  ): Promise<void> {
    await mutate(appId, label, operation);
  }

  return {
    notifyError: (message) => showError(message),
    notifyRecovery: ({ appId, error, retry }) => {
      toast.error(
        "Unable to return to the branch that was active before previewing this version.",
        {
          id: recoveryToastId(appId),
          description: error.message,
          duration: Infinity,
          action: { label: "Retry", onClick: retry },
        },
      );
    },
    dismissRecovery: (appId) => toast.dismiss(recoveryToastId(appId)),
    commands: {
      async resolveOriginBranch({ appId }) {
        const result = await queryClient.fetchQuery({
          queryKey: queryKeys.branches.current({ appId }),
          queryFn: () => ipc.version.getCurrentBranch({ appId }),
          staleTime: 0,
        });
        const branch = result?.branch;
        return { branch: branch && branch !== NO_BRANCH ? branch : null };
      },

      checkoutVersion: ({ appId, versionId }) =>
        mutateAndDiscard(appId, "checkout", () =>
          runCheckout({ purpose: "preview", appId, versionId }),
        ),

      returnToBranch: ({ appId, branch }) =>
        mutateAndDiscard(appId, "return", () =>
          runCheckout({ purpose: "return", appId, branch }),
        ),

      switchBranch: ({ appId, branch }) =>
        mutateAndDiscard(appId, "switch-branch", () =>
          runCheckout({ purpose: "return", appId, branch }),
        ),

      restoreVersion: ({
        appId,
        versionId,
        targetBranch,
        currentChatMessageId,
      }) =>
        mutateAndDiscard(appId, "restore", () =>
          ipc.version.revertVersion({
            appId,
            previousVersionId: versionId,
            targetBranchName: targetBranch ?? undefined,
            currentChatMessageId,
          }),
        ),

      restoreToMessage: ({
        appId,
        chatId,
        messageId,
        restoreCodebase,
        targetBranch,
      }) =>
        mutate(appId, "restore-to-message", () =>
          ipc.version.restoreToMessageVersion({
            appId,
            chatId,
            messageId,
            restoreCodebase,
            targetBranchName: targetBranch ?? undefined,
          }),
        ),
    },
  };
}
