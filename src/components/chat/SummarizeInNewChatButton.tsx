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
  const defaultChatMode = useInitialChatMode() ?? "build";

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
      // Fetch source chat to get its persisted mode instead of using global default
      let sourceChatMode = defaultChatMode;
      try {
        const sourceChat = await ipc.chat.getChat(chatId);
        sourceChatMode = sourceChat.chatMode ?? defaultChatMode;
      } catch (err) {
        console.error(
          "Failed to fetch source chat mode, falling back to default:",
          err,
        );
        // Use default mode if fetch fails
      }

      const newChatId = await ipc.chat.createChat({
        appId,
        initialChatMode: sourceChatMode,
      });
      // Use selectChat to ensure mode is synced properly
      selectChat({ chatId: newChatId, appId, chatMode: sourceChatMode });
      await streamMessage({
        prompt: "Summarize from chat-id=" + chatId,
        chatId: newChatId,
        chatMode: sourceChatMode,
      });
    } catch (err) {
      showError(err);
    }
  }, [appId, chatId, selectChat, defaultChatMode, streamMessage]);

  return { handleSummarize };
}
