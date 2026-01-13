import {
  MessageSquare,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useSetAtom } from "jotai";
import { chatInputValueAtom } from "@/atoms/chatAtoms";

interface ConsoleEntryProps {
  type:
    | "server"
    | "client"
    | "edge-function"
    | "network-requests"
    | "build-time";
  level: "info" | "warn" | "error";
  timestamp: number;
  message: string;
  sourceName?: string;
  typeFilter?: string;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

const formatTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", { hour12: false });
};

const MAX_MESSAGE_LENGTH = 300;

export const ConsoleEntryComponent = (props: ConsoleEntryProps) => {
  const {
    timestamp,
    message,
    sourceName,
    level,
    type,
    typeFilter,
    isExpanded = false,
    onToggleExpand,
  } = props;
  const setChatInput = useSetAtom(chatInputValueAtom);

  const isTruncated = message.length > MAX_MESSAGE_LENGTH;
  const displayMessage =
    isTruncated && !isExpanded
      ? message.slice(0, MAX_MESSAGE_LENGTH) + "..."
      : message;

  const handleSendToChat = () => {
    const time = new Date(timestamp).toLocaleTimeString("en-US", {
      hour12: false,
    });

    const prefix = sourceName ? `[${sourceName}]` : "";
    const formattedLog = `[${time}] ${level.toUpperCase()} ${prefix}: ${message}`;

    setChatInput((prev) => {
      return `${prev}\n\`\`\`\n${formattedLog}\n\`\`\``;
    });
  };

  // Determine styling based on log level
  const getBackgroundClass = () => {
    if (level === "error") {
      return "bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50";
    }
    if (level === "warn") {
      return "bg-yellow-50 dark:bg-yellow-950/30 hover:bg-yellow-100 dark:hover:bg-yellow-950/50";
    }
    return "hover:bg-gray-100 dark:hover:bg-gray-800";
  };

  return (
    <div
      data-testid="console-entry"
      className={`relative pr-8 px-2 py-1 my-0.5 rounded transition-colors group ${getBackgroundClass()}`}
    >
      <div className="flex items-start gap-2 flex-wrap">
        {level === "error" && (
          <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
        )}
        {level === "warn" && (
          <AlertTriangle
            size={14}
            className="text-yellow-500 shrink-0 mt-0.5"
          />
        )}
        <span
          className="text-gray-400 shrink-0"
          title={new Date(timestamp).toLocaleString()}
        >
          {formatTimestamp(timestamp)}
        </span>
        <span className="flex-1 whitespace-pre-wrap break-all">
          {sourceName && (
            <span className="text-gray-500 shrink-0 text-[10px] px-1 py-0.5 mr-2 bg-gray-200 dark:bg-gray-700 rounded">
              {sourceName}
            </span>
          )}
          {typeFilter == "all" && type && (
            <span className="text-purple-500 shrink-0 text-[10px] px-1 py-0.5 mr-2 bg-gray-200 dark:bg-gray-700 rounded">
              {type}
            </span>
          )}
          {displayMessage}
          {isTruncated && (
            <button
              onClick={onToggleExpand}
              className="ml-2 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 inline-flex items-center gap-1 text-xs"
            >
              {isExpanded ? (
                <>
                  Show less <ChevronUp size={12} />
                </>
              ) : (
                <>
                  Show more <ChevronDown size={12} />
                </>
              )}
            </button>
          )}
        </span>
      </div>
      <button
        onClick={handleSendToChat}
        title="Send to chat"
        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
        data-testid="send-to-chat"
      >
        <MessageSquare size={12} className="text-gray-500" />
      </button>
    </div>
  );
};
