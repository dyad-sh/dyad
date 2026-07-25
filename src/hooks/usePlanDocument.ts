import { useMemo } from "react";
import type { createStore } from "jotai";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";

import {
  planStateAtom,
  type PlanData,
  type PlanState,
} from "@/atoms/planAtoms";

type JotaiStore = ReturnType<typeof createStore>;

export function readPlanDocument(
  store: Pick<JotaiStore, "get">,
  chatId: number,
): PlanData | undefined {
  return store.get(planStateAtom).plansByChatId.get(chatId);
}

export function usePlanDocument(
  chatId: number | null | undefined,
): PlanData | undefined {
  return useAtomValue(
    useMemo(
      () =>
        selectAtom(
          planStateAtom,
          (state: PlanState) =>
            chatId == null ? undefined : state.plansByChatId.get(chatId),
          Object.is,
        ),
      [chatId],
    ),
  );
}

export function useIsPlanAccepted(chatId: number | null | undefined): boolean {
  return useAtomValue(
    useMemo(
      () =>
        selectAtom(planStateAtom, (state: PlanState) =>
          chatId == null ? false : state.acceptedChatIds.has(chatId),
        ),
      [chatId],
    ),
  );
}
