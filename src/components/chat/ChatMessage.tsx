import { memo } from "react";
import type { Message } from "@/ipc/ipc_types";
import { DyadMarkdownParser } from "./DyadMarkdownParser";
import { motion } from "framer-motion";
import { useStreamChat } from "@/hooks/useStreamChat";
import { CheckCircle, XCircle } from "lucide-react";

interface ChatMessageProps {
  message: Message;
}

const ChatMessage = ({ message }: ChatMessageProps) => {
  const { isStreaming } = useStreamChat();
  return (
    <div
      className={`flex ${
        message.role === "assistant" ? "justify-start" : "justify-end"
      }`}
    >
      <div
        className={`rounded-lg p-2 mt-2 ${
          message.role === "assistant"
            ? "w-full max-w-3xl mx-auto"
            : "bg-(--sidebar-accent)"
        }`}
      >
        {message.role === "assistant" && !message.content && isStreaming ? (
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
            <DyadMarkdownParser content={message.content} />
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
    </div>
  );
};

export default ChatMessage;
