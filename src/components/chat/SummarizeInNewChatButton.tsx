import { useAtomValue } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useSelectChat } from "@/hooks/useSelectChat";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export function useSummarizeInNewChat() {
  const chatId = useAtomValue(selectedChatIdAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const { streamMessage } = useStreamChat();
  const { selectChat } = useSelectChat();
  const queryClient = useQueryClient();

  const handleSummarize = async () => {
    if (!appId) {
      console.error("No app id found");
      return;
    }
    if (!chatId) {
      console.error("No chat id found");
      return;
    }
    try {
      const sourceChat = await ipc.chat.getChat(chatId);
      const newChatId = await ipc.chat.createChat({
        appId,
        initialChatMode: sourceChat.chatMode ?? undefined,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      selectChat({ chatId: newChatId, appId });
      await streamMessage({
        prompt: "Summarize from chat-id=" + chatId,
        chatId: newChatId,
      });
    } catch (err) {
      showError(err);
    }
  };

  return { handleSummarize };
}
