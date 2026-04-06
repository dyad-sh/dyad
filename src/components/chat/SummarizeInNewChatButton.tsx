import { useSelectChat } from "@/hooks/useSelectChat";
import { useAtomValue } from "jotai";
import { useCallback } from "react";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useInitialChatMode } from "@/hooks/useInitialChatMode";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";

export function useSummarizeInNewChat() {
  const chatId = useAtomValue(selectedChatIdAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const { streamMessage } = useStreamChat();
  const { selectChat } = useSelectChat();
  const currentChatMode = useInitialChatMode() ?? "build";

  const handleSummarize = useCallback(async () => {
    if (!appId) {
      console.error("No app id found");
      return;
    }
    if (!chatId) {
      console.error("No chat id found");
      return;
    }
    try {
      const newChatId = await ipc.chat.createChat({
        appId,
        initialChatMode: currentChatMode,
      });
      // Use selectChat to ensure mode is synced properly
      selectChat({ chatId: newChatId, appId, chatMode: currentChatMode });
      await streamMessage({
        prompt: "Summarize from chat-id=" + chatId,
        chatId: newChatId,
        chatMode: currentChatMode,
      });
    } catch (err) {
      showError(err);
    }
  }, [appId, chatId, selectChat, currentChatMode, streamMessage]);

  return { handleSummarize };
}
