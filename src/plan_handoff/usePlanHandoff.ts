import { useCallback } from "react";
import { useStore } from "jotai";

import { planAcceptInNewChatByChatIdAtom } from "@/atoms/planAtoms";
import type { PlanExitPayload } from "@/ipc/types/plan";
import type { HandoffState } from "./state";
import { useKeyedController } from "@/state_machines/react";
import { usePlanHandoffManager } from "./PlanHandoffProvider";
import { PlanHandoffRemoteManager } from "./remote_manager";
import type { PlanHandoffRemoteSnapshot } from "./transport";
import { useSyncExternalStore } from "react";
import { readPlanDocument } from "@/hooks/usePlanDocument";
import { sha256Hex } from "@/lib/browser_hash";
import { serializePlanDocument } from "./transport";

const NO_CHAT_ID = -1;
const NO_CHAT_HANDOFF_SNAPSHOT: PlanHandoffRemoteSnapshot = Object.freeze({
  schemaVersion: 1,
  sourceChatId: NO_CHAT_ID,
  revision: 0,
  handoffId: null,
  targetChatId: null,
  planId: null,
  phase: "idle",
  failure: null,
});

export function getRemotePlanHandoffSnapshot(
  manager: Pick<PlanHandoffRemoteManager, "getSnapshot">,
  chatId: number | null,
): PlanHandoffRemoteSnapshot {
  return chatId === null
    ? NO_CHAT_HANDOFF_SNAPSHOT
    : manager.getSnapshot(chatId);
}

/**
 * React binding for reading a chat's handoff state. Snapshots are immutable
 * and reference-stable between transitions, as useSyncExternalStore requires.
 */
export function usePlanHandoffState(
  chatId: number | null,
): HandoffState | PlanHandoffRemoteSnapshot {
  const manager = usePlanHandoffManager();
  if (manager instanceof PlanHandoffRemoteManager) {
    return useRemotePlanHandoffState(manager, chatId);
  }
  return useKeyedController(manager, chatId ?? NO_CHAT_ID);
}

function useRemotePlanHandoffState(
  manager: PlanHandoffRemoteManager,
  chatId: number | null,
): PlanHandoffRemoteSnapshot {
  const sourceChatId = chatId ?? NO_CHAT_ID;
  const subscribe = useCallback(
    (listener: () => void) =>
      chatId === null
        ? () => undefined
        : manager.subscribeKey(sourceChatId, listener),
    [chatId, manager, sourceChatId],
  );
  const getSnapshot = useCallback(
    () => getRemotePlanHandoffSnapshot(manager, chatId),
    [chatId, manager],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Wires the machine into the app: keeps the command dependencies fresh and
 * returns the entry point that turns a `plan:exit` payload into a
 * PLAN_ACCEPTED event. Mounted once, from `usePlanEvents` at the app root.
 */
export function usePlanHandoff(): {
  acceptPlan: (payload: PlanExitPayload) => Promise<void>;
} {
  const store = useStore();
  const manager = usePlanHandoffManager();
  const remoteManager =
    manager instanceof PlanHandoffRemoteManager ? manager : null;

  const acceptPlan = useCallback(
    async (payload: PlanExitPayload) => {
      // The user records this choice at accept-click time (PlanPanel), before
      // the plan:exit event ever fires. When unknown (typed acceptance like
      // "implement the plan", or after a reload), default to continuing here
      // so we don't surprise-create a chat.
      const acceptInNewChat =
        store.get(planAcceptInNewChatByChatIdAtom).get(payload.chatId) ?? false;
      if (remoteManager) {
        const plan = readPlanDocument(store, payload.chatId);
        if (!plan) {
          throw new Error("Failed to accept plan: missing immutable plan data");
        }
        const planHash = await sha256Hex(serializePlanDocument(plan));
        await remoteManager.accept({
          sourceChatId: payload.chatId,
          appId: payload.appId,
          acceptInNewChat,
          plan,
          planHash,
        });
        return;
      }
      if (!("getOrCreate" in manager)) return;
      manager.getOrCreate(payload.chatId).send({
        type: "PLAN_ACCEPTED",
        chatId: payload.chatId,
        appId: payload.appId,
        acceptInNewChat,
      });
    },
    [manager, remoteManager, store],
  );

  return { acceptPlan };
}
