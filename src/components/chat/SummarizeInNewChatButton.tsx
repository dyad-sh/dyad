import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { usePaneChatId } from "./ChatPaneContext";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export function useSummarizeInNewChat() {
  const chatId = usePaneChatId();
  const appId = useAtomValue(selectedAppIdAtom);
  const { streamMessage } = useStreamChat({ chatId });
  const navigate = useNavigate();
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
      // navigate to new chat
      await navigate({ to: "/chat", search: { id: newChatId } });
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
