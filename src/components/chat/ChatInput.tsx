import {
  SendIcon,
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
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ModelPicker } from "@/components/ModelPicker";
import { useSettings } from "@/hooks/useSettings";
import { IpcClient } from "@/ipc/ipc_client";
import { chatInputValueAtom, chatMessagesAtom } from "@/atoms/chatAtoms";
import { useAtom, useSetAtom } from "jotai";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useChats } from "@/hooks/useChats";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useLoadApp } from "@/hooks/useLoadApp";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useProposal } from "@/hooks/useProposal";
import {
  CodeProposal,
  ActionProposal,
  Proposal,
  SuggestedAction,
  ProposalResult,
  FileChange,
} from "@/lib/schemas";
import type { Message } from "@/ipc/ipc_types";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { useRunApp } from "@/hooks/useRunApp";
import { AutoApproveSwitch } from "../AutoApproveSwitch";
import { usePostHog } from "posthog-js/react";
import { CodeHighlight } from "./CodeHighlight";

export function ChatInput({ chatId }: { chatId?: number }) {
  const posthog = usePostHog();
  const [inputValue, setInputValue] = useAtom(chatInputValueAtom);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { settings, updateSettings, isAnyProviderSetup } = useSettings();
  const { streamMessage, isStreaming, setIsStreaming, error, setError } =
    useStreamChat();
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const [showError, setShowError] = useState(true);
  const [isApproving, setIsApproving] = useState(false); // State for approving
  const [isRejecting, setIsRejecting] = useState(false); // State for rejecting
  const [messages, setMessages] = useAtom<Message[]>(chatMessagesAtom);
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);

  const { refreshAppIframe } = useRunApp();

  // Use the hook to fetch the proposal
  const {
    proposalResult,
    isLoading: isProposalLoading,
    error: proposalError,
    refreshProposal,
  } = useProposal(chatId);
  const { proposal, chatId: proposalChatId, messageId } = proposalResult ?? {};

  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "0px";
      const scrollHeight = textarea.scrollHeight;
      textarea.style.height = `${scrollHeight + 4}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [inputValue]);

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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (!inputValue.trim() || isStreaming || !chatId) {
      return;
    }

    const currentInput = inputValue;
    setInputValue("");
    await streamMessage({ prompt: currentInput, chatId });
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
      `Approving proposal for chatId: ${chatId}, messageId: ${messageId}`
    );
    setIsApproving(true);
    posthog.capture("chat:approve");
    try {
      const result = await IpcClient.getInstance().approveProposal({
        chatId,
        messageId,
      });
      if (result.success) {
        console.log("Proposal approved successfully");
        // TODO: Maybe refresh proposal state or show confirmation?
      } else {
        console.error("Failed to approve proposal:", result.error);
        setError(result.error || "Failed to approve proposal");
      }
    } catch (err) {
      console.error("Error approving proposal:", err);
      setError((err as Error)?.message || "An error occurred while approving");
    } finally {
      setIsApproving(false);
      setIsPreviewOpen(true);
      refreshAppIframe();

      // Keep same as handleReject
      refreshProposal();
      fetchChatMessages();
    }
  };

  const handleReject = async () => {
    if (!chatId || !messageId || isApproving || isRejecting || isStreaming)
      return;
    console.log(
      `Rejecting proposal for chatId: ${chatId}, messageId: ${messageId}`
    );
    setIsRejecting(true);
    posthog.capture("chat:reject");
    try {
      const result = await IpcClient.getInstance().rejectProposal({
        chatId,
        messageId,
      });
      if (result.success) {
        console.log("Proposal rejected successfully");
        // TODO: Maybe refresh proposal state or show confirmation?
      } else {
        console.error("Failed to reject proposal:", result.error);
        setError(result.error || "Failed to reject proposal");
      }
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
        <div className="relative mt-2 bg-red-50 border border-red-200 rounded-md shadow-sm p-2">
          <button
            onClick={dismissError}
            className="absolute top-1 left-1 p-1 hover:bg-red-100 rounded"
          >
            <X size={14} className="text-red-500" />
          </button>
          <div className="px-6 py-1 text-sm">
            <div className="text-red-700 text-wrap">{error}</div>
          </div>
        </div>
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
      <div className="p-4">
        <div className="flex flex-col border border-border rounded-lg bg-(--background-lighter) shadow-sm">
          {/* Only render ChatInputActions if proposal is loaded */}
          {proposal && proposalResult?.chatId === chatId && (
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
          <div className="flex items-start space-x-2 ">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask Dyad to build..."
              className="flex-1 p-2 focus:outline-none overflow-y-auto min-h-[40px] max-h-[200px]"
              style={{ resize: "none" }}
              disabled={isStreaming}
            />
            {isStreaming ? (
              <button
                onClick={handleCancel}
                className="px-2 py-2 mt-1 mr-2 hover:bg-(--background-darkest) text-(--sidebar-accent-fg) rounded-lg"
                title="Cancel generation"
              >
                <StopCircleIcon size={20} />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!inputValue.trim() || !isAnyProviderSetup()}
                className="px-2 py-2 mt-1 mr-2 hover:bg-(--background-darkest) text-(--sidebar-accent-fg) rounded-lg disabled:opacity-50"
              >
                <SendIcon size={20} />
              </button>
            )}
          </div>
          <div className="px-2 pb-2">
            <ModelPicker
              selectedModel={settings.selectedModel}
              onModelSelect={(model) =>
                updateSettings({ selectedModel: model })
              }
            />
          </div>
        </div>
      </div>
    </>
  );
}

function mapActionToButton(action: SuggestedAction) {
  switch (action.id) {
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
    <div className="border-b border-border p-2 flex items-center justify-between">
      <div className="flex items-center space-x-2">
        {proposal.actions.map((action) => mapActionToButton(action))}
      </div>
      <AutoApproveSwitch />
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
  const [autoApprove, setAutoApprove] = useState(false);
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

  return (
    <div className="border-b border-border">
      <div className="p-2">
        {/* Row 1: Title, Expand Icon, and Security Chip */}
        <div className="flex items-center gap-2 mb-1">
          <button
            className="flex items-center text-left text-sm font-medium hover:bg-muted p-1 rounded justify-start"
            onClick={() => setIsDetailsVisible(!isDetailsVisible)}
          >
            {isDetailsVisible ? (
              <ChevronUp size={16} className="mr-1" />
            ) : (
              <ChevronDown size={16} className="mr-1" />
            )}
            {proposal.title}
          </button>
          {proposal.securityRisks.length > 0 && (
            <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full">
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
                        `https://www.npmjs.com/package/${pkg}`
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
                    <span title={file.path} className="truncate cursor-default">
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
                    <span title={file.path} className="truncate cursor-default">
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

// SQL Query item with expandable functionality
function SqlQueryItem({ query }: { query: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <li
      className="bg-(--background-lightest) hover:bg-(--background-lighter) rounded-lg px-3 py-2 border border-border cursor-pointer"
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium">SQL Query</span>
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
          <CodeHighlight className="language-sql ">{query}</CodeHighlight>
        </div>
      )}
    </li>
  );
}
