import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useSettings } from "./useSettings";
import {
  planContentByChatIdAtom,
  planTitleByChatIdAtom,
  planSummaryByChatIdAtom,
  planShouldPersistAtom,
  pendingPlanImplementationAtom,
  pendingQuestionnaireAtom,
} from "@/atoms/planAtoms";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  planEventClient,
  planClient,
  type PlanUpdatePayload,
  type PlanExitPayload,
  type PlanQuestionnairePayload,
} from "@/ipc/types/plan";
import { ipc } from "@/ipc/types";

/**
 * Hook to handle plan mode IPC events.
 * Should be called at the app root level to listen for plan events.
 */
export function usePlanEvents() {
  const setPlanContent = useSetAtom(planContentByChatIdAtom);
  const setPlanTitle = useSetAtom(planTitleByChatIdAtom);
  const setPlanSummary = useSetAtom(planSummaryByChatIdAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setShouldPersist = useSetAtom(planShouldPersistAtom);
  const shouldPersist = useAtomValue(planShouldPersistAtom);
  const planContent = useAtomValue(planContentByChatIdAtom);
  const planTitle = useAtomValue(planTitleByChatIdAtom);
  const planSummary = useAtomValue(planSummaryByChatIdAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const setPendingPlanImplementation = useSetAtom(
    pendingPlanImplementationAtom,
  );
  const setPendingQuestionnaire = useSetAtom(pendingQuestionnaireAtom);
  const { updateSettings } = useSettings();

  useEffect(() => {
    // Handle plan updates
    const unsubscribeUpdate = planEventClient.onUpdate(
      (payload: PlanUpdatePayload) => {
        // Update plan atoms
        setPlanContent((prev) => {
          const next = new Map(prev);
          next.set(payload.chatId, payload.plan);
          return next;
        });

        setPlanTitle((prev) => {
          const next = new Map(prev);
          next.set(payload.chatId, payload.title);
          return next;
        });

        if (payload.summary) {
          setPlanSummary((prev) => {
            const next = new Map(prev);
            next.set(payload.chatId, payload.summary!);
            return next;
          });
        }

        // Switch to plan preview mode
        setPreviewMode("plan");
      },
    );

    // Handle plan exit (transition to implementation)
    const unsubscribeExit = planEventClient.onExit(
      async (payload: PlanExitPayload) => {
        // Immediately cancel the current stream so we can start the plan implementation
        await ipc.chat.cancelStream(payload.chatId);

        const content = planContent.get(payload.chatId);
        const title = planTitle.get(payload.chatId);
        const summary = planSummary.get(payload.chatId);

        // If user wants to persist the plan, save it to the database
        if (shouldPersist && selectedAppId) {
          if (content && title) {
            try {
              await planClient.createPlan({
                appId: selectedAppId,
                chatId: payload.chatId,
                title,
                summary,
                content,
              });
            } catch (error) {
              console.error("Failed to save plan:", error);
            }
          }

          // Reset persist flag after saving
          setShouldPersist(false);
        }

        // Switch chat mode to local-agent for implementation
        updateSettings({ selectedChatMode: "local-agent" });

        // Switch preview back to preview mode
        setPreviewMode("preview");

        // Queue the plan for implementation - this will be picked up
        // by usePlanImplementation and sent to the agent
        if (content && title) {
          setPendingPlanImplementation({
            chatId: payload.chatId,
            title,
            plan: content,
            implementationNotes: payload.implementationNotes,
          });
        }
      },
    );

    // Handle questionnaire events
    const unsubscribeQuestionnaire = planEventClient.onQuestionnaire(
      (payload: PlanQuestionnairePayload) => {
        setPendingQuestionnaire(payload);
      },
    );

    return () => {
      unsubscribeUpdate();
      unsubscribeExit();
      unsubscribeQuestionnaire();
    };
  }, [
    setPlanContent,
    setPlanTitle,
    setPlanSummary,
    setPreviewMode,
    updateSettings,
    shouldPersist,
    selectedAppId,
    planContent,
    planTitle,
    planSummary,
    setShouldPersist,
    setPendingPlanImplementation,
    setPendingQuestionnaire,
  ]);
}
