import { useEffect } from "react";
import { useSetAtom } from "jotai";
import {
  planAcceptInNewChatByChatIdAtom,
  planStateAtom,
  pendingQuestionnaireAtom,
} from "@/atoms/planAtoms";
import { previewModeAtom } from "@/atoms/appAtoms";
import {
  planEventClient,
  type PlanUpdatePayload,
  type PlanExitPayload,
  type PlanQuestionnairePayload,
} from "@/ipc/types/plan";
import { usePlanHandoff } from "@/plan_handoff/usePlanHandoff";

/**
 * Hook to handle plan mode IPC events.
 * Should be called at the app root level to listen for plan events.
 *
 * `plan:update` and `plan:questionnaire` are handled inline; `plan:exit`
 * (accept plan → implement) is delegated to the plan-handoff state machine
 * in `src/plan_handoff/`.
 */
export function usePlanEvents() {
  const setPlanState = useSetAtom(planStateAtom);
  const setPlanAcceptInNewChat = useSetAtom(planAcceptInNewChatByChatIdAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setPendingQuestionnaire = useSetAtom(pendingQuestionnaireAtom);
  const { acceptPlan } = usePlanHandoff();

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

    // Handle plan exit (transition to implementation): feed the state machine.
    const unsubscribeExit = planEventClient.onExit(
      (payload: PlanExitPayload) => {
        acceptPlan(payload);
      },
    );

    // Handle questionnaire events - set pending questionnaire for in-app display
    const unsubscribeQuestionnaire = planEventClient.onQuestionnaire(
      (payload: PlanQuestionnairePayload) => {
        setPendingQuestionnaire((prev) => {
          const next = new Map(prev);
          next.set(payload.chatId, payload);
          return next;
        });
      },
    );

    return () => {
      unsubscribeUpdate();
      unsubscribeExit();
      unsubscribeQuestionnaire();
    };
  }, [
    setPlanState,
    setPlanAcceptInNewChat,
    setPreviewMode,
    setPendingQuestionnaire,
    acceptPlan,
  ]);
}
