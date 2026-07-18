import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useStore } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { planAcceptInNewChatByChatIdAtom } from "@/atoms/planAtoms";
import type { PlanExitPayload } from "@/ipc/types/plan";
import { useSettings } from "@/hooks/useSettings";

import { createHandoffController, type HandoffController } from "./controller";
import {
  createPlanHandoffCommandRunner,
  type PlanHandoffDeps,
} from "./commands";
import type { HandoffState } from "./state";

/**
 * Module-level registry: one controller per plan chat, so overlapping accepts
 * in different chats never share state, and a handoff keeps running when the
 * component tree that started it unmounts (the legacy saga relied on the same
 * property for its global-atom writes).
 */
const controllers = new Map<number, HandoffController>();
const registryListeners = new Set<() => void>();

/**
 * Latest app dependencies, refreshed by the mounted {@link usePlanHandoff}
 * hook and read lazily by commands at execution time.
 */
let currentDeps: PlanHandoffDeps | null = null;

const commandRunner = createPlanHandoffCommandRunner(() => {
  if (!currentDeps) {
    throw new Error(
      "Plan handoff dependencies are not initialised; is usePlanHandoff mounted?",
    );
  }
  return currentDeps;
});

const IDLE_STATE: HandoffState = { type: "idle" };

function notifyRegistry(): void {
  // Set iteration is safe against listeners unsubscribing mid-notify.
  for (const listener of registryListeners) {
    listener();
  }
}

function getOrCreateController(chatId: number): HandoffController {
  let controller = controllers.get(chatId);
  if (!controller) {
    controller = createHandoffController(commandRunner);
    controllers.set(chatId, controller);
    // Bubble every controller change up through the registry so
    // useSyncExternalStore consumers re-read, even for controllers created
    // after they first subscribed.
    controller.subscribe(notifyRegistry);
    notifyRegistry();
  }
  return controller;
}

function subscribeToRegistry(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

/** Current handoff state for a chat (idle when none was ever started). */
export function getPlanHandoffState(chatId: number | null): HandoffState {
  if (chatId === null) {
    return IDLE_STATE;
  }
  return controllers.get(chatId)?.getSnapshot() ?? IDLE_STATE;
}

/**
 * React binding for reading a chat's handoff state. Snapshots are immutable
 * and reference-stable between transitions, as useSyncExternalStore requires.
 */
export function usePlanHandoffState(chatId: number | null): HandoffState {
  return useSyncExternalStore(subscribeToRegistry, () =>
    getPlanHandoffState(chatId),
  );
}

/**
 * Wires the machine into the app: keeps the command dependencies fresh and
 * returns the entry point that turns a `plan:exit` payload into a
 * PLAN_ACCEPTED event. Mounted once, from `usePlanEvents` at the app root.
 */
export function usePlanHandoff(): {
  acceptPlan: (payload: PlanExitPayload) => void;
} {
  const store = useStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { settings } = useSettings();

  useEffect(() => {
    currentDeps = {
      store,
      queryClient,
      navigate: (options) => {
        void navigate(options);
      },
      settings,
    };
    // Deliberately no cleanup: a handoff mid-flight after unmount keeps using
    // the last known dependencies (matches the legacy saga, which kept
    // mutating global atoms after unmount).
  }, [store, navigate, queryClient, settings]);

  const acceptPlan = useCallback(
    (payload: PlanExitPayload) => {
      // The user records this choice at accept-click time (PlanPanel), before
      // the plan:exit event ever fires. Default to a new chat when unknown.
      const acceptInNewChat =
        store.get(planAcceptInNewChatByChatIdAtom).get(payload.chatId) ?? true;
      getOrCreateController(payload.chatId).send({
        type: "PLAN_ACCEPTED",
        chatId: payload.chatId,
        appId: payload.appId,
        acceptInNewChat,
      });
    },
    [store],
  );

  return { acceptPlan };
}
