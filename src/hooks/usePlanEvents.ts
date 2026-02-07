import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "./useSettings";
import { queryKeys } from "@/lib/queryKeys";
import {
  planStateAtom,
  pendingPlanImplementationAtom,
  pendingQuestionnaireAtom,
} from "@/atoms/planAtoms";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import {
  planEventClient,
  planClient,
  type PlanUpdatePayload,
  type PlanExitPayload,
  type PlanQuestionnairePayload,
} from "@/ipc/types/plan";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";

/**
 * Hook to handle plan mode IPC events.
 * Should be called at the app root level to listen for plan events.
 */
export function usePlanEvents() {
  const setPlanState = useSetAtom(planStateAtom);
  const planState = useAtomValue(planStateAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const setPendingPlanImplementation = useSetAtom(
    pendingPlanImplementationAtom,
  );
  const setPendingQuestionnaire = useSetAtom(pendingQuestionnaireAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { settings, updateSettings } = useSettings();

  // Use refs for values accessed in event handlers to avoid stale closures
  const planStateRef = useRef(planState);
  const selectedAppIdRef = useRef(selectedAppId);
  const settingsRef = useRef(settings);

  // Keep refs up to date
  planStateRef.current = planState;
  selectedAppIdRef.current = selectedAppId;
  settingsRef.current = settings;

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

    // Handle plan exit (transition to implementation)
    const unsubscribeExit = planEventClient.onExit(
      async (payload: PlanExitPayload) => {
        // Mark this chat's plan as accepted
        setPlanState((prev) => {
          const nextAccepted = new Set(prev.acceptedChatIds);
          nextAccepted.add(payload.chatId);
          return {
            ...prev,
            acceptedChatIds: nextAccepted,
          };
        });

        // Immediately cancel the current stream so we can start the plan implementation
        try {
          await ipc.chat.cancelStream(payload.chatId);
        } catch (error) {
          console.error("Failed to cancel stream:", error);
        }

        // Show transitioning state while we prepare the implementation
        setPlanState((prev) => {
          const nextTransitioning = new Set(prev.transitioningChatIds);
          nextTransitioning.add(payload.chatId);
          return { ...prev, transitioningChatIds: nextTransitioning };
        });

        // Pause so the user can see the "Plan accepted" confirmation
        await new Promise((resolve) => setTimeout(resolve, 2500));

        // Clear transitioning state
        setPlanState((prev) => {
          const nextTransitioning = new Set(prev.transitioningChatIds);
          nextTransitioning.delete(payload.chatId);
          return { ...prev, transitioningChatIds: nextTransitioning };
        });

        // Read latest values from refs to avoid stale closure
        const currentState = planStateRef.current;
        const planData = currentState.plansByChatId.get(payload.chatId);

        // Switch chat mode to local-agent for implementation (only if currently in plan mode)
        if (settingsRef.current?.selectedChatMode === "plan") {
          updateSettings({ selectedChatMode: "local-agent" });
        }

        // Switch preview back to preview mode
        setPreviewMode("preview");

        // Create a new chat for implementation and navigate to it
        if (!planData || !selectedAppIdRef.current) {
          console.error("Failed to start implementation: missing plan data", {
            hasContent: !!planData,
            hasAppId: !!selectedAppIdRef.current,
          });
          return;
        }

        // Always persist the plan to .dyad/plans/
        let planSlug: string;
        try {
          planSlug = await planClient.createPlan({
            appId: selectedAppIdRef.current,
            chatId: payload.chatId,
            title: planData.title,
            summary: planData.summary,
            content: planData.content,
          });
        } catch {
          showError("Failed to save plan. Please try again.");
          return;
        }

        try {
          const newChatId = await ipc.chat.createChat(selectedAppIdRef.current);

          // Navigate to the new chat
          setSelectedChatId(newChatId);
          navigate({ to: "/chat", search: { id: newChatId } });

          // Refresh the chat list so the new chat appears in the sidebar
          queryClient.invalidateQueries({
            queryKey: queryKeys.chats.all,
          });

          // Queue the plan for implementation in the new chat
          setPendingPlanImplementation({
            chatId: newChatId,
            title: planData.title,
            planSlug,
          });
        } catch (error) {
          console.error("Failed to create new chat for implementation:", error);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    setPlanState,
    setPreviewMode,
    updateSettings,
    setPendingPlanImplementation,
    setPendingQuestionnaire,
    setSelectedChatId,
    navigate,
    queryClient,
  ]);
}
