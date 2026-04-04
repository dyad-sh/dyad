import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useRef } from "react";
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
import {
  selectedComponentsPreviewAtom,
  visualEditingSelectedComponentAtom,
} from "@/atoms/previewAtoms";
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
  const setSelectedComponents = useSetAtom(selectedComponentsPreviewAtom);
  const setVisualEditingSelectedComponent = useSetAtom(
    visualEditingSelectedComponentAtom,
  );
  // Ref to prevent double-submission of summarize action , which can happen due to multiple quick clicks
  const inFlightRef = useRef(false);
  const handleSummarizeImpl = async (chatIdForSummarize?: number) => {
    // Use synchronous ref check to prevent double-submissions within a single render frame
    if (inFlightRef.current || isSummarizing) {
      return;
    }
    inFlightRef.current = true;
    setIsSummarizing(true);
    const finalChatId = chatIdForSummarize ?? chatId;
    if (!appId || !finalChatId) {
      showError("Unable to summarize: missing app or chat context");
      inFlightRef.current = false;
      setIsSummarizing(false);
      return;
    }

    try {
      const newChatId = await ipc.chat.createChat(appId);
      await navigate({ to: "/chat", search: { id: newChatId } });
      setSelectedChatId(newChatId);
      addSessionOpenedChatId(newChatId);
      pushRecentViewedChatId(newChatId);
      // Clear ui state
      setChatInputValue("");
      setAttachments([]);
      setNeedsFreshPlanChat(false);
      setSelectedComponents([]);
      setVisualEditingSelectedComponent(null);
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
          inFlightRef.current = false;
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
      inFlightRef.current = false;
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
