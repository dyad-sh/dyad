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
import { ownsHistoricalCheckout } from "./state";
import { versionPreviewKey } from "./transport";
import { VersionPreviewWindowInterestClient } from "./window_interest_client";

const PresentationStoreContext =
  createContext<VersionPreviewPresentationStore | null>(null);
const WindowInterestContext =
  createContext<VersionPreviewWindowInterestClient | null>(null);

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
        void (async () => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              await windowInterest.release(releasedAppId, operationId, {
                type: "switch-app",
                nextAppId,
              });
              presentation.send(releasedAppId, {
                type: "APP_CHANGED",
                nextAppId,
              });
              return;
            } catch (error) {
              if (attempt === 2) throw error;
              try {
                await client
                  .actor(
                    versionPreviewClientDefinition,
                    versionPreviewKey(releasedAppId),
                  )
                  .resync();
              } catch {
                // The stable release operation remains safe to retry even when
                // the actor transport cannot resync yet.
              }
            }
          }
        })().catch(() => {
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
            restoredPresentation)
        ) {
          presentation.send(appId, { type: "CLOSE" });
          restoredPresentation = false;
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
                onClick: () => {
                  const event = {
                    type: "RETRY_RETURN" as const,
                    operationId: `version-preview:${globalThis.crypto.randomUUID()}`,
                  };
                  void (async () => {
                    for (let attempt = 0; attempt < 3; attempt += 1) {
                      if (actor.getStatus() !== "ready") await actor.resync();
                      const receipt = await actor.dispatch(event);
                      if (receipt.kind === "applied") return;
                      if (
                        receipt.kind === "rejected" &&
                        (receipt.reason === "revision-conflict" ||
                          receipt.reason === "stale-actor")
                      ) {
                        await actor.resync();
                        continue;
                      }
                      throw new Error(
                        "The version recovery retry was not accepted",
                      );
                    }
                    throw new Error(
                      "The version recovery retry remained stale",
                    );
                  })().catch(() => {
                    toast.error(
                      "Version recovery could not be started. Please try again.",
                    );
                  });
                },
              },
            },
          );
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
