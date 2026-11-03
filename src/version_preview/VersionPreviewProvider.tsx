import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { toast } from "sonner";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { chatMessagesByIdAtom } from "@/atoms/chatAtoms";
import { useSelectChat } from "@/hooks/useSelectChat";
import { ipc, versionEventClient } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useRemoteMachineClient } from "@/distributed_machines/react";
import { useRegisterEntityDisposer } from "@/state_machines/react";
import { versionPreviewClientDefinition } from "./client_definition";
import { VersionPreviewPresentationStore } from "./presentation_store";
import { ownsHistoricalCheckout, type PreviewState } from "./state";
import { versionPreviewKey } from "./transport";
import { VersionPreviewWindowInterestClient } from "./window_interest_client";

const PresentationStoreContext =
  createContext<VersionPreviewPresentationStore | null>(null);
const WindowInterestContext =
  createContext<VersionPreviewWindowInterestClient | null>(null);

type WindowInterestExit = Parameters<
  VersionPreviewWindowInterestClient["release"]
>[2];

async function releaseWindowInterestWithRetry({
  windowInterest,
  appId,
  operationId,
  exit,
  resync,
}: {
  windowInterest: VersionPreviewWindowInterestClient;
  appId: number;
  operationId: string;
  exit: WindowInterestExit;
  resync: () => Promise<void>;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await windowInterest.release(appId, operationId, exit);
    } catch (error) {
      if (attempt === 2) throw error;
      try {
        await resync();
      } catch {
        // The stable release operation remains safe to retry even when the
        // actor transport cannot resync yet.
      }
    }
  }
  throw new Error("Version preview window release exhausted its retries");
}

function recoveryIntentAlreadyAdvanced(state: PreviewState): boolean {
  return (
    state.type === "returning" ||
    state.type === "validating-current-repository" ||
    state.type === "checkpointing-current-repository" ||
    state.type === "closed"
  );
}

export function useVersionPreviewPresentationStore() {
  const store = useContext(PresentationStoreContext);
  if (!store) {
    throw new Error(
      "useVersionPreview must be used within VersionPreviewProvider",
    );
  }
  return store;
}

export function useVersionPreviewWindowInterestClient() {
  const client = useContext(WindowInterestContext);
  if (!client) {
    throw new Error(
      "useVersionPreview must be used within VersionPreviewProvider",
    );
  }
  return client;
}

export function VersionPreviewProvider({ children }: PropsWithChildren) {
  const [presentation] = useState(() => new VersionPreviewPresentationStore());
  const [windowInterest] = useState(
    () => new VersionPreviewWindowInterestClient(),
  );
  const client = useRemoteMachineClient();
  const jotaiStore = useStore();
  const queryClient = useQueryClient();
  const { selectChat } = useSelectChat();

  useRegisterEntityDisposer("app", presentation.disposeKey);

  useEffect(() => {
    let previousAppId = jotaiStore.get(selectedAppIdAtom);
    return jotaiStore.sub(selectedAppIdAtom, () => {
      const nextAppId = jotaiStore.get(selectedAppIdAtom);
      if (previousAppId !== null && previousAppId !== nextAppId) {
        const releasedAppId = previousAppId;
        const operationId = `version-preview:${globalThis.crypto.randomUUID()}`;
        void releaseWindowInterestWithRetry({
          windowInterest,
          appId: releasedAppId,
          operationId,
          exit: { type: "switch-app", nextAppId },
          resync: () =>
            client
              .actor(
                versionPreviewClientDefinition,
                versionPreviewKey(releasedAppId),
              )
              .resync(),
        })
          .then(() => {
            presentation.send(releasedAppId, {
              type: "APP_CHANGED",
              nextAppId,
            });
          })
          .catch(() => {
            toast.error(
              "Version preview could not finish switching apps. Reopen the app and try again.",
            );
          });
      }
      previousAppId = nextAppId;
    });
  }, [client, jotaiStore, presentation, windowInterest]);

  useEffect(
    () =>
      versionEventClient.onPreviewResult((result) => {
        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: queryKeys.branches.byApp({ appId: result.appId }),
          }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.versions.list({ appId: result.appId }),
          }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.apps.detail({ appId: result.appId }),
          }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.problems.byApp({ appId: result.appId }),
          }),
          // A database undo on an old-layout app leaks one more backup.
          queryClient.invalidateQueries({
            queryKey: queryKeys.neon.developmentBranchStatus({
              appId: result.appId,
            }),
          }),
        ]);
        if (result.notification?.kind === "success") {
          toast.success(result.notification.message);
        } else if (result.notification?.kind === "warning") {
          toast.warning(result.notification.message, { duration: 8000 });
        } else if (result.notification?.kind === "error") {
          toast.error(result.notification.message);
        }
        if (result.affectedChatId !== null) {
          void ipc.chat
            .getChat(result.affectedChatId)
            .then((chat) => {
              jotaiStore.set(chatMessagesByIdAtom, (previous) => {
                const next = new Map(previous);
                next.set(result.affectedChatId!, chat.messages);
                return next;
              });
            })
            .catch(() => {
              toast.warning(
                "The version changed, but the restored chat could not be refreshed.",
              );
            });
        }
        if (result.createdChatId !== null) {
          selectChat({
            appId: result.appId,
            chatId: result.createdChatId,
            scrollToBottom: true,
          });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.chats.all,
          });
        }
      }),
    [jotaiStore, queryClient, selectChat],
  );

  useEffect(() => {
    let unsubscribeActor: () => void = () => undefined;
    const subscribeSelected = () => {
      unsubscribeActor();
      const appId = jotaiStore.get(selectedAppIdAtom);
      if (appId === null) {
        unsubscribeActor = () => undefined;
        return;
      }
      const actor = client.actor(
        versionPreviewClientDefinition,
        versionPreviewKey(appId),
      );
      const dispatchRecoveryIntent = (
        type:
          | "RETRY_RETURN"
          | "ACCEPT_CURRENT_REPOSITORY"
          | "CHECKPOINT_AND_ACCEPT_CURRENT_REPOSITORY",
      ) => {
        const event = {
          type,
          operationId: `version-preview:${globalThis.crypto.randomUUID()}`,
        } as const;
        void (async () => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            if (actor.getStatus() !== "ready") await actor.resync();
            const receipt = await actor.dispatch(event);
            // A rapid duplicate can become ignored after the first dispatch
            // advances the actor into its in-flight recovery state. The
            // original operation remains authoritative, so this is not a user
            // failure and must not produce a contradictory error toast.
            if (receipt.kind === "applied") {
              return;
            }
            if (receipt.kind === "ignored") {
              if (recoveryIntentAlreadyAdvanced(actor.getView().state.state)) {
                return;
              }
              throw new Error("Version recovery intent was ignored");
            }
            if (
              receipt.kind === "rejected" &&
              (receipt.reason === "revision-conflict" ||
                receipt.reason === "stale-actor")
            ) {
              await actor.resync();
              continue;
            }
            throw new Error("Version recovery was not accepted");
          }
          throw new Error("Version recovery remained stale");
        })().catch(() => {
          toast.error(
            "Version recovery could not be started. Please try again.",
          );
        });
      };
      let previousStateType = actor.getView().state.state.type;
      let restorationStarted = false;
      let restoredPresentation = false;
      let orphanRestoreTimer: ReturnType<typeof setTimeout> | null = null;
      const inspect = () => {
        const state = actor.getView().state.state;
        if (
          ownsHistoricalCheckout(state) &&
          !presentation.isPaneVisible(appId) &&
          !restorationStarted
        ) {
          if (orphanRestoreTimer !== null) {
            clearTimeout(orphanRestoreTimer);
            orphanRestoreTimer = null;
          }
          restorationStarted = true;
          void (async () => {
            for (let attempt = 0; attempt < 3; attempt += 1) {
              try {
                const result = await windowInterest.restoreIfOrphaned(appId);
                if (!result.acquired) {
                  restorationStarted = false;
                  if (
                    jotaiStore.get(selectedAppIdAtom) === appId &&
                    ownsHistoricalCheckout(actor.getView().state.state) &&
                    !presentation.isPaneVisible(appId)
                  ) {
                    orphanRestoreTimer = setTimeout(() => {
                      orphanRestoreTimer = null;
                      inspect();
                    }, 250);
                  }
                  return;
                }
                if (
                  jotaiStore.get(selectedAppIdAtom) === appId &&
                  ownsHistoricalCheckout(actor.getView().state.state)
                ) {
                  restoredPresentation = true;
                  presentation.send(appId, { type: "OPEN", appId });
                } else {
                  await windowInterest.release(
                    appId,
                    `version-preview:${globalThis.crypto.randomUUID()}`,
                    { type: "close" },
                  );
                }
                return;
              } catch (error) {
                if (attempt === 2) throw error;
              }
            }
          })().catch(() => {
            toast.error(
              "Version preview could not be restored after the window reloaded. Reopen the app and try again.",
            );
          });
        }
        if (
          state.type === "closed" &&
          (previousStateType === "restoring" ||
            previousStateType === "switching-branch" ||
            previousStateType === "validating-current-repository" ||
            previousStateType === "checkpointing-current-repository" ||
            restoredPresentation)
        ) {
          presentation.send(appId, { type: "CLOSE" });
          restoredPresentation = false;
          const operationId = `version-preview:${globalThis.crypto.randomUUID()}`;
          void releaseWindowInterestWithRetry({
            windowInterest,
            appId,
            operationId,
            exit: { type: "close" },
            resync: () => actor.resync(),
          }).catch(() => {
            toast.error(
              "Version History closed, but its window cleanup did not finish. Reopen the app and try again.",
            );
          });
        }
        previousStateType = state.type;
        const toastId = `version-preview-recovery-${appId}`;
        if (state.type === "recovery-required") {
          toast.error(
            "Unable to return to the branch that was active before previewing this version.",
            {
              id: toastId,
              description: state.error.message,
              duration: Infinity,
              action: {
                label: "Retry",
                onClick: () => dispatchRecoveryIntent("RETRY_RETURN"),
              },
            },
          );
        } else if (state.type === "restore-recovery-required") {
          if (state.currentRepositoryAssessment?.type === "dirty") {
            toast.error("Your current changes need to be saved", {
              id: toastId,
              description:
                "Dyad found changes that are not part of a saved version. Save them as the current version to continue using Version History.",
              duration: Infinity,
              action: {
                label: "Save changes & use current version",
                onClick: () =>
                  dispatchRecoveryIntent(
                    "CHECKPOINT_AND_ACCEPT_CURRENT_REPOSITORY",
                  ),
              },
            });
          } else {
            const isBlocked =
              state.currentRepositoryAssessment?.type === "blocked";
            toast.error(
              isBlocked
                ? "Version History is unavailable"
                : "Version restore needs attention.",
              {
                id: toastId,
                description: state.error.message,
                duration: Infinity,
                action: {
                  label: isBlocked ? "Check again" : "Use current version",
                  onClick: () =>
                    dispatchRecoveryIntent("ACCEPT_CURRENT_REPOSITORY"),
                },
              },
            );
          }
        } else if (state.type === "validating-current-repository") {
          toast.loading("Checking the current version…", {
            id: toastId,
            description:
              "Dyad is verifying that Version History can continue safely.",
            duration: Infinity,
          });
        } else if (state.type === "checkpointing-current-repository") {
          toast.loading("Saving the current version…", {
            id: toastId,
            description:
              "Dyad is saving your current changes before continuing.",
            duration: Infinity,
          });
        } else {
          toast.dismiss(toastId);
        }
      };
      const unsubscribeSelectedActor = actor.subscribe(inspect);
      unsubscribeActor = () => {
        unsubscribeSelectedActor();
        if (orphanRestoreTimer !== null) {
          clearTimeout(orphanRestoreTimer);
          orphanRestoreTimer = null;
        }
      };
      inspect();
    };
    subscribeSelected();
    const unsubscribeSelection = jotaiStore.sub(
      selectedAppIdAtom,
      subscribeSelected,
    );
    return () => {
      unsubscribeSelection();
      unsubscribeActor();
    };
  }, [client, jotaiStore, presentation, windowInterest]);

  useEffect(() => () => presentation.dispose(), [presentation]);

  return (
    <WindowInterestContext.Provider value={windowInterest}>
      <PresentationStoreContext.Provider value={presentation}>
        {children}
      </PresentationStoreContext.Provider>
    </WindowInterestContext.Provider>
  );
}
