import React, { useState } from "react";
import { AlertTriangle, XCircle, Sparkles } from "lucide-react";
import { useAtomValue } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { CopyErrorMessage } from "@/components/CopyErrorMessage";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadCardContent,
} from "./DyadCardPrimitives";

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
  const accentColor = isError ? "red" : "amber";
  const icon = isError ? <XCircle size={15} /> : <AlertTriangle size={15} />;
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
    <DyadCard
      showAccent
      accentColor={accentColor}
      onClick={() => setIsContentVisible(!isContentVisible)}
      isExpanded={isContentVisible}
    >
      <DyadCardHeader icon={icon} accentColor={accentColor}>
        <DyadBadge color={accentColor}>{label}</DyadBadge>
        {message && (
          <span className="text-sm text-foreground truncate">
            {message.slice(0, isContentVisible ? undefined : 100) +
              (!isContentVisible && message.length > 100 ? "..." : "")}
          </span>
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isContentVisible} />
        </div>
      </DyadCardHeader>

      {/* Content area */}
      <DyadCardContent isExpanded={isContentVisible}>
        {children && (
          <div className="text-sm text-muted-foreground mb-3">{children}</div>
        )}
      </DyadCardContent>

      {/* Action buttons at the bottom - always visible for errors */}
      {isError && message && (
        <div className="px-3 pb-2 flex justify-end gap-2">
          <CopyErrorMessage
            errorMessage={children ? `${message}\n${children}` : message}
          />
          <button
            onClick={handleAIFix}
            className="cursor-pointer flex items-center justify-center bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 text-white rounded-md text-xs px-2.5 py-1 h-6 transition-colors"
          >
            <Sparkles size={13} className="mr-1" />
            <span>Fix with AI</span>
          </button>
        </div>
      )}
    </DyadCard>
  );
};
