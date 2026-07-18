/**
 * Production adapter for VersionPreviewCommands.
 *
 * Calls ipc.version.* directly — not the React Query mutation hooks — so a
 * command can never capture the currently selected app or depend on a
 * mounted component. The adapter also absorbs the side effects the hooks
 * perform today (checkout counter atom, query invalidation, toasts,
 * cloud/db runtime restarts) so behavior is preserved.
 *
 * Only the Git IPC call decides success or failure. Post-success effects
 * (query invalidation, chat refresh, runtime restart) are best-effort and
 * never rewrite the machine's belief about the Git checkout.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { createStore } from "jotai";
import { toast } from "sonner";
import { ipc, type App } from "@/ipc/types";
import type { UserSettings } from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import { activeCheckoutCounterAtom } from "@/store/appAtoms";
import { chatMessagesByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { restartAppWithStore } from "@/hooks/useRunApp";
import type { VersionPreviewRuntime } from "./controller";

type JotaiStore = ReturnType<typeof createStore>;

const NO_BRANCH = "<no-branch>";

export interface VersionPreviewAdapterDeps {
  queryClient: QueryClient;
  store: JotaiStore;
}

export function createVersionPreviewRuntime({
  queryClient,
  store,
}: VersionPreviewAdapterDeps): VersionPreviewRuntime {
  const getSettings = () =>
    queryClient.getQueryData<UserSettings>(queryKeys.settings.user);

  async function runGitCheckout(appId: number, versionId: string) {
    // Keep isAnyCheckoutVersionInProgressAtom accurate for UI (e.g.
    // ChatHeader) that gates on active checkouts.
    store.set(activeCheckoutCounterAtom, (count) => count + 1);
    try {
      return await ipc.version.checkoutVersion({ appId, versionId });
    } finally {
      store.set(activeCheckoutCounterAtom, (count) => count - 1);
    }
  }

  async function invalidateGitQueries(appId: number) {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.branches.current({ appId }),
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.versions.list({ appId }),
    });
  }

  /** Post-success effects must never surface as a Git mutation failure. */
  async function runPostEffects(label: string, effects: () => Promise<void>) {
    try {
      await effects();
    } catch (error) {
      console.error(`version_preview: ${label} post-effects failed`, error);
    }
  }

  return {
    notifyError: (message) => showError(message),
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

      async checkoutVersion({ appId, versionId, hasDbSnapshot }) {
        let result: Awaited<ReturnType<typeof runGitCheckout>>;
        try {
          result = await runGitCheckout(appId, versionId);
        } catch (error) {
          showError(error);
          throw error;
        }
        await runPostEffects("checkout", async () => {
          if (result?.warningMessage) {
            toast.warning(result.warningMessage, { duration: 8000 });
          }
          await invalidateGitQueries(appId);
          await queryClient.invalidateQueries({
            queryKey: queryKeys.apps.detail({ appId }),
          });
          if (getSettings()?.runtimeMode2 === "cloud" || hasDbSnapshot) {
            await restartAppWithStore(store, appId);
          }
        });
      },

      async returnToBranch({ appId, branch }) {
        let result: Awaited<ReturnType<typeof runGitCheckout>>;
        try {
          result = await runGitCheckout(appId, branch);
        } catch (error) {
          showError(error);
          throw error;
        }
        await runPostEffects("return", async () => {
          if (result?.warningMessage) {
            toast.warning(result.warningMessage, { duration: 8000 });
          }
          await invalidateGitQueries(appId);
          const app = queryClient.getQueryData<App | null>(
            queryKeys.apps.detail({ appId }),
          );
          if (getSettings()?.runtimeMode2 === "cloud" || app?.neonProjectId) {
            await restartAppWithStore(store, appId);
          }
        });
      },

      async restoreVersion({ appId, versionId, targetBranch, hasDbSnapshot }) {
        let result: Awaited<ReturnType<typeof ipc.version.revertVersion>>;
        try {
          result = await ipc.version.revertVersion({
            appId,
            previousVersionId: versionId,
            targetBranchName: targetBranch,
          });
        } catch (error) {
          showError(error);
          throw error;
        }
        await runPostEffects("restore", async () => {
          if (result && "successMessage" in result) {
            toast.success(result.successMessage);
          } else if (result && "warningMessage" in result) {
            toast.warning(result.warningMessage);
          }
          await invalidateGitQueries(appId);
          const chatId = store.get(selectedChatIdAtom);
          if (chatId) {
            const chat = await ipc.chat.getChat(chatId);
            store.set(chatMessagesByIdAtom, (prev) => {
              const next = new Map(prev);
              next.set(chatId, chat.messages);
              return next;
            });
          }
          await queryClient.invalidateQueries({
            queryKey: queryKeys.problems.byApp({ appId }),
          });
          if (getSettings()?.runtimeMode2 === "cloud" || hasDbSnapshot) {
            await restartAppWithStore(store, appId);
          }
        });
      },
    },
  };
}
