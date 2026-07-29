import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import {
  planAcceptInNewChatByChatIdAtom,
  planStateAtom,
} from "@/atoms/planAtoms";
import { previewModeAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { planEventClient, type PlanUpdatePayload } from "@/ipc/types/plan";

/**
 * Hook to handle plan mode IPC events.
 * Should be called at the app root level to listen for plan events.
 *
 * `plan:update` is handled inline; `plan:exit` (accept plan → implement) is
 * delegated to the plan-handoff state machine in `src/plan_handoff/`.
 */
export function usePlanEvents() {
  const setPlanState = useSetAtom(planStateAtom);
  const setPlanAcceptInNewChat = useSetAtom(planAcceptInNewChatByChatIdAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const navigate = useNavigate();

  useEffect(() => {
    // Handle plan updates
    const unsubscribeUpdate = planEventClient.onUpdate(
      (payload: PlanUpdatePayload) => {
        // A choice belongs to the plan that was accepted, not the chat
        // forever. Clear it when a new draft arrives so typed acceptance of
        // that draft cannot inherit an earlier button choice.
        setPlanAcceptInNewChat((prev) => {
          if (!prev.has(payload.chatId)) return prev;
          const next = new Map(prev);
          next.delete(payload.chatId);
          return next;
        });

        // Update plan state
        setPlanState((prev) => {
          const nextPlans = new Map(prev.plansByChatId);
          nextPlans.set(payload.chatId, {
            content: payload.plan,
            title: payload.title,
            summary: payload.summary,
          });
          return {
            ...prev,
            plansByChatId: nextPlans,
          };
        });

        // Switch to plan preview mode
        setPreviewMode("plan");
      },
    );

    const unsubscribeExit = planEventClient.onExit((payload) => {
      // Main has already admitted the handoff. This compatibility event only
      // clears the renderer-local button choice used to form that intent.
      setPlanAcceptInNewChat((prev) => {
        if (!prev.has(payload.chatId)) return prev;
        const next = new Map(prev);
        next.delete(payload.chatId);
        return next;
      });
    });
    const unsubscribePresentation = planEventClient.onHandoffPresentation(
      (payload) => {
        // Show implementation preview after the handoff is accepted.
        setPreviewMode("preview");
        // Select the chat that will implement the accepted plan.
        setSelectedChatId(payload.targetChatId);
        void navigate({
          to: "/chat",
          search: { id: payload.targetChatId, appId: payload.appId },
        });
      },
    );

    return () => {
      unsubscribeUpdate();
      unsubscribeExit();
      unsubscribePresentation();
    };
  }, [
    setPlanState,
    setPlanAcceptInNewChat,
    setPreviewMode,
    setSelectedChatId,
    navigate,
  ]);
}
