import type { Message } from "@/ipc/ipc_types";
import {
  DyadMarkdownParser,
  VanillaMarkdownParser,
} from "./DyadMarkdownParser";
import { motion } from "framer-motion";
import { useStreamChat } from "@/hooks/useStreamChat";
import {
  CheckCircle,
  XCircle,
  Clock,
  GitCommit,
  Copy,
  Check,
  Info,
  Bot,
  Loader2,
  Pencil,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useVersions } from "@/hooks/useVersions";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { IpcClient } from "@/ipc/ipc_client";
import { useNavigate } from "@tanstack/react-router";
import { showInfo, showError } from "@/lib/toast";

interface ChatMessageProps {
  message: Message;
  isLastMessage: boolean;
}

const ChatMessage = ({ message, isLastMessage }: ChatMessageProps) => {
  const { streamMessage, isStreaming } = useStreamChat();
  const appId = useAtomValue(selectedAppIdAtom);
  const { versions: liveVersions } = useVersions(appId);

  //handle prompt edit start
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [isSaving, setIsSaving] = useState(false);
  const selectedChatId = message.chatId;
  const navigate = useNavigate();
  const handleSaveEdit = async () => {
    if (
      !selectedChatId ||
      !appId ||
      !message.id ||
      editContent.trim() === message.content.trim()
    ) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      // Update message in backend
      const result = await IpcClient.getInstance().createChatFromPromptEdit({
        appId,
        chatId: selectedChatId,
        messageId: message.id,
      });
      showInfo(
        "A new chat will continue from this edited prompt with earlier history.",
      );
      await navigate({ to: "/chat", search: { id: result.chatId } });
      await streamMessage({
        prompt: editContent.trim(),
        chatId: result.chatId,
      });
      setIsEditing(false);
    } catch (error) {
      showError;
      "Failed to save edit: " + (error as Error).message;
    } finally {
      setIsSaving(false);
    }
  };
  //handle prompt edit end
  //handle copy chat
  const { copyMessageContent, copied } = useCopyToClipboard();
  const handleCopyFormatted = async () => {
    await copyMessageContent(message.content);
  };
  // Find the version that was active when this message was sent
  const messageVersion = useMemo(() => {
    if (
      message.role === "assistant" &&
      message.commitHash &&
      liveVersions.length
    ) {
      return (
        liveVersions.find(
          (version) =>
            message.commitHash &&
            version.oid.slice(0, 7) === message.commitHash.slice(0, 7),
        ) || null
      );
    }
    return null;
  }, [message.commitHash, message.role, liveVersions]);

  // handle copy request id
  const [copiedRequestId, setCopiedRequestId] = useState(false);
  const copiedRequestIdTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    return () => {
      if (copiedRequestIdTimeoutRef.current) {
        clearTimeout(copiedRequestIdTimeoutRef.current);
      }
    };
  }, []);

  // Format the message timestamp
  const formatTimestamp = (timestamp: string | Date) => {
    const now = new Date();
    const messageTime = new Date(timestamp);
    const diffInHours =
      (now.getTime() - messageTime.getTime()) / (1000 * 60 * 60);
    if (diffInHours < 24) {
      return formatDistanceToNow(messageTime, { addSuffix: true });
    } else {
      return format(messageTime, "MMM d, yyyy 'at' h:mm a");
    }
  };

  return (
    <div
      className={`flex ${
        message.role === "assistant" ? "justify-start" : "justify-end"
      }`}
    >
      <div className={`mt-2 w-full max-w-3xl mx-auto group`}>
        <div
          className={`rounded-lg p-2 ${
            message.role === "assistant" ? "" : "ml-24 bg-(--sidebar-accent)"
          }`}
        >
          {isEditing ? (
            <div className="flex flex-col gap-2">
              <Textarea
                data-testid="chat-message-edit-textarea"
                className="w-full p-2 border rounded-md"
                value={editContent}
                autoFocus
                onChange={(event) => setEditContent(event.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditContent(message.content.trim());
                    setIsEditing(false);
                  }
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    handleSaveEdit();
                  }
                }}
              />

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  A new chat will be created with history up to this prompt.
                </span>

                <div className="flex gap-2">
                  <Button
                    className="px-2 py-1"
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setEditContent(message.content.trim());
                      setIsEditing(false);
                    }}
                    disabled={isSaving}
                  >
                    Cancel
                  </Button>

                  <Button
                    className="px-2 py-1"
                    size="sm"
                    type="button"
                    onClick={handleSaveEdit}
                    disabled={
                      isSaving ||
                      !editContent.trim() ||
                      editContent.trim() === message.content.trim()
                    }
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ) : message.role === "assistant" &&
            !message.content &&
            isStreaming &&
            isLastMessage ? (
            <div className="flex h-6 items-center space-x-2 p-2">
              <motion.div
                className="h-3 w-3 rounded-full bg-(--primary) dark:bg-blue-500"
                animate={{ y: [0, -12, 0] }}
                transition={{
                  repeat: Number.POSITIVE_INFINITY,
                  duration: 0.4,
                  ease: "easeOut",
                  repeatDelay: 1.2,
                }}
              />
              <motion.div
                className="h-3 w-3 rounded-full bg-(--primary) dark:bg-blue-500"
                animate={{ y: [0, -12, 0] }}
                transition={{
                  repeat: Number.POSITIVE_INFINITY,
                  duration: 0.4,
                  ease: "easeOut",
                  delay: 0.4,
                  repeatDelay: 1.2,
                }}
              />
              <motion.div
                className="h-3 w-3 rounded-full bg-(--primary) dark:bg-blue-500"
                animate={{ y: [0, -12, 0] }}
                transition={{
                  repeat: Number.POSITIVE_INFINITY,
                  duration: 0.4,
                  ease: "easeOut",
                  delay: 0.8,
                  repeatDelay: 1.2,
                }}
              />
            </div>
          ) : (
            <div
              className="prose dark:prose-invert prose-headings:mb-2 prose-p:my-1 prose-pre:my-0 max-w-none break-words"
              suppressHydrationWarning
            >
              {message.role === "assistant" ? (
                <>
                  <DyadMarkdownParser content={message.content} />
                  {isLastMessage && isStreaming && (
                    <div className="mt-4 ml-4 relative w-5 h-5 animate-spin">
                      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-(--primary) dark:bg-blue-500 rounded-full"></div>
                      <div className="absolute bottom-0 left-0 w-2 h-2 bg-(--primary) dark:bg-blue-500 rounded-full opacity-80"></div>
                      <div className="absolute bottom-0 right-0 w-2 h-2 bg-(--primary) dark:bg-blue-500 rounded-full opacity-60"></div>
                    </div>
                  )}
                </>
              ) : (
                <VanillaMarkdownParser content={message.content} />
              )}
            </div>
          )}
          {(message.role === "assistant" && message.content && !isStreaming) ||
          message.approvalState ? (
            <div
              className={`mt-2 flex items-center ${
                message.role === "assistant" && message.content && !isStreaming
                  ? "justify-between"
                  : ""
              } text-xs`}
            >
              {message.role === "assistant" &&
                message.content &&
                !isStreaming && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          data-testid="copy-message-button"
                          onClick={handleCopyFormatted}
                          className="flex items-center space-x-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors duration-200 cursor-pointer"
                        >
                          {copied ? (
                            <Check className="h-4 w-4 text-green-500" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                          <span className="hidden sm:inline"></span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {copied ? "Copied!" : "Copy"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              <div className="flex flex-wrap gap-2">
                {message.approvalState && (
                  <div className="flex items-center space-x-1">
                    {message.approvalState === "approved" ? (
                      <>
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span>Approved</span>
                      </>
                    ) : message.approvalState === "rejected" ? (
                      <>
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span>Rejected</span>
                      </>
                    ) : null}
                  </div>
                )}
                {message.role === "assistant" && message.model && (
                  <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 w-full sm:w-auto">
                    <Bot className="h-4 w-4 flex-shrink-0" />
                    <span>{message.model}</span>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {!isEditing && message.role === "user" && (
          <div className="flex items-center justify-end space-x-2 text-xs mt-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleCopyFormatted}
                    className="flex items-center space-x-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors duration-200 cursor-pointer"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{copied ? "Copied!" : "Copy"}</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="flex items-center space-x-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors duration-200 cursor-pointer"
                    onClick={() => setIsEditing(true)}
                    disabled={isStreaming}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Edit Message</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}

        {/* Timestamp and commit info for assistant messages - only visible on hover */}
        {message.role === "assistant" && message.createdAt && (
          <div className="mt-1 flex flex-wrap items-center justify-start space-x-2 text-xs text-gray-500 dark:text-gray-400 ">
            <div className="flex items-center space-x-1">
              <Clock className="h-3 w-3" />
              <span>{formatTimestamp(message.createdAt)}</span>
            </div>
            {messageVersion && messageVersion.message && (
              <div className="flex items-center space-x-1">
                <GitCommit className="h-3 w-3" />
                {messageVersion && messageVersion.message && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="max-w-50 truncate font-medium">
                        {
                          messageVersion.message
                            .replace(/^\[dyad\]\s*/i, "")
                            .split("\n")[0]
                        }
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{messageVersion.message}</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
            {message.requestId && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        if (!message.requestId) return;
                        navigator.clipboard
                          .writeText(message.requestId)
                          .then(() => {
                            setCopiedRequestId(true);
                            if (copiedRequestIdTimeoutRef.current) {
                              clearTimeout(copiedRequestIdTimeoutRef.current);
                            }
                            copiedRequestIdTimeoutRef.current = setTimeout(
                              () => setCopiedRequestId(false),
                              2000,
                            );
                          })
                          .catch(() => {
                            // noop
                          });
                      }}
                      className="flex items-center space-x-1 px-1 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors duration-200 cursor-pointer"
                    >
                      {copiedRequestId ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      <span className="text-xs">
                        {copiedRequestId ? "Copied" : "Request ID"}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {copiedRequestId
                      ? "Copied!"
                      : `Copy Request ID: ${message.requestId.slice(0, 8)}...`}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {isLastMessage && message.totalTokens && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center space-x-1 px-1 py-0.5">
                      <Info className="h-3 w-3" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    Max tokens used: {message.totalTokens.toLocaleString()}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatMessage;
