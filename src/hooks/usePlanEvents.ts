import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { planStateAtom, pendingQuestionnaireAtom } from "@/atoms/planAtoms";
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
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setPendingQuestionnaire = useSetAtom(pendingQuestionnaireAtom);
  const { acceptPlan } = usePlanHandoff();

  useEffect(() => {
    // Handle plan updates
    const unsubscribeUpdate = planEventClient.onUpdate(
      (payload: PlanUpdatePayload) => {
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
  }, [setPlanState, setPreviewMode, setPendingQuestionnaire, acceptPlan]);
}
