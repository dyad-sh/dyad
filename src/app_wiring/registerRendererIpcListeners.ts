import type { QueryClient } from "@tanstack/react-query";
import type { createStore } from "jotai";

import { agentTodosByChatIdAtom } from "@/atoms/chatAtoms";
import type { ChatStreamManager } from "@/chat_stream/manager";
import { ipc as defaultIpc, type TelemetryEventPayload } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import {
  getUserInputProjectionAdapter,
  type UserInputChatStreamFacade,
} from "@/user_input/projection";

export type RendererIpcClient = typeof defaultIpc;
type JotaiStore = ReturnType<typeof createStore>;

export interface RegisterRendererIpcListenersOptions {
  ipcClient: RendererIpcClient;
  store: JotaiStore;
  queryClient: QueryClient;
  chatStreamManager: ChatStreamManager;
  onTelemetryEvent?: (payload: TelemetryEventPayload) => void;
}

export function createUserInputChatStreamFacade(
  ipcClient: Pick<RendererIpcClient, "userInput">,
  chatStreamManager: ChatStreamManager,
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
  onTelemetryEvent,
}: RegisterRendererIpcListenersOptions): () => void {
  const unsubscribes: Array<() => void> = [];

  const userInputChatStream = createUserInputChatStreamFacade(
    ipcClient,
    chatStreamManager,
  );

  unsubscribes.push(
    getUserInputProjectionAdapter({
      store,
      ipcClient,
      chatStream: userInputChatStream,
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
    for (const unsubscribe of unsubscribes.splice(0).reverse()) {
      unsubscribe();
    }
  };
}
