import type { QueryClient } from "@tanstack/react-query";
import type { createStore } from "jotai";

import {
  agentTodosByChatIdAtom,
  chatMessagesByIdAtom,
  selectedChatIdAtom,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import type { ChatStreamInvocationRef, StreamEvent } from "@/chat_stream/state";
import {
  ipc as defaultIpc,
  type ChatResponseChunk,
  type TelemetryEventPayload,
} from "@/ipc/types";
import { applyStreamingPatch } from "@/lib/applyStreamingPatch";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import {
  getUserInputReadModel,
  type UserInputChatStreamFacade,
} from "@/user_input/read_model";
import { RendererQueryInvalidationConsumer } from "@/window_infrastructure/renderer_query_invalidation";
import type { QueryInvalidationBatch } from "@/window_infrastructure/types";
import type { EntityDisposalRegistry } from "@/state_machines/entity_disposal";

export type RendererIpcClient = typeof defaultIpc;
type JotaiStore = ReturnType<typeof createStore>;
type ChatStreamRendererFacade = {
  ensure(chatId: number): { send(event: StreamEvent): void };
  setPreview(chatId: number, content: string): boolean;
  notifyStreamRegistered(
    chatId: number,
    invocationRef?: ChatStreamInvocationRef,
  ): void;
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
  onTelemetryEvent?: (payload: TelemetryEventPayload) => void;
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

export function createUserInputChatStreamFacade(
  ipcClient: Pick<RendererIpcClient, "userInput">,
  chatStreamManager: ChatStreamRendererFacade,
): UserInputChatStreamFacade {
  return {
    submit: ({ requestId, ...request }) =>
      new Promise<{ accepted: boolean }>((resolve, reject) => {
        let completed = false;
        chatStreamManager.ensure(request.chatId).send({
          type: "submit",
          request: {
            ...request,
            owner: { kind: "user-input-follow-up", requestId },
            onAccepted: () => {
              if (completed) return;
              completed = true;
              resolve({ accepted: true });
            },
            onAcceptanceError: (error) => {
              if (completed) return;
              completed = true;
              reject(error);
            },
            onAcceptanceRejected: async (reason) => {
              if (completed) return;
              completed = true;
              try {
                await ipcClient.userInput.rejectFollowUp({ requestId, reason });
                resolve({ accepted: false });
              } catch (error) {
                reject(error);
                throw error;
              }
            },
          },
        });
      }),
  };
}

export function registerRendererIpcListeners({
  ipcClient,
  store,
  queryClient,
  chatStreamManager,
  entityDisposal,
  onTelemetryEvent,
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
  unsubscribes.push(
    store.sub(selectedAppIdAtom, () => {
      const next = store.get(selectedAppIdAtom);
      updateInterest(selectedAppInterest, next, "app-output");
      selectedAppInterest = next;
    }),
    store.sub(selectedChatIdAtom, () => {
      const next = store.get(selectedChatIdAtom);
      updateInterest(selectedChatInterest, next, "chat-chunk");
      selectedChatInterest = next;
    }),
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
            entityDisposal.disposeForApp(entity.id);
          } else {
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
    ipcClient.events.misc.onChatStreamStart(({ chatId, invocationRef }) => {
      store.set(agentTodosByChatIdAtom, (prev) => {
        const next = new Map(prev);
        next.delete(chatId);
        return next;
      });
      // Registration confirmation for the chat stream machine: main has
      // registered the AbortController for this chat's stream (drives the
      // starting -> streaming transition and cancel reconciliation).
      chatStreamManager.notifyStreamRegistered(chatId, invocationRef);
    }),
  );

  unsubscribes.push(
    ipcClient.events.system.onTelemetryEvent((payload) => {
      onTelemetryEvent?.(payload);
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
