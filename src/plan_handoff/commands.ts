import type { getDefaultStore } from "jotai";
import type { QueryClient } from "@tanstack/react-query";

import { planStateAtom, type PlanState } from "@/atoms/planAtoms";
import { previewModeAtom } from "@/atoms/appAtoms";
import { isStreamingByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { ipc } from "@/ipc/types";
import { planClient } from "@/ipc/types/plan";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";

import type { HandoffCommandRunner } from "./controller";
import type { HandoffCommand, HandoffEvent } from "./state";

/**
 * Machine dependency graph: plan_handoff -> chat_stream facade. The concrete
 * adapter is injected at the application root; this module never imports the
 * chat-stream registry/controller boundary.
 */

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
  chatStream: {
    submit(request: {
      chatId: number;
      prompt: string;
      selectedComponents: [];
    }): void;
  };
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
  // Active stream-idle watchers, keyed by watched chatId. Tracked so a
  // watcher can be disposed when the machine leaves awaiting-stream-idle for
  // any reason (a superseding accept) instead of leaking a Jotai
  // subscription that waits forever on a stream that may never go idle.
  const idleWatchers = new Map<number, () => void>();

  function disposeIdleWatcher(chatId: number): void {
    const unsubscribe = idleWatchers.get(chatId);
    if (unsubscribe) {
      idleWatchers.delete(chatId);
      unsubscribe();
    }
  }

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
        //
        // Non-blocking: the watcher lives outside the serial command queue,
        // emits at most once, disposes itself when it fires, and can be
        // disposed externally via `unwatch-stream-idle`.
        disposeIdleWatcher(command.chatId);
        const isIdle = () =>
          !(store.get(isStreamingByIdAtom).get(command.chatId) ?? false);
        if (isIdle()) {
          emit({ type: "STREAM_BECAME_IDLE", chatId: command.chatId });
          return;
        }
        const unsubscribe = store.sub(isStreamingByIdAtom, () => {
          if (isIdle()) {
            disposeIdleWatcher(command.chatId);
            emit({ type: "STREAM_BECAME_IDLE", chatId: command.chatId });
          }
        });
        idleWatchers.set(command.chatId, unsubscribe);
        return;
      }

      case "unwatch-stream-idle": {
        disposeIdleWatcher(command.chatId);
        return;
      }

      case "start-implementation": {
        deps.chatStream.submit({
          chatId: command.chatId,
          prompt: `/implement-plan=${command.planSlug}`,
          selectedComponents: [],
        });
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
