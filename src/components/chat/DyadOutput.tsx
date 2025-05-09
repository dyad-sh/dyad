import React, { useState } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  AlertTriangle,
  XCircle,
  Sparkles,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
interface DyadOutputProps {
  type: "error" | "warning";
  message?: string;
  children?: React.ReactNode;
}

export const DyadOutput: React.FC<DyadOutputProps> = ({
  type,
  message,
  children,
}) => {
  const [isContentVisible, setIsContentVisible] = useState(false);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { streamMessage } = useStreamChat();

  // If the type is not warning, it is an error (in case LLM gives a weird "type")
  const isError = type !== "warning";
  const borderColor = isError ? "border-red-500" : "border-amber-500";
  const iconColor = isError ? "text-red-500" : "text-amber-500";
  const icon = isError ? (
    <XCircle size={16} className={iconColor} />
  ) : (
    <AlertTriangle size={16} className={iconColor} />
  );
  const label = isError ? "Error" : "Warning";

  const handleAIFix = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (message && selectedChatId) {
      streamMessage({
        prompt: `Fix the error: ${message}`,
        chatId: selectedChatId,
      });
    }
  };

  return (
    <div
      className={`relative bg-(--background-lightest) hover:bg-(--background-lighter) rounded-lg px-4 py-2 border my-2 cursor-pointer min-h-18 ${borderColor}`}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      {/* Top-left label badge */}
      <div
        className={`absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${iconColor} bg-white dark:bg-gray-900`}
        style={{ zIndex: 1 }}
      >
        {icon}
        <span>{label}</span>
      </div>

      {/* Fix with AI button - always visible for errors */}
      {isError && message && (
        <div className="absolute top-9 left-2">
          <button
            onClick={handleAIFix}
            className="cursor-pointer flex items-center justify-center bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 text-white rounded text-xs p-1 w-24 h-6"
          >
            <Sparkles size={16} className="mr-1" />
            <span>Fix with AI</span>
          </button>
        </div>
      )}

      {/* Main content, padded to avoid label */}
      <div className="flex items-center justify-between pl-24 pr-6">
        <div className="flex items-center gap-2">
          {message && (
            <span className="text-gray-700 dark:text-gray-300 font-medium text-sm">
              {message.slice(0, isContentVisible ? undefined : 100) +
                (!isContentVisible ? "..." : "")}
            </span>
          )}
        </div>
        <div className="flex items-center">
          {isContentVisible ? (
            <ChevronsDownUp
              size={20}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            />
          ) : (
            <ChevronsUpDown
              size={20}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            />
          )}
        </div>
      </div>

      {/* Content area */}
      {isContentVisible && children && (
        <div className="mt-4 pl-20 text-sm text-gray-800 dark:text-gray-200">
          {children}
        </div>
      )}
    </div>
  );
};
