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
import { useTypingPlaceholder } from "@/hooks/useTypingPlaceholder";
import { AuxiliaryActionsMenu } from "./AuxiliaryActionsMenu";
import { cn } from "@/lib/utils";
import { useLoadApps } from "@/hooks/useLoadApps";
import { AppSearchDialog } from "../AppSearchDialog";

export function HomeChatInput({
  onSubmit,
}: {
  onSubmit: (options?: HomeSubmitOptions) => void;
}) {
  const posthog = usePostHog();
  const [inputValue, setInputValue] = useAtom(homeChatInputValueAtom);
  const [selectedApp, setSelectedApp] = useAtom(homeSelectedAppAtom);
  const { settings } = useSettings();
  const { isStreaming } = useStreamChat({
    hasChatId: false,
  }); // eslint-disable-line @typescript-eslint/no-unused-vars
  useChatModeToggle();

  const [appSearchOpen, setAppSearchOpen] = useState(false);
  const { apps } = useLoadApps();

  const typingText = useTypingPlaceholder([
    "an ecommerce store...",
    "an information page...",
    "a landing page...",
  ]);
  const placeholder = selectedApp
    ? `Send a message to ${selectedApp.name}...`
    : `Ask Dyad to build ${typingText ?? ""}`;

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
  const handleCustomSubmit = () => {
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
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      onClick={() => setAppSearchOpen(true)}
                      className={cn(
                        "cursor-pointer px-2 py-1 ml-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1",
                        selectedApp
                          ? "bg-primary/10 text-primary hover:bg-primary/15"
                          : "text-foreground/80 hover:text-foreground hover:bg-muted/60",
                      )}
                      data-testid="home-app-selector"
                    />
                  }
                >
                  <FolderOpenIcon size={14} />
                  <span className="truncate max-w-[150px]">
                    {selectedApp ? selectedApp.name : "No app selected"}
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
                    ? "Change selected app"
                    : "Select an existing app"}
                </TooltipContent>
              </Tooltip>
            </div>

            <AuxiliaryActionsMenu
              onFileSelect={handleFileSelect}
              hideContextFilesPicker
            />
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
