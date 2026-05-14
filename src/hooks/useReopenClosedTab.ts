import { useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useSelectChat } from "./useSelectChat";
import { closedTabHistoryAtom, popClosedTabAtom } from "@/atoms/chatAtoms";

export function useReopenClosedTab() {
  const closedTabHistory = useAtomValue(closedTabHistoryAtom);
  const popClosedTab = useSetAtom(popClosedTabAtom);
  const { selectChat } = useSelectChat();

  const reopenClosedTab = useCallback(() => {
    const record = popClosedTab();
    if (!record) return;
    selectChat({
      chatId: record.chatId,
      appId: record.appId,
    });
  }, [popClosedTab, selectChat]);

  return {
    reopenClosedTab,
    hasClosedTabs: closedTabHistory.length > 0,
    lastClosedTab: closedTabHistory[0] ?? null,
  };
}
