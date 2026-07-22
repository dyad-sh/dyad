import { useCallback } from "react";
import { useStore } from "jotai";

import { planAcceptInNewChatByChatIdAtom } from "@/atoms/planAtoms";
import type { PlanExitPayload } from "@/ipc/types/plan";
import type { HandoffState } from "./state";
import { useKeyedController } from "@/state_machines/react";
import { usePlanHandoffManager } from "./PlanHandoffProvider";

const NO_CHAT_ID = -1;

/**
 * React binding for reading a chat's handoff state. Snapshots are immutable
 * and reference-stable between transitions, as useSyncExternalStore requires.
 */
export function usePlanHandoffState(chatId: number | null): HandoffState {
  const manager = usePlanHandoffManager();
  return useKeyedController(manager, chatId ?? NO_CHAT_ID);
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
  const manager = usePlanHandoffManager();

  const acceptPlan = useCallback(
    (payload: PlanExitPayload) => {
      // The user records this choice at accept-click time (PlanPanel), before
      // the plan:exit event ever fires. When unknown (typed acceptance like
      // "implement the plan", or after a reload), default to continuing here
      // so we don't surprise-create a chat.
      const acceptInNewChat =
        store.get(planAcceptInNewChatByChatIdAtom).get(payload.chatId) ?? false;
      manager.getOrCreate(payload.chatId).send({
        type: "PLAN_ACCEPTED",
        chatId: payload.chatId,
        appId: payload.appId,
        acceptInNewChat,
      });
    },
    [manager, store],
  );

  return { acceptPlan };
}
