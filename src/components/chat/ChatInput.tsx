import {
  StopCircleIcon,
  X,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  AlertOctagon,
  FileText,
  Check,
  Loader2,
  Package,
  FileX,
  SendToBack,
  Database,
  ChevronsUpDown,
  ChevronsDownUp,
  ChartColumnIncreasing,
  SendHorizontalIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { useSettings } from "@/hooks/useSettings";
import { IpcClient } from "@/ipc/ipc_client";
import {
  chatInputValueAtom,
  chatMessagesAtom,
  selectedChatIdAtom,
} from "@/atoms/chatAtoms";
import { atom, useAtom, useSetAtom, useAtomValue } from "jotai";
import { useStreamChat } from "@/hooks/useStreamChat";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { Button } from "@/components/ui/button";
import { useProposal } from "@/hooks/useProposal";
import {
  ActionProposal,
  Proposal,
  SuggestedAction,
  FileChange,
  SqlQuery,
} from "@/lib/schemas";
import type { Message } from "@/ipc/ipc_types";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { useRunApp } from "@/hooks/useRunApp";
import { AutoApproveSwitch } from "../AutoApproveSwitch";
import { usePostHog } from "posthog-js/react";
import { CodeHighlight } from "./CodeHighlight";
import { TokenBar } from "./TokenBar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useNavigate } from "@tanstack/react-router";
import { useVersions } from "@/hooks/useVersions";
import { useAttachments } from "@/hooks/useAttachments";
import { AttachmentsList } from "./AttachmentsList";
import { DragDropOverlay } from "./DragDropOverlay";
import { FileAttachmentDropdown } from "./FileAttachmentDropdown";
import { showError, showExtraFilesToast } from "@/lib/toast";
import { ChatInputControls } from "../ChatInputControls";
import { ChatErrorBox } from "./ChatErrorBox";
import { selectedComponentPreviewAtom } from "@/atoms/previewAtoms";
import { SelectedComponentDisplay } from "./SelectedComponentDisplay";
import { useCheckProblems } from "@/hooks/useCheckProblems";
import { LexicalChatInput } from "./LexicalChatInput";

const showTokenBarAtom = atom(false);

export function ChatInput({ chatId }: { chatId?: number }) {
  const posthog = usePostHog();
  const [inputValue, setInputValue] = useAtom(chatInputValueAtom);
  const { settings } = useSettings();
  const appId = useAtomValue(selectedAppIdAtom);
  const { refreshVersions } = useVersions(appId);
  const { streamMessage, isStreaming, setIsStreaming, error, setError } =
    useStreamChat();
  const [showError, setShowError] = useState(true);
  const [isApproving, setIsApproving] = useState(false); // State for approving
  const [isRejecting, setIsRejecting] = useState(false); // State for rejecting
  const [, setMessages] = useAtom<Message[]>(chatMessagesAtom);
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);
  const [showTokenBar, setShowTokenBar] = useAtom(showTokenBarAtom);
  const [selectedComponent, setSelectedComponent] = useAtom(
    selectedComponentPreviewAtom,
  );
  const { checkProblems } = useCheckProblems(appId);
  // Use the attachments hook
  const {
    attachments,
    isDraggingOver,
    handleFileSelect,
    removeAttachment,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    clearAttachments,
    handlePaste,
  } = useAttachments();

  // Use the hook to fetch the proposal
  const {
    proposalResult,
    isLoading: isProposalLoading,
    error: proposalError,
    refreshProposal,
  } = useProposal(chatId);
  const { proposal, messageId } = proposalResult ?? {};

  useEffect(() => {
    if (error) {
      setShowError(true);
    }
  }, [error]);

  const fetchChatMessages = useCallback(async () => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    const chat = await IpcClient.getInstance().getChat(chatId);
    setMessages(chat.messages);
  }, [chatId, setMessages]);

  const handleSubmit = async () => {
    if (
      (!inputValue.trim() && attachments.length === 0) ||
      isStreaming ||
      !chatId
    ) {
      return;
    }

    const currentInput = inputValue;
    setInputValue("");
    setSelectedComponent(null);

    // Send message with attachments and clear them after sending
    await streamMessage({
      prompt: currentInput,
      chatId,
      attachments,
      redo: false,
      selectedComponent,
    });
    clearAttachments();
    posthog.capture("chat:submit");
  };

  const handleCancel = () => {
    if (chatId) {
      IpcClient.getInstance().cancelChatStream(chatId);
    }
    setIsStreaming(false);
  };

  const dismissError = () => {
    setShowError(false);
  };

  const handleApprove = async () => {
    if (!chatId || !messageId || isApproving || isRejecting || isStreaming)
      return;
    console.log(
      `Approving proposal for chatId: ${chatId}, messageId: ${messageId}`,
    );
    setIsApproving(true);
    posthog.capture("chat:approve");
    try {
      const result = await IpcClient.getInstance().approveProposal({
        chatId,
        messageId,
      });
      if (result.extraFiles) {
        showExtraFilesToast({
          files: result.extraFiles,
          error: result.extraFilesError,
          posthog,
        });
      }
    } catch (err) {
      console.error("Error approving proposal:", err);
      setError((err as Error)?.message || "An error occurred while approving");
    } finally {
      setIsApproving(false);
      setIsPreviewOpen(true);
      refreshVersions();
      if (settings?.enableAutoFixProblems) {
        checkProblems();
      }

      // Keep same as handleReject
      refreshProposal();
      fetchChatMessages();
    }
  };

  const handleReject = async () => {
    if (!chatId || !messageId || isApproving || isRejecting || isStreaming)
      return;
    console.log(
      `Rejecting proposal for chatId: ${chatId}, messageId: ${messageId}`,
    );
    setIsRejecting(true);
    posthog.capture("chat:reject");
    try {
      await IpcClient.getInstance().rejectProposal({
        chatId,
        messageId,
      });
    } catch (err) {
      console.error("Error rejecting proposal:", err);
      setError((err as Error)?.message || "An error occurred while rejecting");
    } finally {
      setIsRejecting(false);

      // Keep same as handleApprove
      refreshProposal();
      fetchChatMessages();
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
          isDyadProEnabled={settings.enableDyadPro ?? false}
        />
      )}
      {/* Display loading or error state for proposal */}
      {isProposalLoading && (
        <div className="p-4 text-sm text-muted-foreground">
          Loading proposal...
        </div>
      )}
      {proposalError && (
        <div className="p-4 text-sm text-red-600">
          Error loading proposal: {proposalError}
        </div>
      )}
      <div className="p-4" data-testid="chat-input-container">
        <div
          className={`relative flex flex-col border border-border rounded-lg bg-(--background-lighter) shadow-sm ${
            isDraggingOver ? "ring-2 ring-blue-500 border-blue-500" : ""
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Only render ChatInputActions if proposal is loaded */}
          {proposal &&
            proposalResult?.chatId === chatId &&
            settings.selectedChatMode !== "ask" && (
              <ChatInputActions
                proposal={proposal}
                onApprove={handleApprove}
                onReject={handleReject}
                isApprovable={
                  !isProposalLoading &&
                  !!proposal &&
                  !!messageId &&
                  !isApproving &&
                  !isRejecting &&
                  !isStreaming
                }
                isApproving={isApproving}
                isRejecting={isRejecting}
              />
            )}

          <SelectedComponentDisplay />

          {/* Use the AttachmentsList component */}
          <AttachmentsList
            attachments={attachments}
            onRemove={removeAttachment}
          />

          {/* Use the DragDropOverlay component */}
          <DragDropOverlay isDraggingOver={isDraggingOver} />

          <div className="flex items-start space-x-2 ">
            <LexicalChatInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              onPaste={handlePaste}
              placeholder="Ask Dyad to build..."
              excludeCurrentApp={true}
            />

            {isStreaming ? (
              <button
                onClick={handleCancel}
                className="px-2 py-2 mt-1 mr-1 hover:bg-(--background-darkest) text-(--sidebar-accent-fg) rounded-lg"
                title="Cancel generation"
              >
                <StopCircleIcon size={20} />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!inputValue.trim() && attachments.length === 0}
                className="px-2 py-2 mt-1 mr-1 hover:bg-(--background-darkest) text-(--sidebar-accent-fg) rounded-lg disabled:opacity-50"
                title="Send message"
              >
                <SendHorizontalIcon size={20} />
              </button>
            )}
          </div>
          <div className="pl-2 pr-1 flex items-center justify-between pb-2">
            <div className="flex items-center">
              <ChatInputControls showContextFilesPicker={true} />
              {/* File attachment dropdown */}
              <FileAttachmentDropdown
                onFileSelect={handleFileSelect}
                disabled={isStreaming}
              />
            </div>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => setShowTokenBar(!showTokenBar)}
                    variant="ghost"
                    className={`has-[>svg]:px-2 ${
                      showTokenBar ? "text-purple-500 bg-purple-100" : ""
                    }`}
                    size="sm"
                  >
                    <ChartColumnIncreasing size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {showTokenBar ? "Hide token usage" : "Show token usage"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {/* TokenBar is only displayed when showTokenBar is true */}
          {showTokenBar && <TokenBar chatId={chatId} />}
        </div>
      </div>
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
  tooltipText: string;
}) {
  const { isStreaming } = useStreamChat();
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            disabled={isStreaming}
            variant="outline"
            size="sm"
            onClick={onClick}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SummarizeInNewChatButton() {
  const chatId = useAtomValue(selectedChatIdAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const { streamMessage } = useStreamChat();
  const navigate = useNavigate();
  const onClick = async () => {
    if (!appId) {
      console.error("No app id found");
      return;
    }
    try {
      const newChatId = await IpcClient.getInstance().createChat(appId);
      // navigate to new chat
      await navigate({ to: "/chat", search: { id: newChatId } });
      await streamMessage({
        prompt: "Summarize from chat-id=" + chatId,
        chatId: newChatId,
      });
    } catch (err) {
      showError(err);
    }
  };
  return (
    <SuggestionButton
      onClick={onClick}
      tooltipText="Creating a new chat makes the AI more focused and efficient"
    >
      Summarize to new chat
    </SuggestionButton>
  );
}

function RefactorFileButton({ path }: { path: string }) {
  const chatId = useAtomValue(selectedChatIdAtom);
  const { streamMessage } = useStreamChat();
  const onClick = () => {
    if (!chatId) {
      console.error("No chat id found");
      return;
    }
    streamMessage({
      prompt: `Refactor ${path} and make it more modular`,
      chatId,
      redo: false,
    });
  };
  return (
    <SuggestionButton
      onClick={onClick}
      tooltipText="Refactor the file to improve maintainability"
    >
      <span className="max-w-[180px] overflow-hidden whitespace-nowrap text-ellipsis">
        Refactor {path.split("/").slice(-2).join("/")}
      </span>
    </SuggestionButton>
  );
}

function WriteCodeProperlyButton() {
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
      tooltipText="Write code properly (useful when AI generates the code in the wrong format)"
    >
      Write code properly
    </SuggestionButton>
  );
}

function RebuildButton() {
  const { restartApp } = useRunApp();
  const posthog = usePostHog();
  const selectedAppId = useAtomValue(selectedAppIdAtom);

  const onClick = useCallback(async () => {
    if (!selectedAppId) return;

    posthog.capture("action:rebuild");
    await restartApp({ removeNodeModules: true });
  }, [selectedAppId, posthog, restartApp]);

  return (
    <SuggestionButton onClick={onClick} tooltipText="Rebuild the application">
      Rebuild app
    </SuggestionButton>
  );
}

function RestartButton() {
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
      tooltipText="Restart the development server"
    >
      Restart app
    </SuggestionButton>
  );
}

function RefreshButton() {
  const { refreshAppIframe } = useRunApp();
  const posthog = usePostHog();

  const onClick = useCallback(() => {
    posthog.capture("action:refresh");
    refreshAppIframe();
  }, [posthog, refreshAppIframe]);

  return (
    <SuggestionButton
      onClick={onClick}
      tooltipText="Refresh the application preview"
    >
      Refresh app
    </SuggestionButton>
  );
}

function KeepGoingButton() {
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
    <SuggestionButton onClick={onClick} tooltipText="Keep going">
      Keep going
    </SuggestionButton>
  );
}

function mapActionToButton(action: SuggestedAction) {
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
    default:
      console.error(`Unsupported action: ${action.id}`);
      return (
        <Button variant="outline" size="sm" disabled key={action.id}>
          Unsupported: {action.id}
        </Button>
      );
  }
}

function ActionProposalActions({ proposal }: { proposal: ActionProposal }) {
  return (
    <div className="border-b border-border p-2 pb-0 flex items-center justify-between">
      <div className="flex items-center space-x-2 overflow-x-auto pb-2">
        {proposal.actions.map((action) => mapActionToButton(action))}
      </div>
    </div>
  );
}

interface ChatInputActionsProps {
  proposal: Proposal;
  onApprove: () => void;
  onReject: () => void;
  isApprovable: boolean; // Can be used to enable/disable buttons
  isApproving: boolean; // State for approving
  isRejecting: boolean; // State for rejecting
}

// Update ChatInputActions to accept props
function ChatInputActions({
  proposal,
  onApprove,
  onReject,
  isApprovable,
  isApproving,
  isRejecting,
}: ChatInputActionsProps) {
  const [isDetailsVisible, setIsDetailsVisible] = useState(false);

  if (proposal.type === "tip-proposal") {
    return <div>Tip proposal</div>;
  }
  if (proposal.type === "action-proposal") {
    return <ActionProposalActions proposal={proposal}></ActionProposalActions>;
  }

  // Split files into server functions and other files - only for CodeProposal
  const serverFunctions =
    proposal.filesChanged?.filter((f: FileChange) => f.isServerFunction) ?? [];
  const otherFilesChanged =
    proposal.filesChanged?.filter((f: FileChange) => !f.isServerFunction) ?? [];

  function formatTitle({
    title,
    isDetailsVisible,
  }: {
    title: string;
    isDetailsVisible: boolean;
  }) {
    if (isDetailsVisible) {
      return title;
    }
    return title.slice(0, 60) + "...";
  }

  return (
    <div className="border-b border-border">
      <div className="p-2">
        {/* Row 1: Title, Expand Icon, and Security Chip */}
        <div className="flex items-center gap-2 mb-1">
          <button
            className="flex flex-col text-left text-sm hover:bg-muted p-1 rounded justify-start w-full"
            onClick={() => setIsDetailsVisible(!isDetailsVisible)}
          >
            <div className="flex items-center">
              {isDetailsVisible ? (
                <ChevronUp size={16} className="mr-1 flex-shrink-0" />
              ) : (
                <ChevronDown size={16} className="mr-1 flex-shrink-0" />
              )}
              <span className="font-medium">
                {formatTitle({ title: proposal.title, isDetailsVisible })}
              </span>
            </div>
            <div className="text-xs text-muted-foreground ml-6">
              <ProposalSummary
                sqlQueries={proposal.sqlQueries}
                serverFunctions={serverFunctions}
                packagesAdded={proposal.packagesAdded}
                filesChanged={otherFilesChanged}
              />
            </div>
          </button>
          {proposal.securityRisks.length > 0 && (
            <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0">
              Security risks found
            </span>
          )}
        </div>

        {/* Row 2: Buttons and Toggle */}
        <div className="flex items-center justify-start space-x-2">
          <Button
            className="px-8"
            size="sm"
            variant="outline"
            onClick={onApprove}
            disabled={!isApprovable || isApproving || isRejecting}
            data-testid="approve-proposal-button"
          >
            {isApproving ? (
              <Loader2 size={16} className="mr-1 animate-spin" />
            ) : (
              <Check size={16} className="mr-1" />
            )}
            Approve
          </Button>
          <Button
            className="px-8"
            size="sm"
            variant="outline"
            onClick={onReject}
            disabled={!isApprovable || isApproving || isRejecting}
            data-testid="reject-proposal-button"
          >
            {isRejecting ? (
              <Loader2 size={16} className="mr-1 animate-spin" />
            ) : (
              <X size={16} className="mr-1" />
            )}
            Reject
          </Button>
          <div className="flex items-center space-x-1 ml-auto">
            <AutoApproveSwitch />
          </div>
        </div>
      </div>

      <div className="overflow-y-auto max-h-[calc(100vh-300px)]">
        {isDetailsVisible && (
          <div className="p-3 border-t border-border bg-muted/50 text-sm">
            {!!proposal.securityRisks.length && (
              <div className="mb-3">
                <h4 className="font-semibold mb-1">Security Risks</h4>
                <ul className="space-y-1">
                  {proposal.securityRisks.map((risk, index) => (
                    <li key={index} className="flex items-start space-x-2">
                      {risk.type === "warning" ? (
                        <AlertTriangle
                          size={16}
                          className="text-yellow-500 mt-0.5 flex-shrink-0"
                        />
                      ) : (
                        <AlertOctagon
                          size={16}
                          className="text-red-500 mt-0.5 flex-shrink-0"
                        />
                      )}
                      <div>
                        <span className="font-medium">{risk.title}:</span>{" "}
                        <span>{risk.description}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {proposal.sqlQueries?.length > 0 && (
              <div className="mb-3">
                <h4 className="font-semibold mb-1">SQL Queries</h4>
                <ul className="space-y-2">
                  {proposal.sqlQueries.map((query, index) => (
                    <SqlQueryItem key={index} query={query} />
                  ))}
                </ul>
              </div>
            )}

            {proposal.packagesAdded?.length > 0 && (
              <div className="mb-3">
                <h4 className="font-semibold mb-1">Packages Added</h4>
                <ul className="space-y-1">
                  {proposal.packagesAdded.map((pkg, index) => (
                    <li
                      key={index}
                      className="flex items-center space-x-2"
                      onClick={() => {
                        IpcClient.getInstance().openExternalUrl(
                          `https://www.npmjs.com/package/${pkg}`,
                        );
                      }}
                    >
                      <Package
                        size={16}
                        className="text-muted-foreground flex-shrink-0"
                      />
                      <span className="cursor-pointer text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
                        {pkg}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {serverFunctions.length > 0 && (
              <div className="mb-3">
                <h4 className="font-semibold mb-1">Server Functions Changed</h4>
                <ul className="space-y-1">
                  {serverFunctions.map((file: FileChange, index: number) => (
                    <li key={index} className="flex items-center space-x-2">
                      {getIconForFileChange(file)}
                      <span
                        title={file.path}
                        className="truncate cursor-default"
                      >
                        {file.name}
                      </span>
                      <span className="text-muted-foreground text-xs truncate">
                        - {file.summary}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {otherFilesChanged.length > 0 && (
              <div>
                <h4 className="font-semibold mb-1">Files Changed</h4>
                <ul className="space-y-1">
                  {otherFilesChanged.map((file: FileChange, index: number) => (
                    <li key={index} className="flex items-center space-x-2">
                      {getIconForFileChange(file)}
                      <span
                        title={file.path}
                        className="truncate cursor-default"
                      >
                        {file.name}
                      </span>
                      <span className="text-muted-foreground text-xs truncate">
                        - {file.summary}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getIconForFileChange(file: FileChange) {
  switch (file.type) {
    case "write":
      return (
        <FileText size={16} className="text-muted-foreground flex-shrink-0" />
      );
    case "rename":
      return (
        <SendToBack size={16} className="text-muted-foreground flex-shrink-0" />
      );
    case "delete":
      return (
        <FileX size={16} className="text-muted-foreground flex-shrink-0" />
      );
  }
}

// Proposal summary component to show counts of changes
function ProposalSummary({
  sqlQueries = [],
  serverFunctions = [],
  packagesAdded = [],
  filesChanged = [],
}: {
  sqlQueries?: Array<SqlQuery>;
  serverFunctions?: FileChange[];
  packagesAdded?: string[];
  filesChanged?: FileChange[];
}) {
  // If no changes, show a simple message
  if (
    !sqlQueries.length &&
    !serverFunctions.length &&
    !packagesAdded.length &&
    !filesChanged.length
  ) {
    return <span>No changes</span>;
  }

  // Build parts array with only the segments that have content
  const parts: string[] = [];

  if (sqlQueries.length) {
    parts.push(
      `${sqlQueries.length} SQL ${
        sqlQueries.length === 1 ? "query" : "queries"
      }`,
    );
  }

  if (serverFunctions.length) {
    parts.push(
      `${serverFunctions.length} Server ${
        serverFunctions.length === 1 ? "Function" : "Functions"
      }`,
    );
  }

  if (packagesAdded.length) {
    parts.push(
      `${packagesAdded.length} ${
        packagesAdded.length === 1 ? "package" : "packages"
      }`,
    );
  }

  if (filesChanged.length) {
    parts.push(
      `${filesChanged.length} ${filesChanged.length === 1 ? "file" : "files"}`,
    );
  }

  // Join all parts with separator
  return <span>{parts.join(" | ")}</span>;
}

// SQL Query item with expandable functionality
function SqlQueryItem({ query }: { query: SqlQuery }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const queryContent = query.content;
  const queryDescription = query.description;

  return (
    <li
      className="bg-(--background-lightest) hover:bg-(--background-lighter) rounded-lg px-3 py-2 border border-border cursor-pointer"
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium">
            {queryDescription || "SQL Query"}
          </span>
        </div>
        <div>
          {isExpanded ? (
            <ChevronsDownUp size={18} className="text-muted-foreground" />
          ) : (
            <ChevronsUpDown size={18} className="text-muted-foreground" />
          )}
        </div>
      </div>
      {isExpanded && (
        <div className="mt-2 text-xs max-h-[200px] overflow-auto">
          <CodeHighlight className="language-sql ">
            {queryContent}
          </CodeHighlight>
        </div>
      )}
    </li>
  );
}
