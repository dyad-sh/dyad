import type { Message } from "@/ipc/ipc_types";
import {
  DyadMarkdownParser,
  VanillaMarkdownParser,
} from "./DyadMarkdownParser";
import { motion } from "framer-motion";
import { useStreamChat } from "@/hooks/useStreamChat";
import { CheckCircle, XCircle, Clock, GitCommit } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useVersions } from "@/hooks/useVersions";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useMemo } from "react";

interface ChatMessageProps {
  message: Message;
  isLastMessage: boolean;
}

const ChatMessage = ({ message, isLastMessage }: ChatMessageProps) => {
  const { isStreaming } = useStreamChat();
  const appId = useAtomValue(selectedAppIdAtom);
  const { versions: liveVersions } = useVersions(appId);
  // Find the version that was active when this message was sent
  const messageVersion = useMemo(() => {
    if (!liveVersions.length || !message.createdAt) return null;
    const messageTimestamp = new Date(message.createdAt).getTime() / 1000; // Convert to Unix timestamp to compare with version timestamps
    if (message.role === "user") {
      const sortedVersions = [...liveVersions].sort(
        (a, b) => b.timestamp - a.timestamp,
      );
      return (
        sortedVersions.find(
          (version) => version.timestamp <= messageTimestamp,
        ) || null
      );
    }
  }, [message.commitHash, message.role, message.createdAt, liveVersions]);

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
          {message.role === "assistant" &&
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
              className="prose dark:prose-invert prose-headings:mb-2 prose-p:my-1 prose-pre:my-0 max-w-none"
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
          {message.approvalState && (
            <div className="mt-2 flex items-center justify-end space-x-1 text-xs">
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
        </div>
        {/* Timestamp and commit info for user messages - only visible on hover */}
        {message.role === "user" && message.createdAt && (
          <div className="mt-1 flex items-center justify-end space-x-2 text-xs text-gray-500 dark:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="flex items-center space-x-1">
              <Clock className="h-3 w-3" />
              <span>{formatTimestamp(message.createdAt)}</span>
            </div>
            {messageVersion && messageVersion.message && (
              <div className="flex items-center space-x-1">
                <GitCommit className="h-3 w-3" />
                <span className="max-w-28 truncate font-medium">
                  {
                    messageVersion.message
                      .replace(/^\[dyad\]\s*/i, "")
                      .split("\n")[0]
                  }
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatMessage;
