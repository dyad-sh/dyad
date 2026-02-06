import type { Message } from "@/ipc/types";
import {
  DyadMarkdownParser,
  VanillaMarkdownParser,
} from "./DyadMarkdownParser";
import { useStreamChat } from "@/hooks/useStreamChat";
import { StreamingLoadingAnimation } from "./StreamingLoadingAnimation";
import {
  CheckCircle,
  XCircle,
  Clock,
  GitCommit,
  Copy,
  Check,
  Info,
  Bot,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useVersions } from "@/hooks/useVersions";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface ChatMessageProps {
  message: Message;
  isLastMessage: boolean;
}

const ChatMessage = ({ message, isLastMessage }: ChatMessageProps) => {
  const { isStreaming } = useStreamChat();
  const appId = useAtomValue(selectedAppIdAtom);
  const { versions: liveVersions } = useVersions(appId);
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
      className={`flex ${message.role === "assistant" ? "justify-start" : "justify-end"}`}
    >
      <div className={`mt-2 w-full max-w-3xl mx-auto group`}>
        <div
          className={`rounded-lg p-2 ${
            message.role === "assistant" ? "" : "ml-24 bg-(--sidebar-accent)"
          }`}
        >
          {message.role === "assistant" &&
          !message.content &&
          isStreaming &&
          isLastMessage ? (
            <StreamingLoadingAnimation variant="initial" />
          ) : (
            <div
              className="prose dark:prose-invert prose-headings:mb-2 prose-p:my-1 prose-pre:my-0 max-w-none break-words text-[15px]"
              suppressHydrationWarning
            >
              {message.role === "assistant" ? (
                <>
                  <DyadMarkdownParser content={message.content} />
                  {isLastMessage && isStreaming && (
                    <StreamingLoadingAnimation variant="streaming" />
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
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          data-testid="copy-message-button"
                          onClick={handleCopyFormatted}
                          aria-label="Copy"
                          className="flex items-center space-x-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors duration-200 cursor-pointer"
                        />
                      }
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      <span className="hidden sm:inline"></span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {copied ? "Copied!" : "Copy"}
                    </TooltipContent>
                  </Tooltip>
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
                  <span
                    className="max-w-50 truncate font-medium"
                    title={messageVersion.message}
                  >
                    {
                      messageVersion.message
                        .replace(/^\[dyad\]\s*/i, "")
                        .split("\n")[0]
                    }
                  </span>
                )}
              </div>
            )}
            {message.requestId && (
              <Tooltip>
                <TooltipTrigger
                  render={
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
                      aria-label="Copy Request ID"
                      className="flex items-center space-x-1 px-1 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors duration-200 cursor-pointer"
                    />
                  }
                >
                  {copiedRequestId ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  <span className="text-xs">
                    {copiedRequestId ? "Copied" : "Request ID"}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {copiedRequestId
                    ? "Copied!"
                    : `Copy Request ID: ${message.requestId.slice(0, 8)}...`}
                </TooltipContent>
              </Tooltip>
            )}
            {isLastMessage && message.totalTokens && (
              <div
                className="flex items-center space-x-1 px-1 py-0.5"
                title={`Max tokens used: ${message.totalTokens.toLocaleString()}`}
              >
                <Info className="h-3 w-3" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatMessage;
