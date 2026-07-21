import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useStore } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { planAcceptInNewChatByChatIdAtom } from "@/atoms/planAtoms";
import type { PlanExitPayload } from "@/ipc/types/plan";
import { useSettings } from "@/hooks/useSettings";

import {
  createPlanHandoffCommandRunner,
  type PlanHandoffDeps,
} from "./commands";
import type { HandoffState } from "./state";
import { createPlanHandoffRegistry } from "./registry";

/** Latest app dependencies, refreshed by the mounted app-root hook. */
let currentDeps: PlanHandoffDeps | null = null;

const commandRunner = createPlanHandoffCommandRunner(() => {
  if (!currentDeps) {
    throw new Error(
      "Plan handoff dependencies are not initialised; is usePlanHandoff mounted?",
    );
  }
  return currentDeps;
});

/**
 * One controller per plan chat, so overlapping accepts never share state and
 * handoffs survive component unmounts until their chat is deleted.
 */
const controllerRegistry = createPlanHandoffRegistry(commandRunner);

/** Current handoff state for a chat (idle when none was ever started). */
export function getPlanHandoffState(chatId: number | null): HandoffState {
  return controllerRegistry.getState(chatId);
}

/** Dispose and forget all plan-handoff work owned by a deleted chat. */
export function disposePlanHandoffController(chatId: number): void {
  controllerRegistry.dispose(chatId);
}

/**
 * React binding for reading a chat's handoff state. Snapshots are immutable
 * and reference-stable between transitions, as useSyncExternalStore requires.
 */
export function usePlanHandoffState(chatId: number | null): HandoffState {
  return useSyncExternalStore(controllerRegistry.subscribe, () =>
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
      // the plan:exit event ever fires. When unknown (typed acceptance like
      // "implement the plan", or after a reload), default to continuing here
      // so we don't surprise-create a chat.
      const acceptInNewChat =
        store.get(planAcceptInNewChatByChatIdAtom).get(payload.chatId) ?? false;
      controllerRegistry.getOrCreate(payload.chatId).send({
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
