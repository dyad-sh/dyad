import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useCountTokens } from "@/hooks/useCountTokens";
import { useChats } from "@/hooks/useChats";
import { usePostHog } from "posthog-js/react";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";

export function useSummarizeInNewChat(overrideChatId?: number) {
  const atomChatId = useAtomValue(selectedChatIdAtom);
  const chatId = overrideChatId ?? atomChatId;
  const appId = useAtomValue(selectedAppIdAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const { invalidateTokenCount } = useCountTokens(null, "");
  const { invalidateChats } = useChats(appId);
  const posthog = usePostHog();
  const navigate = useNavigate();
  const [isSummarizing, setIsSummarizing] = useState(false);

  const handleSummarize = async () => {
    if (isSummarizing) {
      return;
    }

    if (!appId || !chatId) {
      showError("Unable to summarize: missing app or chat context");
      return;
    }

    setIsSummarizing(true);
    try {
      const newChatId = await ipc.chat.createChat(appId);
      setSelectedChatId(newChatId);

      await navigate({ to: "/chat", search: { id: newChatId } });
      await invalidateChats();

      await streamMessage({
        prompt: "Summarize from chat-id=" + chatId,
        chatId: newChatId,
        redo: false,
        onSettled: () => {
          invalidateTokenCount();
        },
      });

      posthog.capture("chat:summarize-manual");
    } catch (err) {
      showError(`Failed to summarize chat: ${(err as Error).toString()}`);
    } finally {
      setIsSummarizing(false);
    }
  };

  return { handleSummarize, isSummarizing };
}
