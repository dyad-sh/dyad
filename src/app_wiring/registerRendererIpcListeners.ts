import type { QueryClient } from "@tanstack/react-query";
import type { createStore } from "jotai";

import {
  agentTodosByChatIdAtom,
  chatMessagesByIdAtom,
  selectedChatIdAtom,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import type { StreamEvent } from "@/chat_stream/state";
import { ipc as defaultIpc, type ChatResponseChunk } from "@/ipc/types";
import { applyStreamingPatch } from "@/lib/applyStreamingPatch";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import { getUserInputReadModel } from "@/user_input/read_model";
import { RendererQueryInvalidationConsumer } from "@/window_infrastructure/renderer_query_invalidation";
import type {
  QueryInvalidationBatch,
  VisibleEntity,
} from "@/window_infrastructure/types";
import type { EntityDisposalRegistry } from "@/state_machines/entity_disposal";

export type RendererIpcClient = typeof defaultIpc;
type JotaiStore = ReturnType<typeof createStore>;
type ChatStreamRendererFacade = {
  ensure(chatId: number): { send(event: StreamEvent): void };
  setPreview(chatId: number, content: string): boolean;
};

const lastQueryInvalidationEpochByClient = new WeakMap<QueryClient, number>();
const lastEntityDisposalEpochByRegistry = new WeakMap<
  EntityDisposalRegistry,
  number
>();

export interface RegisterRendererIpcListenersOptions {
  ipcClient: RendererIpcClient;
  store: JotaiStore;
  queryClient: QueryClient;
  chatStreamManager: ChatStreamRendererFacade;
  entityDisposal: EntityDisposalRegistry;
  getCurrentPathname?: () => string;
  subscribeToNavigation?: (listener: () => void) => () => void;
}

export function visibleEntitiesForRoute(
  pathname: string,
  selectedAppId: number | null,
  selectedChatId: number | null,
): VisibleEntity[] {
  if (pathname === "/app-details") {
    return selectedAppId === null ? [] : [{ kind: "app", id: selectedAppId }];
  }
  if (pathname !== "/chat") return [];
  return [
    ...(selectedAppId === null
      ? []
      : [{ kind: "app" as const, id: selectedAppId }]),
    ...(selectedChatId === null
      ? []
      : [{ kind: "chat" as const, id: selectedChatId }]),
  ];
}

export function registerQueryInvalidationListener(
  ipcClient: Pick<RendererIpcClient, "windowInfrastructure" | "events">,
  queryClient: QueryClient,
  retryOptions: {
    initialDelayMs?: number;
    maximumDelayMs?: number;
  } = {},
): () => void {
  const pendingBatches: QueryInvalidationBatch[] = [];
  let consumer: RendererQueryInvalidationConsumer | undefined;
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelayMs = retryOptions.initialDelayMs ?? 250;
  const maximumRetryDelayMs = retryOptions.maximumDelayMs ?? 5_000;
  const rememberEpoch = () => {
    if (consumer) {
      lastQueryInvalidationEpochByClient.set(queryClient, consumer.epoch());
    }
  };
  const unsubscribe =
    ipcClient.events.windowInfrastructure.onQueryInvalidations((batch) => {
      if (consumer) {
        consumer.consume(batch);
        rememberEpoch();
      } else {
        pendingBatches.push(batch);
      }
    });

  const bootstrapInvalidations = () => {
    void ipcClient.windowInfrastructure
      .bootstrap({
        lastSeenQueryInvalidationEpoch:
          lastQueryInvalidationEpochByClient.get(queryClient) ?? 0,
      })
      .then((bootstrap) => {
        if (disposed) return;
        consumer = new RendererQueryInvalidationConsumer(
          queryClient,
          bootstrap.windowSessionId,
        );
        consumer.recover(
          bootstrap.currentQueryInvalidationEpoch,
          bootstrap.missedInvalidations,
          bootstrap.recoveryScopes,
        );
        for (const batch of pendingBatches.splice(0)) {
          consumer.consume(batch);
        }
        rememberEpoch();
      })
      .catch((error) => {
        if (disposed) return;
        console.error("Failed to bootstrap window infrastructure", error);
        // The next bootstrap replays from the last applied epoch, so batches
        // accumulated before a failed attempt are redundant and safe to drop.
        pendingBatches.splice(0);
        retryTimer = setTimeout(bootstrapInvalidations, retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, maximumRetryDelayMs);
      });
  };
  bootstrapInvalidations();

  return () => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    rememberEpoch();
    unsubscribe();
  };
}

export function registerRendererIpcListeners({
  ipcClient,
  store,
  queryClient,
  chatStreamManager,
  entityDisposal,
  getCurrentPathname = () => "/",
  subscribeToNavigation,
}: RegisterRendererIpcListenersOptions): () => void {
  const unsubscribes: Array<() => void> = [];
  unsubscribes.push(registerQueryInvalidationListener(ipcClient, queryClient));
  unsubscribes.push(
    ipcClient.chatStream.subscribeUnclaimedChunks(
      ({
        chatId,
        messages,
        streamingMessageId,
        streamingPatch,
        streamingPreview,
        chatModeFallbackReason,
      }: ChatResponseChunk) => {
        if (streamingPreview !== undefined) {
          chatStreamManager.setPreview(chatId, streamingPreview.content);
        }
        if (messages) {
          store.set(chatMessagesByIdAtom, (previous) => {
            const next = new Map(previous);
            next.set(chatId, messages);
            return next;
          });
        } else if (
          streamingMessageId !== undefined &&
          streamingPatch !== undefined
        ) {
          const applied = applyStreamingPatch(
            (update) => store.set(chatMessagesByIdAtom, update),
            chatId,
            streamingMessageId,
            streamingPatch,
          );
          if (!applied) {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.chats.detail({ chatId }),
            });
          }
        }
        if (chatModeFallbackReason) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.chats.detail({ chatId }),
          });
        }
      },
    ),
  );

  let selectedAppInterest = store.get(selectedAppIdAtom);
  let selectedChatInterest = store.get(selectedChatIdAtom);
  const publishVisibleEntities = () => {
    const entities = visibleEntitiesForRoute(
      getCurrentPathname(),
      selectedAppInterest,
      selectedChatInterest,
    );
    void ipcClient.windowInfrastructure
      .setVisibleEntities(entities)
      .catch((error) =>
        console.error("Failed to publish visible window entities", error),
      );
  };
  const updateInterest = (
    previous: number | null,
    next: number | null,
    kind: "app-output" | "chat-chunk",
  ) => {
    const interestFor = (id: number) =>
      kind === "app-output"
        ? ({ kind, appId: id } as const)
        : ({ kind, chatId: id } as const);
    if (previous !== null) {
      void ipcClient.windowInfrastructure
        .detachInterest(interestFor(previous))
        .catch((error) =>
          console.error(`Failed to detach ${kind} interest`, error),
        );
    }
    if (next !== null) {
      void ipcClient.windowInfrastructure
        .attachInterest(interestFor(next))
        .catch((error) =>
          console.error(`Failed to attach ${kind} interest`, error),
        );
    }
  };
  updateInterest(null, selectedAppInterest, "app-output");
  updateInterest(null, selectedChatInterest, "chat-chunk");
  publishVisibleEntities();
  if (subscribeToNavigation) {
    unsubscribes.push(subscribeToNavigation(publishVisibleEntities));
  }
  const handleWindowFocus = () => {
    void ipcClient.windowInfrastructure
      .setFocused()
      .catch((error) => console.error("Failed to publish window focus", error));
  };
  window.addEventListener("focus", handleWindowFocus);
  unsubscribes.push(
    store.sub(selectedAppIdAtom, () => {
      const next = store.get(selectedAppIdAtom);
      updateInterest(selectedAppInterest, next, "app-output");
      selectedAppInterest = next;
      publishVisibleEntities();
    }),
    store.sub(selectedChatIdAtom, () => {
      const next = store.get(selectedChatIdAtom);
      updateInterest(selectedChatInterest, next, "chat-chunk");
      selectedChatInterest = next;
      publishVisibleEntities();
    }),
    () => window.removeEventListener("focus", handleWindowFocus),
  );
  unsubscribes.push(
    ipcClient.events.windowInfrastructure.onEntityDisposed(
      ({ entity, epoch }) => {
        if (
          epoch <= (lastEntityDisposalEpochByRegistry.get(entityDisposal) ?? 0)
        ) {
          return;
        }
        lastEntityDisposalEpochByRegistry.set(entityDisposal, epoch);
        try {
          if (entity.kind === "app") {
            if (store.get(selectedAppIdAtom) === entity.id) {
              store.set(selectedAppIdAtom, null);
            }
            entityDisposal.disposeForApp(entity.id);
          } else {
            if (store.get(selectedChatIdAtom) === entity.id) {
              store.set(selectedChatIdAtom, null);
            }
            entityDisposal.disposeForChat(entity.id);
          }
        } catch (error) {
          console.error("Window-local entity disposal failed", {
            entity,
            error,
          });
        }
      },
    ),
  );

  unsubscribes.push(
    getUserInputReadModel({
      store,
      ipcClient,
    }).start(),
  );

  unsubscribes.push(
    ipcClient.events.misc.onErrorToast(({ message, action }) => {
      showError(message, {
        action: action
          ? {
              label: action.label,
              onClick: () => {
                ipcClient.system.openExternalUrl(action.url);
              },
            }
          : undefined,
      });
    }),
  );
  void ipcClient.misc.rendererErrorToastReady(undefined);

  unsubscribes.push(
    ipcClient.events.agent.onTodosUpdate((payload) => {
      store.set(agentTodosByChatIdAtom, (prev) => {
        const next = new Map(prev);
        next.set(payload.chatId, payload.todos);
        return next;
      });
    }),
  );

  unsubscribes.push(
    ipcClient.events.misc.onChatStreamStart(({ chatId }) => {
      store.set(agentTodosByChatIdAtom, (prev) => {
        const next = new Map(prev);
        next.delete(chatId);
        return next;
      });
    }),
  );

  unsubscribes.push(
    ipcClient.events.agent.onProblemsUpdate((payload) => {
      queryClient.setQueryData(
        queryKeys.problems.byApp({ appId: payload.appId }),
        payload.problems,
      );
    }),
  );

  return () => {
    updateInterest(selectedAppInterest, null, "app-output");
    updateInterest(selectedChatInterest, null, "chat-chunk");
    for (const unsubscribe of unsubscribes.splice(0).reverse()) {
      unsubscribe();
    }
  };
}
