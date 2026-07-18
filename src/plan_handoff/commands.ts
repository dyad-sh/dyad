import type { SetStateAction } from "react";
import type { getDefaultStore } from "jotai";
import type { QueryClient } from "@tanstack/react-query";

import { planStateAtom, type PlanState } from "@/atoms/planAtoms";
import { previewModeAtom } from "@/atoms/appAtoms";
import {
  chatErrorByIdAtom,
  chatMessagesByIdAtom,
  chatStreamCountByIdAtom,
  isStreamingByIdAtom,
  selectedChatIdAtom,
  streamingPreviewByChatIdAtom,
} from "@/atoms/chatAtoms";
import { ipc, type Message } from "@/ipc/types";
import { planClient } from "@/ipc/types/plan";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import { handleEffectiveChatModeChunk } from "@/lib/chatModeStream";
import { applyStreamingPatch } from "@/lib/applyStreamingPatch";
import { triggerResync, syncChatFromDb } from "@/lib/resyncChat";
import {
  applyPreviewChunk,
  clearPreviewForChat,
} from "@/lib/streamingPreviewSync";
import type { UserSettings } from "@/lib/schemas";

import type { HandoffCommandRunner } from "./controller";
import type { HandoffCommand, HandoffEvent } from "./state";

type JotaiStore = ReturnType<typeof getDefaultStore>;

/**
 * Everything the command runner needs from the running app. Provided by the
 * React binding (`usePlanHandoff.ts`) and read lazily at execution time so a
 * handoff that outlives a component keeps working with the latest values.
 */
export interface PlanHandoffDeps {
  store: JotaiStore;
  queryClient: QueryClient;
  navigate: (options: {
    to: "/chat";
    search: { id: number; appId: number };
  }) => void;
  settings: UserSettings | null | undefined;
}

function updatePlanState(
  store: JotaiStore,
  update: (prev: PlanState) => PlanState,
): void {
  store.set(planStateAtom, update(store.get(planStateAtom)));
}

/**
 * Production adapter: maps each {@link HandoffCommand} onto the existing
 * renderer implementations (IPC clients, Jotai atoms, React Query, router).
 * This is the only place in the handoff that touches the outside world.
 */
export function createPlanHandoffCommandRunner(
  getDeps: () => PlanHandoffDeps,
): HandoffCommandRunner {
  return async function run(
    command: HandoffCommand,
    emit: (event: HandoffEvent) => void,
  ): Promise<void> {
    const deps = getDeps();
    const { store } = deps;

    switch (command.type) {
      case "mark-plan-accepted": {
        updatePlanState(store, (prev) => {
          const nextAccepted = new Set(prev.acceptedChatIds);
          nextAccepted.add(command.chatId);
          return { ...prev, acceptedChatIds: nextAccepted };
        });
        return;
      }

      case "cancel-stream": {
        try {
          await ipc.chat.cancelStream(command.chatId);
        } catch (error) {
          // Legacy behavior: log and continue with the handoff anyway.
          console.error("Failed to cancel stream:", error);
        }
        emit({ type: "STREAM_CANCEL_FINISHED" });
        return;
      }

      case "show-transitioning": {
        updatePlanState(store, (prev) => {
          const next = new Set(prev.transitioningChatIds);
          next.add(command.chatId);
          return { ...prev, transitioningChatIds: next };
        });
        return;
      }

      case "hide-transitioning": {
        updatePlanState(store, (prev) => {
          const next = new Set(prev.transitioningChatIds);
          next.delete(command.chatId);
          return { ...prev, transitioningChatIds: next };
        });
        return;
      }

      case "wait": {
        await new Promise((resolve) => setTimeout(resolve, command.ms));
        emit({ type: "TRANSITION_DISPLAY_DONE" });
        return;
      }

      case "set-preview-mode": {
        store.set(previewModeAtom, command.mode);
        return;
      }

      case "persist-plan": {
        // Read the freshest plan content at persist time, exactly like the
        // legacy saga (the plan may have been updated while transitioning).
        const planData = store
          .get(planStateAtom)
          .plansByChatId.get(command.chatId);
        if (!planData) {
          emit({ type: "PLAN_DATA_MISSING" });
          return;
        }
        try {
          const planSlug = await planClient.createPlan({
            appId: command.appId,
            chatId: command.chatId,
            title: planData.title,
            summary: planData.summary,
            content: planData.content,
          });
          emit({ type: "PLAN_PERSISTED", planSlug });
        } catch (error) {
          emit({ type: "PLAN_PERSIST_FAILED", error: String(error) });
        }
        return;
      }

      case "create-chat": {
        try {
          const newChatId = await ipc.chat.createChat({
            appId: command.appId,
            initialChatMode: "local-agent",
          });
          emit({ type: "CHAT_READY", implementationChatId: newChatId });
        } catch (error) {
          emit({ type: "CHAT_PREPARE_FAILED", error: String(error) });
        }
        return;
      }

      case "switch-chat-mode": {
        // Continue in the same chat: switch its stored mode to Agent so the
        // implementation turn (and the input UI) runs in Agent mode rather
        // than re-entering planning.
        try {
          await ipc.chat.updateChat({
            chatId: command.chatId,
            chatMode: "local-agent",
          });
          emit({ type: "CHAT_READY", implementationChatId: command.chatId });
        } catch (error) {
          emit({ type: "CHAT_PREPARE_FAILED", error: String(error) });
        }
        return;
      }

      case "navigate-to-chat": {
        store.set(selectedChatIdAtom, command.chatId);
        deps.navigate({
          to: "/chat",
          search: { id: command.chatId, appId: command.appId },
        });
        return;
      }

      case "refresh-chat-list": {
        deps.queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
        return;
      }

      case "watch-stream-idle": {
        // The one place the handoff observes stream state. Today the source
        // is `isStreamingByIdAtom`; swapping the source later only means
        // changing how this command produces STREAM_BECAME_IDLE.
        const isIdle = () =>
          !(store.get(isStreamingByIdAtom).get(command.chatId) ?? false);
        if (!isIdle()) {
          await new Promise<void>((resolve) => {
            const unsubscribe = store.sub(isStreamingByIdAtom, () => {
              if (isIdle()) {
                unsubscribe();
                resolve();
              }
            });
          });
        }
        emit({ type: "STREAM_BECAME_IDLE", chatId: command.chatId });
        return;
      }

      case "start-implementation": {
        startImplementationStream(command.chatId, command.planSlug, getDeps);
        emit({ type: "IMPLEMENTATION_STARTED" });
        return;
      }

      case "notify-failure": {
        // Replicates the legacy saga's error reporting exactly.
        switch (command.failure) {
          case "missing-plan-data":
            console.error("Failed to start implementation: missing plan data", {
              hasContent: false,
            });
            return;
          case "persist-plan":
            showError("Failed to save plan. Please try again.");
            return;
          case "prepare-chat":
            console.error(
              "Failed to start plan implementation:",
              command.error,
            );
            return;
          default: {
            const exhaustive: never = command.failure;
            return exhaustive;
          }
        }
      }

      default: {
        const exhaustive: never = command;
        return exhaustive;
      }
    }
  };
}

/**
 * Starts the `/implement-plan=<slug>` stream and mirrors chunks into the
 * global chat atoms. Moved verbatim (minus the mount guard — this runs at the
 * app root now) from the legacy `usePlanImplementation` hook; the machine's
 * job ends once the stream has been started.
 */
function startImplementationStream(
  chatId: number,
  planSlug: string,
  getDeps: () => PlanHandoffDeps,
): void {
  const { store } = getDeps();

  const setIsStreaming = (value: boolean) => {
    store.set(isStreamingByIdAtom, (prev) => {
      const next = new Map(prev);
      next.set(chatId, value);
      return next;
    });
  };
  const setMessages = (update: SetStateAction<Map<number, Message[]>>) =>
    store.set(chatMessagesByIdAtom, update);
  const setPreview = (update: SetStateAction<Map<number, string>>) =>
    store.set(streamingPreviewByChatIdAtom, update);

  setIsStreaming(true);
  store.set(chatErrorByIdAtom, (prev) => {
    const next = new Map(prev);
    next.set(chatId, null);
    return next;
  });

  let hasIncrementedStreamCount = false;

  ipc.chatStream.start(
    {
      chatId,
      // Expanded server-side in chat_stream_handlers.
      prompt: `/implement-plan=${planSlug}`,
      selectedComponents: [],
    },
    {
      onChunk: ({
        messages: updatedMessages,
        streamingMessageId,
        streamingPatch,
        streamingPreview,
        effectiveChatMode,
        chatModeFallbackReason,
      }) => {
        if (
          handleEffectiveChatModeChunk(
            { effectiveChatMode, chatModeFallbackReason },
            getDeps().settings,
            chatId,
          )
        ) {
          return;
        }

        if (!hasIncrementedStreamCount) {
          store.set(chatStreamCountByIdAtom, (prev) => {
            const next = new Map(prev);
            next.set(chatId, (prev.get(chatId) ?? 0) + 1);
            return next;
          });
          hasIncrementedStreamCount = true;
        }

        applyPreviewChunk(setPreview, chatId, streamingPreview);

        if (updatedMessages) {
          // Full messages update (initial load, post-compaction, etc.)
          setMessages((prev) => {
            const next = new Map(prev);
            next.set(chatId, updatedMessages);
            return next;
          });
        } else if (
          streamingMessageId !== undefined &&
          streamingPatch !== undefined
        ) {
          const applied = applyStreamingPatch(
            setMessages,
            chatId,
            streamingMessageId,
            streamingPatch,
          );
          if (!applied) {
            triggerResync(chatId, setMessages, store);
          }
        }
      },
      onEnd: () => {
        setIsStreaming(false);
        clearPreviewForChat(setPreview, chatId);
        syncChatFromDb(chatId, setMessages, "[CHAT] Plan onEnd", store);
      },
      onError: ({ error }) => {
        console.error("Plan implementation stream error:", error);
        store.set(chatErrorByIdAtom, (prev) => {
          const next = new Map(prev);
          next.set(chatId, error);
          return next;
        });
        setIsStreaming(false);
        clearPreviewForChat(setPreview, chatId);
        syncChatFromDb(chatId, setMessages, "[CHAT] Plan onError", store);
      },
    },
  );
}
