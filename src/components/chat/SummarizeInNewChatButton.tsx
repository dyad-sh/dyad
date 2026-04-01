import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useRef, useState } from "react";
import {
  chatInputValueAtom,
  attachmentsAtom,
  needsFreshPlanChatAtom,
  selectedChatIdAtom,
} from "@/atoms/chatAtoms";
import {
  chatImageGenerationJobsAtom,
  dismissedImageGenerationJobIdsAtom,
} from "@/atoms/imageGenerationAtoms";
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
  const isSummarizingRef = useRef(false);

  const setChatInputValue = useSetAtom(chatInputValueAtom);
  const setAttachments = useSetAtom(attachmentsAtom);
  const setNeedsFreshPlanChat = useSetAtom(needsFreshPlanChatAtom);
  const chatImageJobs = useAtomValue(chatImageGenerationJobsAtom);
  const setDismissedImageJobIds = useSetAtom(
    dismissedImageGenerationJobIdsAtom,
  );

  const handleSummarize = async () => {
    if (isSummarizingRef.current) {
      return;
    }

    // Prevent duplicate summarize clicks while in progress.
    isSummarizingRef.current = true;
    setIsSummarizing(true);

    if (!appId || !chatId) {
      showError("Unable to summarize: missing app or chat context");
      isSummarizingRef.current = false;
      setIsSummarizing(false);
      return;
    }

    try {
      const newChatId = await ipc.chat.createChat(appId);
      setSelectedChatId(newChatId);

      await navigate({ to: "/chat", search: { id: newChatId } });
      await invalidateChats();

      // Draft is preserved until we successfully create and navigate to the summary chat.
      setChatInputValue("");
      setAttachments([]);
      setNeedsFreshPlanChat(false);
      setDismissedImageJobIds((prev) => {
        const next = new Set(prev);
        chatImageJobs
          .filter(
            (job) => job.status === "success" && job.targetAppId === appId,
          )
          .forEach((job) => next.add(job.id));
        return next;
      });

      await streamMessage({
        prompt: "Summarize from chat-id=" + chatId,
        chatId: newChatId,
        redo: false,
        onSettled: () => {
          invalidateTokenCount();
          isSummarizingRef.current = false;
          setIsSummarizing(false);
        },
      });

      posthog.capture("chat:summarize-manual");
    } catch (err) {
      showError(`Failed to summarize chat: ${(err as Error).toString()}`);
      isSummarizingRef.current = false;
      setIsSummarizing(false);
    }
  };

  return { handleSummarize, isSummarizing };
}
