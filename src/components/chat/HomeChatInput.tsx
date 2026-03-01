import {
  SendHorizontalIcon,
  StopCircleIcon,
  Mic,
  MicOff,
  Loader2,
  Lock,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

import { useSettings } from "@/hooks/useSettings";
import { homeChatInputValueAtom } from "@/atoms/chatAtoms"; // Use a different atom for home input
import { useAtom } from "jotai";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useAttachments } from "@/hooks/useAttachments";
import { AttachmentsList } from "./AttachmentsList";
import { DragDropOverlay } from "./DragDropOverlay";
import { FileAttachmentTypeDialog } from "./FileAttachmentTypeDialog";
import { usePostHog } from "posthog-js/react";
import { HomeSubmitOptions } from "@/pages/home";
import { ChatInputControls } from "../ChatInputControls";
import { LexicalChatInput } from "./LexicalChatInput";
import { useChatModeToggle } from "@/hooks/useChatModeToggle";
import { useTypingPlaceholder } from "@/hooks/useTypingPlaceholder";
import { AuxiliaryActionsMenu } from "./AuxiliaryActionsMenu";
import { cn } from "@/lib/utils";
import { useVoiceToText } from "@/hooks/useVoiceToText";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { ipc } from "@/ipc/types";
import { useCallback } from "react";
import { showError } from "@/lib/toast";

export function HomeChatInput({
  onSubmit,
}: {
  onSubmit: (options?: HomeSubmitOptions) => void;
}) {
  const posthog = usePostHog();
  const [inputValue, setInputValue] = useAtom(homeChatInputValueAtom);
  const { settings } = useSettings();
  const { isStreaming } = useStreamChat({
    hasChatId: false,
  }); // eslint-disable-line @typescript-eslint/no-unused-vars
  useChatModeToggle();
  const { userBudget } = useUserBudgetInfo();
  const isProEnabled = !!userBudget && !!settings?.enableDyadPro;

  const handleTranscription = useCallback(
    (text: string) => {
      setInputValue((prev: string) => (prev.trim() ? prev + " " + text : text));
    },
    [setInputValue],
  );

  const { isRecording, isTranscribing, toggleRecording } = useVoiceToText({
    enabled: isProEnabled,
    onTranscription: handleTranscription,
    onError: (message) => showError(message),
  });

  const typingText = useTypingPlaceholder([
    "an ecommerce store...",
    "an information page...",
    "a landing page...",
  ]);
  const placeholder = `Ask Dyad to build ${typingText ?? ""}`;

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
    handlePaste,
    confirmPendingFiles,
    cancelPendingFiles,
  } = useAttachments();

  // Custom submit function that wraps the provided onSubmit
  const handleCustomSubmit = () => {
    if (
      (!inputValue.trim() && attachments.length === 0) ||
      isStreaming ||
      pendingFiles
    ) {
      return;
    }

    // Call the parent's onSubmit handler with attachments
    onSubmit({ attachments });

    // Clear attachments as part of submission process
    clearAttachments();
    posthog.capture("chat:home_submit", {
      chatMode: settings?.selectedChatMode,
    });
  };

  if (!settings) {
    return null; // Or loading state
  }

  return (
    <>
      <div className="p-4" data-testid="home-chat-input-container">
        <div
          className={cn(
            "relative flex flex-col border border-border rounded-2xl bg-(--background-lighter) transition-colors duration-200",
            "hover:border-primary/30",
            "focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/20",
            isDraggingOver && "ring-2 ring-blue-500 border-blue-500",
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Attachments list */}
          <AttachmentsList
            attachments={attachments}
            onRemove={removeAttachment}
          />

          {/* Drag and drop overlay */}
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
              onSubmit={handleCustomSubmit}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={isStreaming}
              excludeCurrentApp={false}
              disableSendButton={false}
              messageHistory={[]}
            />

            {/* Voice-to-text button */}
            {isProEnabled ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      onClick={toggleRecording}
                      disabled={isStreaming || isTranscribing}
                      aria-label={
                        isRecording
                          ? "Stop recording"
                          : isTranscribing
                            ? "Transcribing..."
                            : "Voice to text"
                      }
                      className={cn(
                        "px-2 py-2 mb-0.5 text-muted-foreground rounded-lg transition-colors duration-150 cursor-pointer disabled:cursor-default disabled:opacity-30",
                        isRecording &&
                          "text-red-500 hover:text-red-600 animate-pulse",
                        !isRecording && !isTranscribing && "hover:text-primary",
                      )}
                    />
                  }
                >
                  {isTranscribing ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : isRecording ? (
                    <MicOff size={20} />
                  ) : (
                    <Mic size={20} />
                  )}
                </TooltipTrigger>
                <TooltipContent>
                  {isRecording
                    ? "Stop recording"
                    : isTranscribing
                      ? "Transcribing..."
                      : "Voice to text"}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      onClick={() =>
                        ipc.system.openExternalUrl("https://dyad.sh/pro")
                      }
                      aria-label="Voice to text (Pro)"
                      className="px-2 py-2 mb-0.5 text-muted-foreground hover:text-primary rounded-lg transition-colors duration-150 cursor-pointer relative"
                    />
                  }
                >
                  <Mic size={20} />
                  <Lock size={10} className="absolute -top-0.5 -right-0.5" />
                </TooltipTrigger>
                <TooltipContent>Voice to text (requires Pro)</TooltipContent>
              </Tooltip>
            )}

            {isStreaming ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      aria-label="Cancel generation (unavailable here)"
                      className="px-2 py-2 mb-0.5 mr-1 text-muted-foreground rounded-lg opacity-50 cursor-not-allowed transition-colors duration-150"
                    />
                  }
                >
                  <StopCircleIcon size={20} />
                </TooltipTrigger>
                <TooltipContent>
                  Cancel generation (unavailable here)
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      onClick={handleCustomSubmit}
                      disabled={!inputValue.trim() && attachments.length === 0}
                      aria-label="Send message"
                      className="px-2 py-2 mb-0.5 mr-1 text-muted-foreground hover:text-primary rounded-lg transition-colors duration-150 disabled:opacity-30 disabled:hover:text-muted-foreground cursor-pointer disabled:cursor-default"
                    />
                  }
                >
                  <SendHorizontalIcon size={20} />
                </TooltipTrigger>
                <TooltipContent>Send message</TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="px-2 flex items-center justify-between pb-0.5 pt-0.5">
            <div className="flex items-center">
              <ChatInputControls showContextFilesPicker={false} />
            </div>

            <AuxiliaryActionsMenu
              onFileSelect={handleFileSelect}
              hideContextFilesPicker
            />
          </div>
        </div>
      </div>
    </>
  );
}
