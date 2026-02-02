import { useEffect } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { planStateAtom } from "@/atoms/planAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { planClient } from "@/ipc/types/plan";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Loads a saved plan from disk and syncs it into memory state for the current chat.
 *
 * @param options.enabled - Extra condition to suppress the query (e.g. while plan is streaming). Defaults to true.
 */
export function usePlan({ enabled = true }: { enabled?: boolean } = {}) {
  const chatId = useAtomValue(selectedChatIdAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const planState = useAtomValue(planStateAtom);
  const setPlanState = useSetAtom(planStateAtom);

  const hasPlanInMemory = chatId ? planState.plansByChatId.has(chatId) : false;

  const { data: savedPlan, isLoading } = useQuery({
    queryKey: queryKeys.plans.forChat({
      appId: appId ?? null,
      chatId: chatId ?? null,
    }),
    queryFn: async () => {
      if (!appId || !chatId) return null;
      return planClient.getPlanForChat({ appId, chatId });
    },
    enabled: !!appId && !!chatId && !hasPlanInMemory && enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Sync saved plan into memory state
  useEffect(() => {
    if (savedPlan && chatId && !hasPlanInMemory) {
      setPlanState((prev) => {
        const nextPlans = new Map(prev.plansByChatId);
        nextPlans.set(chatId, {
          content: savedPlan.content,
          title: savedPlan.title,
          summary: savedPlan.summary ?? undefined,
        });
        return {
          ...prev,
          plansByChatId: nextPlans,
        };
      });
    }
  }, [savedPlan, chatId, hasPlanInMemory, setPlanState]);

  return {
    savedPlan,
    hasPlanInMemory,
    isLoading,
  };
}
