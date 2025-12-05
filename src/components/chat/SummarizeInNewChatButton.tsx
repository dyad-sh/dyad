import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { IpcClient } from "@/ipc/ipc_client";
import { showError } from "@/lib/toast";

export function useSummarizeInNewChat() {
  const chatId = useAtomValue(selectedChatIdAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const { streamMessage } = useStreamChat();
  const navigate = useNavigate();

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
      const newChatId = await IpcClient.getInstance().createChat(appId);
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
