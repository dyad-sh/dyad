import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  chatInputValueAtom,
  attachmentsAtom,
  needsFreshPlanChatAtom,
  selectedChatIdAtom,
  pushRecentViewedChatIdAtom,
  addSessionOpenedChatIdAtom,
  isSummarizeInProgressAtom,
} from "@/atoms/chatAtoms";
import {
  chatImageGenerationJobsAtom,
  dismissedImageGenerationJobIdsAtom,
} from "@/atoms/imageGenerationAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { usePostHog } from "posthog-js/react";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";

export function useSummarizeInNewChat(overrideChatId?: number) {
  const atomChatId = useAtomValue(selectedChatIdAtom);
  const chatId = overrideChatId ?? atomChatId;
  const appId = useAtomValue(selectedAppIdAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const pushRecentViewedChatId = useSetAtom(pushRecentViewedChatIdAtom);
  const addSessionOpenedChatId = useSetAtom(addSessionOpenedChatIdAtom);
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const posthog = usePostHog();
  const navigate = useNavigate();
  const [isSummarizing, setIsSummarizing] = useAtom(isSummarizeInProgressAtom);

  const setChatInputValue = useSetAtom(chatInputValueAtom);
  const setAttachments = useSetAtom(attachmentsAtom);
  const setNeedsFreshPlanChat = useSetAtom(needsFreshPlanChatAtom);
  const chatImageJobs = useAtomValue(chatImageGenerationJobsAtom);
  const setDismissedImageJobIds = useSetAtom(
    dismissedImageGenerationJobIdsAtom,
  );

  const handleSummarizeImpl = async (chatIdForSummarize?: number) => {
    if (isSummarizing) {
      return;
    }

    // Prevent duplicate summarize clicks while in progress.
    setIsSummarizing(true);
    const finalChatId = chatIdForSummarize ?? chatId;
    if (!appId || !finalChatId) {
      showError("Unable to summarize: missing app or chat context");
      setIsSummarizing(false);
      return;
    }

    try {
      const newChatId = await ipc.chat.createChat(appId);

      // Delay chat selection until after navigation succeeds to prevent orphaned chats
      await navigate({ to: "/chat", search: { id: newChatId } });

      // Now safe to update atoms after successful navigation
      setSelectedChatId(newChatId);
      addSessionOpenedChatId(newChatId);
      pushRecentViewedChatId(newChatId);

      // Clear draft and UI state after navigation to new summary chat.
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
        prompt: "Summarize from chat-id=" + finalChatId,
        chatId: newChatId,
        redo: false,
        onSettled: ({ success }) => {
          setIsSummarizing(false);
          // Capture event only when stream actually succeeds
          if (success) {
            posthog.capture("chat:summarize-manual");
          }
        },
      });
    } catch (err) {
      const errorMessage = (err as Error)?.message ?? "Unknown error";
      showError(`Failed to summarize chat: ${errorMessage}`);
      setIsSummarizing(false);
    }
  };

  // No-parameter version for click handlers
  const handleSummarize = () => handleSummarizeImpl();

  return {
    handleSummarize,
    isSummarizing,
    handleSummarizeWithChatId: handleSummarizeImpl,
  };
}
