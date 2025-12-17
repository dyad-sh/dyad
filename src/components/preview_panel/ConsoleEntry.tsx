import { MessageSquare } from "lucide-react";
import { useSetAtom } from "jotai";
import { chatInputValueAtom } from "@/atoms/chatAtoms";

interface ConsoleEntryProps {
  type: "server" | "client" | "edge-function";
  level: "info" | "warn" | "error";
  timestamp: number;
  message: string;
  sourceName?: string;
}

const formatTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", { hour12: false });
};

export const ConsoleEntryComponent = (props: ConsoleEntryProps) => {
  const { timestamp, message, sourceName, level } = props;
  const setChatInput = useSetAtom(chatInputValueAtom);

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
      className={`px-2 py-1 my-1 rounded transition-colors group ${getBackgroundClass()}`}
    >
      <div className="flex items-start gap-2">
        <span
          className="text-gray-400 shrink-0"
          title={new Date(timestamp).toLocaleString()}
        >
          {formatTimestamp(timestamp)}
        </span>
        {sourceName && (
          <span className="text-gray-500 shrink-0 text-[10px] px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">
            {sourceName}
          </span>
        )}
        <span className="flex-1">{message}</span>
        <button
          onClick={handleSendToChat}
          title="Send to chat"
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
          data-testid="send-to-chat"
        >
          <MessageSquare size={12} className="text-gray-500" />
        </button>
      </div>
    </div>
  );
};
