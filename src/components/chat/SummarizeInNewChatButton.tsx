import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useCountTokens } from "@/hooks/useCountTokens";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";

export function useSummarizeInNewChat() {
  const chatId = useAtomValue(selectedChatIdAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const { invalidateTokenCount } = useCountTokens(null, "");
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
      const newChatId = await ipc.chat.createChat(appId);
      // navigate to new chat
      await navigate({ to: "/chat", search: { id: newChatId } });
      await streamMessage({
        prompt: "Summarize from chat-id=" + chatId,
        chatId: newChatId,
        onSettled: () => {
          // Ensure token counts are reset after summarization completes
          invalidateTokenCount();
        },
      });
    } catch (err) {
      showError(err);
    }
  };

  return { handleSummarize };
}
