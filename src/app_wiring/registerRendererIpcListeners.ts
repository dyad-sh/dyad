import type { QueryClient } from "@tanstack/react-query";
import type { createStore } from "jotai";

import {
  pendingToolConsentsAtom,
  agentTodosByChatIdAtom,
} from "@/atoms/chatAtoms";
import type { ChatStreamManager } from "@/chat_stream/manager";
import { pendingIntegrationAtom } from "@/atoms/integrationAtoms";
import { pendingQuestionnaireAtom } from "@/atoms/planAtoms";
import { ipc as defaultIpc, type TelemetryEventPayload } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";

export type RendererIpcClient = typeof defaultIpc;
type JotaiStore = ReturnType<typeof createStore>;

export interface RegisterRendererIpcListenersOptions {
  ipcClient: RendererIpcClient;
  store: JotaiStore;
  queryClient: QueryClient;
  chatStreamManager: ChatStreamManager;
  onTelemetryEvent?: (payload: TelemetryEventPayload) => void;
}

export function registerRendererIpcListeners({
  ipcClient,
  store,
  queryClient,
  chatStreamManager,
  onTelemetryEvent,
}: RegisterRendererIpcListenersOptions): () => void {
  const unsubscribes: Array<() => void> = [];

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
    ipcClient.events.misc.onChatStreamStart(({ chatId, streamId }) => {
      store.set(agentTodosByChatIdAtom, (prev) => {
        const next = new Map(prev);
        next.delete(chatId);
        return next;
      });
      // Registration confirmation for the chat stream machine: main has
      // registered the AbortController for this chat's stream (drives the
      // starting -> streaming transition and cancel reconciliation).
      chatStreamManager.notifyStreamRegistered(chatId, streamId);
    }),
  );

  unsubscribes.push(
    ipcClient.events.agent.onConsentRequest((payload) => {
      store.set(pendingToolConsentsAtom, (prev) => [
        ...prev,
        {
          kind: "agent",
          requestId: payload.requestId,
          chatId: payload.chatId,
          toolName: payload.toolName,
          toolDescription: payload.toolDescription,
          inputPreview: payload.inputPreview,
          metadata: payload.metadata,
        },
      ]);
    }),
  );

  unsubscribes.push(
    ipcClient.events.agent.onConsentResolved((payload) => {
      store.set(pendingToolConsentsAtom, (prev) =>
        prev.filter((consent) => consent.requestId !== payload.requestId),
      );
    }),
  );

  unsubscribes.push(
    ipcClient.events.mcp.onConsentRequest((payload) => {
      store.set(pendingToolConsentsAtom, (prev) => [
        ...prev,
        {
          kind: "mcp",
          requestId: payload.requestId,
          chatId: payload.chatId,
          serverId: payload.serverId,
          serverName: payload.serverName,
          toolName: payload.toolName,
          toolDescription: payload.toolDescription,
          inputPreview: payload.inputPreview,
          classifierReason: payload.reason,
          classifierPending: payload.classifierPending ?? false,
        },
      ]);
    }),
  );

  unsubscribes.push(
    ipcClient.events.mcp.onConsentResolved((payload) => {
      store.set(pendingToolConsentsAtom, (prev) =>
        prev.filter((consent) => consent.requestId !== payload.requestId),
      );
    }),
  );

  unsubscribes.push(
    ipcClient.events.mcp.onConsentClassified((payload) => {
      store.set(pendingToolConsentsAtom, (prev) =>
        prev.map((consent) =>
          consent.requestId === payload.requestId
            ? {
                ...consent,
                classifierPending: false,
                classifierReason: payload.reason,
              }
            : consent,
        ),
      );
    }),
  );

  unsubscribes.push(
    ipcClient.events.misc.onChatStreamEnd(({ chatId }) => {
      store.set(pendingToolConsentsAtom, (prev) =>
        prev.filter((consent) => consent.chatId !== chatId),
      );
      store.set(pendingQuestionnaireAtom, (prev) => {
        if (!prev.has(chatId)) return prev;
        const next = new Map(prev);
        next.delete(chatId);
        return next;
      });
      store.set(pendingIntegrationAtom, (prev) => {
        if (!prev.has(chatId)) return prev;
        const next = new Map(prev);
        next.delete(chatId);
        return next;
      });
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
