import {
  SendHorizontalIcon,
  StopCircleIcon,
  FolderOpenIcon,
  XIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

import { useSettings } from "@/hooks/useSettings";
import { homeChatInputValueAtom, homeSelectedAppAtom } from "@/atoms/chatAtoms";
import { useAtom } from "jotai";
import { useState } from "react";
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
import { AuxiliaryActionsMenu } from "./AuxiliaryActionsMenu";
import { cn } from "@/lib/utils";
import { useLoadApps } from "@/hooks/useLoadApps";
import { AppSearchDialog } from "../AppSearchDialog";
import { VoiceInputButton } from "./VoiceInputButton";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { showError } from "@/lib/toast";

export function HomeChatInput({
  onSubmit,
}: {
  onSubmit: (options?: HomeSubmitOptions) => void;
}) {
  const { t } = useTranslation("home");
  const posthog = usePostHog();
  const [inputValue, setInputValue] = useAtom(homeChatInputValueAtom);
  const [selectedApp, setSelectedApp] = useAtom(homeSelectedAppAtom);
  const { settings } = useSettings();
  const { isStreaming } = useStreamChat({
    hasChatId: false,
  }); // eslint-disable-line @typescript-eslint/no-unused-vars
  useChatModeToggle();

  // Voice input appends to the draft, then sends once the transcript has
  // landed in state on the next render.
  const pendingVoiceSendRef = useRef(false);
  const handleVoiceTranscript = useCallback(
    (text: string) => {
      setInputValue((prev: string) => (prev.trim() ? prev + " " + text : text));
      pendingVoiceSendRef.current = true;
    },
    [setInputValue],
  );

  const [appSearchOpen, setAppSearchOpen] = useState(false);
  const { apps } = useLoadApps();

  // Clear selected app when the experiment flag is disabled
  useEffect(() => {
    if (!settings?.enableSelectAppFromHomeChatInput) {
      setSelectedApp(null);
    }
  }, [settings?.enableSelectAppFromHomeChatInput, setSelectedApp]);

  const placeholder = selectedApp
    ? t("homeChat.placeholderWithApp", { name: selectedApp.name })
    : t("homeChat.placeholder");

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

  const handleSelectApp = (appId: number) => {
    const app = apps.find((a) => a.id === appId);
    if (app) {
      setSelectedApp(app);
    }
    setAppSearchOpen(false);
  };

  // Custom submit function that wraps the provided onSubmit
  const handleCustomSubmit = async () => {
    if (
      (!inputValue.trim() && attachments.length === 0) ||
      isStreaming ||
      pendingFiles
    ) {
      return;
    }

    // Call the parent's onSubmit handler with attachments and selected app
    onSubmit({
      attachments,
      selectedApp: selectedApp ?? undefined,
    });

    // Clear attachments and selected app as part of submission process
    clearAttachments();
    setSelectedApp(null);
    posthog.capture("chat:home_submit", {
      chatMode: settings?.selectedChatMode,
      existingApp: !!selectedApp,
    });
  };

  // Auto-send after a voice transcript lands. The ref keeps the effect on the
  // latest submit handler without re-running each render.
  const submitRef = useRef(handleCustomSubmit);
  submitRef.current = handleCustomSubmit;
  useEffect(() => {
    if (!pendingVoiceSendRef.current) return;
    if (!inputValue.trim()) return;
    pendingVoiceSendRef.current = false;
    void submitRef.current();
  }, [inputValue]);

  if (!settings) {
    return null; // Or loading state
  }

  return (
    <>
      <div className="w-full" data-testid="home-chat-input-container">
        <div
          className={cn(
            "home-chat-input-surface jarvis-hud-surface relative flex min-h-[120px] flex-col overflow-hidden rounded-2xl sm:min-h-[132px]",
            "transition-[border-color,box-shadow] duration-200",
            "hover:border-cyan-400/35 focus-within:border-cyan-400/50",
            "focus-within:shadow-[0_0_28px_rgba(0,229,255,0.12)]",
            isDraggingOver &&
              "ring-2 ring-cyan-400/40 border-cyan-400/50 shadow-[0_0_32px_rgba(0,229,255,0.2)]",
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

          <div className="home-chat-input-editor flex min-h-[72px] flex-1 flex-col px-4 pt-4 pb-1.5 sm:px-5 sm:pt-5">
            <LexicalChatInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleCustomSubmit}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={isStreaming}
              excludeCurrentApp={false}
              submitOnEnter
              messageHistory={[]}
            />
          </div>

          <div className="home-chat-input-toolbar flex flex-col gap-2 border-t border-cyan-500/15 px-3 py-2 font-jarvis-ui sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              <AuxiliaryActionsMenu
                onFileSelect={handleFileSelect}
                hideContextFilesPicker
              />
              <ChatInputControls showContextFilesPicker={false} />
              {settings?.enableSelectAppFromHomeChatInput && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        onClick={() => setAppSearchOpen(true)}
                        className={cn(
                          "cursor-pointer rounded-lg px-2 py-1.5 text-xs font-medium transition-colors flex items-center gap-1",
                          selectedApp
                            ? "bg-primary/10 text-primary hover:bg-primary/15"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                        )}
                        data-testid="home-app-selector"
                      />
                    }
                  >
                    <FolderOpenIcon size={14} />
                    <span className="truncate max-w-[120px]">
                      {selectedApp ? selectedApp.name : t("homeChat.noApp")}
                    </span>
                    {selectedApp && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedApp(null);
                        }}
                        className="hover:bg-primary/20 rounded-sm p-0.5 transition-colors"
                        aria-label="Deselect app"
                        data-testid="home-app-selector-clear"
                      >
                        <XIcon size={12} />
                      </button>
                    )}
                  </TooltipTrigger>
                  <TooltipContent>
                    {selectedApp
                      ? t("homeChat.changeApp")
                      : t("homeChat.selectApp")}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-0.5 self-end sm:self-auto">
              <VoiceInputButton
                className="mb-0.5"
                onTranscript={handleVoiceTranscript}
                onError={(message: string) => showError(message)}
              />

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
                        disabled={
                          !inputValue.trim() && attachments.length === 0
                        }
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
          </div>
        </div>
      </div>

      {appSearchOpen && (
        <AppSearchDialog
          open={appSearchOpen}
          onOpenChange={setAppSearchOpen}
          onSelectApp={handleSelectApp}
          disableShortcut
          allApps={apps.map((a) => ({
            id: a.id,
            name: a.name,
            createdAt: a.createdAt,
            matchedChatTitle: null,
            matchedChatMessage: null,
          }))}
        />
      )}
    </>
  );
}
