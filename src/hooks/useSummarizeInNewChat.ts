import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
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

  // Use ref-based mutex for synchronous race-condition protection
  // The Jotai atom guard is async, so double-clicks can both read false before first update commits
  const inFlightRef = useRef(false);

  const handleSummarizeImpl = async (chatIdForSummarize?: number) => {
    // Use synchronous ref check to prevent double-submissions within a single render frame
    if (inFlightRef.current || isSummarizing) {
      return;
    }

    // Prevent duplicate summarize clicks while in progress
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
      // Clear visual selections to prevent stale components from applying to wrong chat
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

  // Reset atom on unmount to prevent permanent lock if navigation occurs mid-summarize
  useEffect(() => {
    return () => {
      if (inFlightRef.current) {
        inFlightRef.current = false;
        setIsSummarizing(false);
      }
    };
  }, [setIsSummarizing]);

  // No-parameter version for click handlers
  const handleSummarize = () => handleSummarizeImpl();

  return {
    handleSummarize,
    isSummarizing,
    handleSummarizeWithChatId: handleSummarizeImpl,
  };
}
