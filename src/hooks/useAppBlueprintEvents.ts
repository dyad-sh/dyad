import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { appBlueprintStateAtom } from "@/atoms/appBlueprintAtoms";
import {
  appBlueprintEventClient,
  type AppBlueprintUpdatePayload,
  type AppBlueprintVisualsUpdatePayload,
  type AppBlueprintApprovedPayload,
  type AppBlueprintTimeoutPayload,
} from "@/ipc/types/app_blueprint";

/**
 * Hook to handle app blueprint IPC events.
 * Should be called at the app root level to listen for app blueprint events.
 */
export function useAppBlueprintEvents() {
  const setAppBlueprintState = useSetAtom(appBlueprintStateAtom);

  useEffect(() => {
    const unsubscribeUpdate = appBlueprintEventClient.onUpdate(
      (payload: AppBlueprintUpdatePayload) => {
        setAppBlueprintState((prev) => {
          const nextPlans = new Map(prev.plansByChatId);
          nextPlans.set(payload.chatId, payload.data);
          // A fresh blueprint update supersedes any prior timeout/readiness
          // state for this chat — otherwise a regenerated blueprint could stay
          // stuck as "timed out" or carry over stale visuals readiness.
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

    const unsubscribeVisualsUpdate = appBlueprintEventClient.onVisualsUpdate(
      (payload: AppBlueprintVisualsUpdatePayload) => {
        setAppBlueprintState((prev) => {
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

    const unsubscribeApproved = appBlueprintEventClient.onApproved(
      (payload: AppBlueprintApprovedPayload) => {
        setAppBlueprintState((prev) => {
          const nextApproved = new Set(prev.approvedChatIds);
          nextApproved.add(payload.chatId);
          return {
            ...prev,
            approvedChatIds: nextApproved,
          };
        });
      },
    );

    const unsubscribeTimeout = appBlueprintEventClient.onTimeout(
      (payload: AppBlueprintTimeoutPayload) => {
        setAppBlueprintState((prev) => {
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
  }, [setAppBlueprintState]);
}
