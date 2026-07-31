import { StopCircleIcon, SendHorizontalIcon } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useSettings } from "@/hooks/useSettings";
import { useChatMessageCount, useChatMessages } from "@/hooks/useChatMessages";
import { ipc } from "@/ipc/types";
import {
  chatInputValuesByIdAtom,
  selectedChatIdAtom,
  agentTodosByChatIdAtom,
  needsFreshPlanChatAtom,
} from "@/atoms/chatAtoms";
import { atom, useAtom, useSetAtom, useAtomValue, useStore } from "jotai";
import { useStreamChat } from "@/hooks/useStreamChat";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { Button } from "@/components/ui/button";
import type { SuggestedAction } from "@/lib/schemas";

import { useRunApp } from "@/hooks/useRunApp";
import { usePostHog } from "posthog-js/react";
import { TokenBar } from "./TokenBar";

import { useAttachments } from "@/hooks/useAttachments";
import { AttachmentsList } from "./AttachmentsList";
import { DragDropOverlay } from "./DragDropOverlay";
import { FileAttachmentTypeDialog } from "./FileAttachmentTypeDialog";
import { showInfo } from "@/lib/toast";
import { useSummarizeInNewChat } from "./SummarizeInNewChatButton";
import { ChatInputControls } from "../ChatInputControls";
import { ChatErrorBox } from "./ChatErrorBox";
import { AgentConsentBanner } from "./AgentConsentBanner";
import { TodoList } from "./TodoList";
import { QuestionnaireInput } from "./QuestionnaireInput";
import { QueuedMessagesList } from "./QueuedMessagesList";
import {
  currentComponentCoordinatesAtom,
  pendingVisualChangesAtom,
  previewIframeRefAtom,
  selectedComponentsPreviewAtom,
  visualEditingSelectedComponentAtom,
} from "@/atoms/previewAtoms";
import { SelectedComponentsDisplay } from "./SelectedComponentDisplay";
import { LexicalChatInput } from "./LexicalChatInput";
import { AuxiliaryActionsMenu } from "./AuxiliaryActionsMenu";
import { ChatImageGenerationStrip } from "./ChatImageGenerationStrip";
import { dismissedImageGenerationJobIdsAtom } from "@/atoms/imageGenerationAtoms";
import { useChatImageGenerationJobs } from "@/image_generation/hooks";
import { ImageGeneratorDialog } from "@/components/ImageGeneratorDialog";
import { useChatModeToggle } from "@/hooks/useChatModeToggle";
import { VisualEditingChangesDialog } from "@/components/preview_panel/VisualEditingChangesDialog";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ContextLimitBanner,
  shouldShowContextLimitBanner,
} from "./ContextLimitBanner";
import { useCountTokens } from "@/hooks/useCountTokens";
import { useChats } from "@/hooks/useChats";
import { useRouter } from "@tanstack/react-router";
import { showError as showErrorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useChatMode } from "@/hooks/useChatMode";
import { useOpenPreviewIfSetupRequired } from "@/hooks/useOpenPreviewIfSetupRequired";
import { getUserInputReadModel } from "@/user_input/read_model";
import { usePendingToolConsents } from "@/user_input/hooks";
import type { PendingToolConsent } from "@/user_input/selectors";
import { useSendPreviewIframeEvent } from "@/preview_iframe/usePreviewIframe";
import {
  CHAT_PROMPT_LENGTH_LIMIT_MESSAGE,
  MAX_CHAT_PROMPT_CHARS,
} from "@/shared/chatAttachmentLimits";

const showTokenBarAtom = atom(false);

export function ChatInput({ chatId }: { chatId?: number }) {
  const { t } = useTranslation("chat");
  const posthog = usePostHog();
  const inputValuesById = useAtomValue(chatInputValuesByIdAtom);
  const setInputValuesById = useSetAtom(chatInputValuesByIdAtom);
  const inputValue = chatId ? (inputValuesById.get(chatId) ?? "") : "";
  const setInputValue = useCallback(
    (newValue: string | ((prev: string) => string)) => {
      if (!chatId) return;

      setInputValuesById((currentMap) => {
        const prev = currentMap.get(chatId) ?? "";
        const next = typeof newValue === "function" ? newValue(prev) : newValue;
        const newMap = new Map(currentMap);
        newMap.set(chatId, next);
        return newMap;
      });
    },
    [chatId, setInputValuesById],
  );
  const { settings } = useSettings();
  const {
    selectedMode: chatMode,
    storedChatMode,
    isLoading: isChatModeLoading,
  } = useChatMode(chatId);
  const appId = useAtomValue(selectedAppIdAtom);
  const openPreviewIfSetupRequired = useOpenPreviewIfSetupRequired();
  const {
    streamMessage,
    cancelStream,
    isStreaming,
    isCancellationSettling,
    error,
    queuedMessages,
    queueMessage,
    updateQueuedMessage,
    removeQueuedMessage,
    reorderQueuedMessages,
    isPaused,
    pauseQueue,
    clearPauseOnly,
    resumeQueue,
  } = useStreamChat();
  const [showError, setShowError] = useState(true);
  const [editingQueuedMessageId, setEditingQueuedMessageId] = useState<
    string | null
  >(null);
  const messages = useChatMessages(chatId);
  const messageCount = useChatMessageCount(chatId);
  const [showTokenBar, setShowTokenBar] = useAtom(showTokenBarAtom);
  const queryClient = useQueryClient();
  const toggleShowTokenBar = useCallback(() => {
    setShowTokenBar((prev) => !prev);
    queryClient.invalidateQueries({ queryKey: queryKeys.tokenCount.all });
  }, [setShowTokenBar, queryClient]);
  const [selectedComponents, setSelectedComponents] = useAtom(
    selectedComponentsPreviewAtom,
  );
  const previewIframeRef = useAtomValue(previewIframeRefAtom);
  const setVisualEditingSelectedComponent = useSetAtom(
    visualEditingSelectedComponentAtom,
  );
  const setCurrentComponentCoordinates = useSetAtom(
    currentComponentCoordinatesAtom,
  );
  const setPendingVisualChanges = useSetAtom(pendingVisualChangesAtom);
  const sendPreviewIframeEvent = useSendPreviewIframeEvent(appId);
  const store = useStore();
  const userInputReadModel = getUserInputReadModel({ store });
  const consentsForThisChat = usePendingToolConsents(chatId);
  const pendingToolConsent = consentsForThisChat[0] ?? null;

  // The read-model adapter owns optimistic hiding, rollback, and stale-request
  // reconciliation so the request snapshot retains exactly one owner.
  const decideConsent = async (
    consent: PendingToolConsent,
    decision: "accept-once" | "accept-always" | "decline",
  ) => {
    await userInputReadModel.respond(consent.requestId, {
      kind: "agent-consent",
      decision,
    });
  };

  // Get todos for this chat
  const agentTodosByChatId = useAtomValue(agentTodosByChatIdAtom);
  const chatTodos = chatId ? (agentTodosByChatId.get(chatId) ?? []) : [];
  const { refreshAppIframe } = useRunApp();
  const { navigate } = useRouter();
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const { invalidateChats } = useChats(appId);
  const [imageGeneratorOpen, setImageGeneratorOpen] = useState(false);
  const handleOpenImageGenerator = useCallback(() => {
    setImageGeneratorOpen(true);
  }, []);

  // Image generation jobs for auto-adding to chat on send
  const chatImageJobs = useChatImageGenerationJobs();
  const [dismissedImageJobIds, setDismissedImageJobIds] = useAtom(
    dismissedImageGenerationJobIdsAtom,
  );
  const visibleSuccessfulImageJobs = useMemo(() => {
    const appJobs = appId
      ? chatImageJobs.filter((job) => job.targetAppId === appId)
      : chatImageJobs;
    return appJobs.filter(
      (job) =>
        !dismissedImageJobIds.has(job.id) &&
        job.status === "success" &&
        job.result,
    );
  }, [chatImageJobs, dismissedImageJobIds, appId]);
  const hasSuccessfulImageJobs = visibleSuccessfulImageJobs.length > 0;

  // Use the attachments hook
  const {
    attachments,
    isDraggingOver,
    pendingFiles,
    handleFileSelect,
    removeAttachment,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    clearAttachments,
    replaceAttachments,
    handlePaste,
    confirmPendingFiles,
    cancelPendingFiles,
  } = useAttachments();

  useChatModeToggle();

  const disableSendButton = false;

  // Extract user message history for terminal-style navigation
  const userMessageHistory = useMemo(() => {
    return messages
      .filter((msg) => msg.role === "user")
      .map((msg) => msg.content)
      .reverse(); // Most recent first
  }, [messages]);

  const [needsFreshPlanChat, setNeedsFreshPlanChat] = useAtom(
    needsFreshPlanChatAtom,
  );

  // Detect transition to plan mode from another mode in a chat with messages
  const prevModeRef = useRef(chatMode);
  const prevModeChatIdRef = useRef(chatId);
  const hasInitializedModeRef = useRef(false);
  useEffect(() => {
    if (isChatModeLoading) return;
    if (
      !hasInitializedModeRef.current ||
      prevModeChatIdRef.current !== chatId
    ) {
      hasInitializedModeRef.current = true;
      prevModeChatIdRef.current = chatId;
      prevModeRef.current = chatMode;
      return;
    }

    const prevMode = prevModeRef.current;
    const currentMode = chatMode;
    prevModeRef.current = currentMode;

    if (prevMode && prevMode !== "plan" && currentMode === "plan") {
      if (messageCount > 0) {
        setNeedsFreshPlanChat(true);
      }
    }
  }, [
    chatMode,
    chatId,
    isChatModeLoading,
    messageCount,
    setNeedsFreshPlanChat,
  ]);

  // Token counting for context limit banner
  const { result: tokenCountResult } = useCountTokens(
    !isStreaming ? (chatId ?? null) : null,
    "",
  );

  const showBanner =
    !isStreaming &&
    tokenCountResult &&
    shouldShowContextLimitBanner({
      totalTokens: tokenCountResult.actualMaxTokens,
      contextWindow: tokenCountResult.contextWindow,
    });

  useEffect(() => {
    if (error) {
      setShowError(true);
    }
  }, [error]);

  // Attachments are cleared separately because their timing varies by path.
  const clearComposerAfterSubmit = useCallback(() => {
    setInputValue("");
    setSelectedComponents([]);
    sendPreviewIframeEvent({ type: "PICKER_DEACTIVATED" });
    setVisualEditingSelectedComponent(null);
    previewIframeRef?.contentWindow?.postMessage(
      { type: "clear-dyad-component-overlays" },
      "*",
    );
  }, [
    previewIframeRef,
    sendPreviewIframeEvent,
    setInputValue,
    setSelectedComponents,
    setVisualEditingSelectedComponent,
  ]);

  // Shared cleanup for exiting queued message editing state
  const resetEditingState = useCallback(() => {
    setEditingQueuedMessageId(null);
    clearComposerAfterSubmit();
    clearAttachments();
  }, [setEditingQueuedMessageId, clearComposerAfterSubmit, clearAttachments]);

  // Clear editing state if the edited queued message is auto-dequeued
  useEffect(() => {
    if (!editingQueuedMessageId) return;
    const stillInQueue = queuedMessages.some(
      (m) => m.id === editingQueuedMessageId,
    );
    if (!stillInQueue) {
      resetEditingState();
    }
  }, [editingQueuedMessageId, queuedMessages, resetEditingState]);

  // Track editing state in a ref for unmount cleanup
  const editingQueuedMessageIdRef = useRef(editingQueuedMessageId);
  editingQueuedMessageIdRef.current = editingQueuedMessageId;

  // Clear editing extras on unmount to avoid leaking state across navigations
  useEffect(() => {
    return () => {
      if (editingQueuedMessageIdRef.current) {
        clearAttachments();
        setSelectedComponents([]);
        setVisualEditingSelectedComponent(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-clear pause state when queue becomes empty (Users expect that deleting
  // all queued messages returns them to normal send mode). Keep the Stop latch
  // until cancellation settles so a late submission admitted by the stream
  // machine cannot land in an unpaused queue.

  useEffect(() => {
    if (
      chatId &&
      isPaused &&
      queuedMessages.length === 0 &&
      !isCancellationSettling
    ) {
      clearPauseOnly();
    }
  }, [
    chatId,
    isPaused,
    queuedMessages.length,
    isCancellationSettling,
    clearPauseOnly,
  ]);

  // Queue management handlers
  const handleEditQueuedMessage = useCallback(
    (id: string) => {
      const msg = queuedMessages.find((m) => m.id === id);
      if (!msg) return;
      // Auto-save current edits if switching between queued messages
      if (editingQueuedMessageId && editingQueuedMessageId !== id) {
        updateQueuedMessage(editingQueuedMessageId, {
          prompt: inputValue,
          attachments,
          selectedComponents,
        });
      }
      // Load the message content into the input
      setInputValue(msg.prompt);
      // Restore attachments from the queued message.
      replaceAttachments(msg.attachments ?? []);
      setSelectedComponents(msg.selectedComponents ?? []);
      sendPreviewIframeEvent({ type: "SELECTION_RESTORE_QUEUED" });
      setVisualEditingSelectedComponent(null);
      // Set editing mode
      setEditingQueuedMessageId(id);
    },
    [
      queuedMessages,
      editingQueuedMessageId,
      inputValue,
      attachments,
      selectedComponents,
      setInputValue,
      replaceAttachments,
      setSelectedComponents,
      setVisualEditingSelectedComponent,
      sendPreviewIframeEvent,
      updateQueuedMessage,
    ],
  );

  const handleMoveUp = useCallback(
    (id: string) => {
      const index = queuedMessages.findIndex((m) => m.id === id);
      if (index > 0) {
        reorderQueuedMessages(index, index - 1);
      }
    },
    [queuedMessages, reorderQueuedMessages],
  );

  const handleMoveDown = useCallback(
    (id: string) => {
      const index = queuedMessages.findIndex((m) => m.id === id);
      if (index >= 0 && index < queuedMessages.length - 1) {
        reorderQueuedMessages(index, index + 1);
      }
    },
    [queuedMessages, reorderQueuedMessages],
  );

  const handleDeleteQueuedMessage = useCallback(
    (id: string) => {
      // Clear editing state if deleting the message being edited
      if (editingQueuedMessageId === id) {
        resetEditingState();
      }
      return removeQueuedMessage(id);
    },
    [editingQueuedMessageId, removeQueuedMessage, resetEditingState],
  );

  const handleSubmit = async () => {
    if (
      (!inputValue.trim() &&
        attachments.length === 0 &&
        !hasSuccessfulImageJobs) ||
      !chatId ||
      pendingFiles
    ) {
      return;
    }

    // Build prompt with auto-added image mentions
    const imageMentions = visibleSuccessfulImageJobs
      .map((job) => `@media:${encodeURIComponent(job.result!.fileName)}`)
      .join(" ");
    const promptWithImages = inputValue.trim()
      ? imageMentions
        ? `${inputValue} ${imageMentions}`
        : inputValue
      : imageMentions;

    if (promptWithImages.length > MAX_CHAT_PROMPT_CHARS) {
      showErrorToast(CHAT_PROMPT_LENGTH_LIMIT_MESSAGE);
      return;
    }

    // Dismiss image jobs that were auto-added
    if (visibleSuccessfulImageJobs.length > 0) {
      setDismissedImageJobIds((prev) => {
        const next = new Set(prev);
        for (const job of visibleSuccessfulImageJobs) {
          next.add(job.id);
        }
        return next;
      });
    }

    // If switching to plan mode from another mode in a chat with messages,
    // create a new chat for a clean context.
    if (needsFreshPlanChat && chatMode === "plan" && appId) {
      clearComposerAfterSubmit();
      setNeedsFreshPlanChat(false);

      const newChatId = await ipc.chat.createChat({
        appId,
        initialChatMode: "plan",
      });
      setSelectedChatId(newChatId);
      navigate({ to: "/chat", search: { id: newChatId } });
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      showInfo("We've switched you to a new chat for a clean context");

      void openPreviewIfSetupRequired(appId);
      await streamMessage({
        prompt: promptWithImages,
        chatId: newChatId,
        attachments,
        redo: false,
        requestedChatMode: "plan",
      });
      clearAttachments();
      posthog.capture("chat:submit", { chatMode });
      return;
    }

    const currentInput = promptWithImages;
    const componentsToSend = selectedComponents;

    // Handle editing a queued message
    if (editingQueuedMessageId) {
      updateQueuedMessage(editingQueuedMessageId, {
        prompt: currentInput,
        attachments,
        selectedComponents: componentsToSend,
      });
      resetEditingState();
      return;
    }

    // Queue while actively streaming. If we're paused but currently idle,
    // send the new message immediately and keep existing queued items paused.
    if (isStreaming) {
      const queued = queueMessage({
        prompt: currentInput,
        attachments,
        selectedComponents: componentsToSend,
      });
      if (queued) {
        // Only clear input, attachments, and components on successful queue
        clearComposerAfterSubmit();
        clearAttachments();
      }
      // If queue failed, leave input/attachments intact for the user
      return;
    }

    // Not streaming - send immediately
    // Clear input and components before sending
    clearComposerAfterSubmit();

    // Send message with attachments and clear them after sending
    void openPreviewIfSetupRequired(appId);
    await streamMessage({
      prompt: currentInput,
      chatId,
      attachments,
      redo: false,
      selectedComponents: componentsToSend,
      requestedChatMode: isChatModeLoading ? null : storedChatMode,
    });
    clearAttachments();
    posthog.capture("chat:submit", { chatMode });
  };

  const handleCancel = () => {
    // Stopping is non-destructive: queued prompts are parked, never deleted.
    // `isPaused` is a transient latch (resuming, an emptied queue, or a
    // step-limit continue all clear it), so it can be false while the user
    // still has prompts they care about queued — deleting them here silently
    // lost work, including the queue restored (paused) after a restart.
    //
    // Latch unconditionally rather than gating on `queuedMessages`: that is a
    // render-time snapshot, and the machine can admit a follow-up into the live
    // queue after it. Skipping the latch on a stale empty snapshot would let
    // finalization dispatch that item, so Stop would start a new generation.
    // A latch with a genuinely empty queue is harmless — the empty-queue effect
    // above clears it after cancellation settles.
    // Always reset editing state when cancelling, regardless of pause state
    if (editingQueuedMessageId) {
      resetEditingState();
    }
    // Enter the authoritative cancelling state before publishing the pause
    // latch. This prevents the empty-queue effect from observing the latch
    // without also observing that cancellation is settling.
    if (chatId) {
      // The stream machine reconciles the cancel with the real terminal
      // event (including cancels fired before main registered the stream).
      cancelStream();
    }
    // Do NOT reset pause state here; queued messages should remain paused after stopping
    if (!isPaused) {
      pauseQueue();
    }
  };

  const dismissError = () => {
    setShowError(false);
  };

  const handleNewChat = async () => {
    if (appId) {
      try {
        const newChatId = await ipc.chat.createChat({ appId });
        setSelectedChatId(newChatId);
        navigate({
          to: "/chat",
          search: { id: newChatId },
        });
        await invalidateChats();
      } catch (err) {
        showErrorToast(
          `Failed to create new chat: ${(err as Error).toString()}`,
        );
      }
    } else {
      navigate({ to: "/" });
    }
  };

  if (!settings) {
    return null; // Or loading state
  }

  return (
    <>
      {error && showError && (
        <ChatErrorBox
          onDismiss={dismissError}
          error={error}
          onStartNewChat={handleNewChat}
        />
      )}
      <div className="p-2 pt-0" data-testid="chat-input-container">
        {/* Show context limit banner above chat input for visibility */}
        {showBanner && tokenCountResult && (
          <ContextLimitBanner
            totalTokens={tokenCountResult.actualMaxTokens}
            contextWindow={tokenCountResult.contextWindow}
          />
        )}
        <div
          className={cn(
            "relative flex flex-col border border-border rounded-2xl bg-(--background-lighter) transition-colors duration-200",
            "focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/20",
            isDraggingOver && "ring-2 ring-blue-500 border-blue-500",
            showBanner && "rounded-t-none border-t-0",
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Show active questionnaire if exists */}
          <QuestionnaireInput />

          {/* Show todo list if there are todos for this chat */}
          {chatTodos.length > 0 && <TodoList todos={chatTodos} />}
          {/* Show consent banner if there's a pending consent request */}
          {pendingToolConsent && (
            <AgentConsentBanner
              consent={pendingToolConsent}
              queueTotal={consentsForThisChat.length}
              onDecision={(decision) =>
                decideConsent(pendingToolConsent, decision)
              }
              onClose={() => decideConsent(pendingToolConsent, "decline")}
            />
          )}
          {/* Show queued messages list */}
          {queuedMessages.length > 0 && (
            <QueuedMessagesList
              messages={queuedMessages}
              onEdit={handleEditQueuedMessage}
              onDelete={handleDeleteQueuedMessage}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              isStreaming={isStreaming}
              hasError={!!error}
              isPaused={isPaused}
              onPauseQueue={pauseQueue}
              onResumeQueue={resumeQueue}
            />
          )}
          {/* Show editing indicator when editing a queued message */}
          {editingQueuedMessageId && (
            <div className="border-b border-border p-2 bg-yellow-500/10 flex items-center justify-between">
              <span className="text-sm text-yellow-700 dark:text-yellow-400">
                Editing queued message
              </span>
              <button
                type="button"
                onClick={() => resetEditingState()}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
          <VisualEditingChangesDialog
            onReset={() => {
              setSelectedComponents([]);
              sendPreviewIframeEvent({ type: "PICKER_DEACTIVATED" });
              setVisualEditingSelectedComponent(null);
              setCurrentComponentCoordinates(null);
              setPendingVisualChanges(new Map());
              refreshAppIframe();
            }}
          />

          <SelectedComponentsDisplay />

          {/* Use the AttachmentsList component */}
          <AttachmentsList
            attachments={attachments}
            onRemove={removeAttachment}
          />

          {/* Chat image generation strip */}
          <ChatImageGenerationStrip
            onGenerateImage={handleOpenImageGenerator}
          />

          {/* Use the DragDropOverlay component */}
          <DragDropOverlay isDraggingOver={isDraggingOver} />

          {/* Dialog for choosing attachment type */}
          <FileAttachmentTypeDialog
            pendingFiles={pendingFiles}
            onConfirm={confirmPendingFiles}
            onCancel={cancelPendingFiles}
          />

          <div className="flex items-end gap-1">
            <LexicalChatInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              onPaste={handlePaste}
              placeholder={t("sendMessage")}
              excludeCurrentApp={true}
              disableSendButton={disableSendButton}
              messageHistory={userMessageHistory}
            />

            {isStreaming ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      onClick={handleCancel}
                      aria-label={t("cancelGeneration")}
                      className="px-2 py-2 mb-0.5 mr-1 text-muted-foreground hover:text-destructive rounded-lg transition-colors duration-150 cursor-pointer"
                    />
                  }
                >
                  <StopCircleIcon size={20} />
                </TooltipTrigger>
                <TooltipContent>{t("cancelGeneration")}</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      onClick={handleSubmit}
                      disabled={
                        (!inputValue.trim() &&
                          attachments.length === 0 &&
                          !hasSuccessfulImageJobs) ||
                        disableSendButton
                      }
                      aria-label={t("sendMessage")}
                      className="px-2 py-2 mb-0.5 mr-1 text-muted-foreground hover:text-primary rounded-lg transition-colors duration-150 disabled:opacity-30 disabled:hover:text-muted-foreground cursor-pointer disabled:cursor-default"
                    />
                  }
                >
                  <SendHorizontalIcon size={20} />
                </TooltipTrigger>
                <TooltipContent>{t("sendMessage")}</TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="px-2 flex items-center justify-between pb-0.5 pt-0.5">
            <div className="flex items-center">
              <ChatInputControls showContextFilesPicker={false} />
            </div>

            <AuxiliaryActionsMenu
              onFileSelect={handleFileSelect}
              showTokenBar={showTokenBar}
              toggleShowTokenBar={toggleShowTokenBar}
              appId={appId ?? undefined}
              onGenerateImage={handleOpenImageGenerator}
            />
          </div>
          {/* TokenBar is only displayed when showTokenBar is true */}
          {showTokenBar && <TokenBar chatId={chatId} />}
        </div>
      </div>

      {/* Image Generator Dialog */}
      <ImageGeneratorDialog
        open={imageGeneratorOpen}
        onOpenChange={setImageGeneratorOpen}
        defaultAppId={appId ?? undefined}
        source="chat"
      />
    </>
  );
}

function SuggestionButton({
  children,
  onClick,
  tooltipText,
}: {
  onClick: () => void;
  children: React.ReactNode;
  tooltipText: string | string[];
}) {
  const { isStreaming } = useStreamChat();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            disabled={isStreaming}
            variant="outline"
            size="sm"
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {Array.isArray(tooltipText)
          ? tooltipText.map((line) => <div key={line}>{line}</div>)
          : tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}

function SummarizeInNewChatButton() {
  const { t } = useTranslation("chat");
  const { handleSummarize } = useSummarizeInNewChat();
  return (
    <SuggestionButton
      onClick={handleSummarize}
      tooltipText={t("summarizeNewChatTip")}
    >
      {t("summarizeToNewChat")}
    </SuggestionButton>
  );
}

function RefactorFileButton({ path }: { path: string }) {
  const { t } = useTranslation("chat");
  const chatId = useAtomValue(selectedChatIdAtom);
  const { streamMessage } = useStreamChat();
  const onClick = () => {
    if (!chatId) {
      console.error("No chat id found");
      return;
    }
    streamMessage({
      prompt: t("refactorFile", { path }),
      chatId,
      redo: false,
    });
  };
  return (
    <SuggestionButton
      onClick={onClick}
      tooltipText={[t("refactorDescription"), path]}
    >
      <span className="max-w-[180px] overflow-hidden whitespace-nowrap text-ellipsis">
        {t("refactorFile", { path: path.split("/").slice(-2).join("/") })}
      </span>
    </SuggestionButton>
  );
}

function WriteCodeProperlyButton() {
  const { t } = useTranslation("chat");
  const chatId = useAtomValue(selectedChatIdAtom);
  const { streamMessage } = useStreamChat();
  const onClick = () => {
    if (!chatId) {
      console.error("No chat id found");
      return;
    }
    streamMessage({
      prompt: `Write the code in the previous message in the correct format using \`<dyad-write>\` tags!`,
      chatId,
      redo: false,
    });
  };
  return (
    <SuggestionButton
      onClick={onClick}
      tooltipText={t("writeCodeProperlyDescription")}
    >
      {t("writeCodeProperly")}
    </SuggestionButton>
  );
}

function RebuildButton() {
  const { t } = useTranslation("chat");
  const { restartApp } = useRunApp();
  const posthog = usePostHog();
  const selectedAppId = useAtomValue(selectedAppIdAtom);

  const onClick = useCallback(async () => {
    if (!selectedAppId) return;

    posthog.capture("action:rebuild");
    await restartApp({ removeNodeModules: true });
  }, [selectedAppId, posthog, restartApp]);

  return (
    <SuggestionButton
      onClick={onClick}
      tooltipText={t("rebuildAppDescription")}
    >
      {t("rebuildApp")}
    </SuggestionButton>
  );
}

function RestartButton() {
  const { t } = useTranslation("chat");
  const { restartApp } = useRunApp();
  const posthog = usePostHog();
  const selectedAppId = useAtomValue(selectedAppIdAtom);

  const onClick = useCallback(async () => {
    if (!selectedAppId) return;

    posthog.capture("action:restart");
    await restartApp();
  }, [selectedAppId, posthog, restartApp]);

  return (
    <SuggestionButton
      onClick={onClick}
      tooltipText={t("restartAppDescription")}
    >
      {t("restartApp")}
    </SuggestionButton>
  );
}

function RefreshButton() {
  const { t } = useTranslation("chat");
  const { refreshAppIframe } = useRunApp();
  const posthog = usePostHog();

  const onClick = useCallback(() => {
    posthog.capture("action:refresh");
    refreshAppIframe();
  }, [posthog, refreshAppIframe]);

  return (
    <SuggestionButton
      onClick={onClick}
      tooltipText={t("refreshAppDescription")}
    >
      {t("refreshApp")}
    </SuggestionButton>
  );
}

function KeepGoingButton() {
  const { t } = useTranslation("chat");
  const { streamMessage } = useStreamChat();
  const chatId = useAtomValue(selectedChatIdAtom);
  const onClick = () => {
    if (!chatId) {
      console.error("No chat id found");
      return;
    }
    streamMessage({
      prompt: "Keep going",
      chatId,
    });
  };
  return (
    <SuggestionButton onClick={onClick} tooltipText={t("keepGoing")}>
      {t("keepGoing")}
    </SuggestionButton>
  );
}

function AddTypeScriptButton() {
  const { t } = useTranslation("chat");
  const { streamMessage } = useStreamChat();
  const chatId = useAtomValue(selectedChatIdAtom);
  const onClick = () => {
    if (!chatId) {
      console.error("No chat id found");
      return;
    }
    streamMessage({
      prompt:
        "Add TypeScript to this project: install `typescript` as a dev dependency and create a lenient tsconfig (`allowJs: true`, `strict: false`) so existing JavaScript keeps working.",
      chatId,
    });
  };
  return (
    <SuggestionButton onClick={onClick} tooltipText={t("addTypeScript")}>
      {t("addTypeScript")}
    </SuggestionButton>
  );
}

export function mapActionToButton(action: SuggestedAction) {
  switch (action.id) {
    case "summarize-in-new-chat":
      return <SummarizeInNewChatButton />;
    case "refactor-file":
      return <RefactorFileButton path={action.path} />;
    case "write-code-properly":
      return <WriteCodeProperlyButton />;
    case "rebuild":
      return <RebuildButton />;
    case "restart":
      return <RestartButton />;
    case "refresh":
      return <RefreshButton />;
    case "keep-going":
      return <KeepGoingButton />;
    case "add-typescript":
      return <AddTypeScriptButton />;
    default:
      console.error(`Unsupported action: ${action.id}`);
      return (
        <Button variant="outline" size="sm" disabled key={action.id}>
          Unsupported: {action.id}
        </Button>
      );
  }
}
