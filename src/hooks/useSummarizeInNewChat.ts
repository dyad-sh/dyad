import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
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

export function useSummarizeInNewChat() {
  const { t } = useTranslation("chat");
  const chatId = useAtomValue(selectedChatIdAtom);
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
  const handleSummarizeImpl = async () => {
    if (inFlightRef.current || isSummarizing) {
      return;
    }
    inFlightRef.current = true;
    setIsSummarizing(true);
    if (!appId || !chatId) {
      showError(t("summarizeErrorNoContext"));
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
        prompt: "Summarize from chat-id=" + chatId,
        chatId: newChatId,
        redo: false,
        onSettled: ({ success }) => {
          inFlightRef.current = false;
          setIsSummarizing(false);

          if (success) {
            posthog.capture("chat:summarize-manual");
          }
        },
      });
    } catch (err) {
      const errorMessage = (err as Error)?.message ?? "Unknown error";
      showError(t("summarizeErrorFailed", { error: errorMessage }));
    } finally {
      inFlightRef.current = false;
      setIsSummarizing(false);
    }
  };

  const handleSummarize = () => handleSummarizeImpl();

  return {
    handleSummarize,
    isSummarizing,
  };
}
