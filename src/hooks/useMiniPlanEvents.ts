import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { miniPlanStateAtom } from "@/atoms/miniPlanAtoms";
import {
  miniPlanEventClient,
  type MiniPlanUpdatePayload,
  type MiniPlanVisualsUpdatePayload,
  type MiniPlanApprovedPayload,
  type MiniPlanTimeoutPayload,
} from "@/ipc/types/mini_plan";

/**
 * Hook to handle mini plan IPC events.
 * Should be called at the app root level to listen for mini plan events.
 */
export function useMiniPlanEvents() {
  const setMiniPlanState = useSetAtom(miniPlanStateAtom);

  useEffect(() => {
    const unsubscribeUpdate = miniPlanEventClient.onUpdate(
      (payload: MiniPlanUpdatePayload) => {
        setMiniPlanState((prev) => {
          const nextPlans = new Map(prev.plansByChatId);
          nextPlans.set(payload.chatId, payload.data);
          // A fresh plan update supersedes any prior timeout/readiness state
          // for this chat — otherwise a regenerated plan could stay stuck as
          // "timed out" or carry over stale visuals readiness.
          const nextTimedOut = new Set(prev.timedOutChatIds);
          nextTimedOut.delete(payload.chatId);
          const nextVisualsReady = new Set(prev.visualsReadyChatIds);
          nextVisualsReady.delete(payload.chatId);
          return {
            ...prev,
            plansByChatId: nextPlans,
            timedOutChatIds: nextTimedOut,
            visualsReadyChatIds: nextVisualsReady,
          };
        });
      },
    );

    const unsubscribeVisualsUpdate = miniPlanEventClient.onVisualsUpdate(
      (payload: MiniPlanVisualsUpdatePayload) => {
        setMiniPlanState((prev) => {
          const nextPlans = new Map(prev.plansByChatId);
          const existingPlan = nextPlans.get(payload.chatId);
          if (existingPlan) {
            nextPlans.set(payload.chatId, {
              ...existingPlan,
              visuals: payload.visuals,
            });
          }
          const next: typeof prev = {
            ...prev,
            plansByChatId: nextPlans,
          };
          if (payload.complete) {
            const nextReady = new Set(prev.visualsReadyChatIds);
            nextReady.add(payload.chatId);
            next.visualsReadyChatIds = nextReady;
          }
          return next;
        });
      },
    );

    const unsubscribeApproved = miniPlanEventClient.onApproved(
      (payload: MiniPlanApprovedPayload) => {
        setMiniPlanState((prev) => {
          const nextApproved = new Set(prev.approvedChatIds);
          nextApproved.add(payload.chatId);
          return {
            ...prev,
            approvedChatIds: nextApproved,
          };
        });
      },
    );

    const unsubscribeTimeout = miniPlanEventClient.onTimeout(
      (payload: MiniPlanTimeoutPayload) => {
        setMiniPlanState((prev) => {
          const nextTimedOut = new Set(prev.timedOutChatIds);
          nextTimedOut.add(payload.chatId);
          return {
            ...prev,
            timedOutChatIds: nextTimedOut,
          };
        });
      },
    );

    return () => {
      unsubscribeUpdate();
      unsubscribeVisualsUpdate();
      unsubscribeApproved();
      unsubscribeTimeout();
    };
  }, [setMiniPlanState]);
}
