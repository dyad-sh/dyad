import { useCallback, useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useShortcut } from "./useShortcut";
import { useSelectChat } from "./useSelectChat";
import { useIsMac } from "./useChatModeToggle";
import { closedTabHistoryAtom, popClosedTabAtom } from "@/atoms/chatAtoms";

export function useReopenClosedTab() {
  const isMac = useIsMac();
  const closedTabHistory = useAtomValue(closedTabHistoryAtom);
  const popClosedTab = useSetAtom(popClosedTabAtom);
  const { selectChat } = useSelectChat();

  const modifiers = useMemo(
    () => ({
      ctrl: !isMac,
      meta: isMac,
      shift: true,
    }),
    [isMac],
  );

  const reopenClosedTab = useCallback(() => {
    const record = popClosedTab();
    if (!record) return;
    selectChat({
      chatId: record.chatId,
      appId: record.appId,
    });
  }, [popClosedTab, selectChat]);

  useShortcut("t", modifiers, reopenClosedTab, true);

  return {
    reopenClosedTab,
    hasClosedTabs: closedTabHistory.length > 0,
  };
}
