import type React from "react";
import type { Message } from "@/ipc/ipc_types";
import { forwardRef } from "react";
import ChatMessage from "./ChatMessage";
import { SetupBanner } from "../SetupBanner";
import { useSettings } from "@/hooks/useSettings";
import { useStreamChat } from "@/hooks/useStreamChat";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useAtom, useAtomValue } from "jotai";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVersions } from "@/hooks/useVersions";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { showError } from "@/lib/toast";

interface MessagesListProps {
  messages: Message[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export const MessagesList = forwardRef<HTMLDivElement, MessagesListProps>(
  function MessagesList({ messages, messagesEndRef }, ref) {
    const appId = useAtomValue(selectedAppIdAtom);
    const { versions, revertVersion } = useVersions(appId);
    const { streamMessage, isStreaming, error, setError } = useStreamChat();
    const { isAnyProviderSetup } = useSettings();
    const selectedChatId = useAtomValue(selectedChatIdAtom);
    return (
      <div className="flex-1 overflow-y-auto p-4" ref={ref}>
        {messages.length > 0 ? (
          messages.map((message, index) => (
            <ChatMessage key={index} message={message} />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto">
            <div className="flex items-center justify-center h-full text-gray-500">
              No messages yet
            </div>
            {!isAnyProviderSetup() && <SetupBanner />}
          </div>
        )}
        {messages.length > 0 && !isStreaming && (
          <div className="flex max-w-3xl mx-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                if (!selectedChatId) {
                  console.error("No chat selected");
                  return;
                }
                // The last message is usually an assistant, but it might not be.
                const lastVersion = versions[0];
                const lastMessage = messages[messages.length - 1];
                let reverted = false;
                if (
                  lastVersion.oid === lastMessage.commitHash &&
                  lastMessage.role === "assistant"
                ) {
                  if (versions.length < 2) {
                    showError("Cannot retry message; no previous version");
                    return;
                  }
                  const previousAssistantMessage =
                    messages[messages.length - 3];
                  if (
                    previousAssistantMessage?.role === "assistant" &&
                    previousAssistantMessage?.commitHash
                  ) {
                    console.debug("Reverting to previous assistant version");
                    await revertVersion({
                      versionId: previousAssistantMessage.commitHash,
                    });
                    reverted = true;
                  } else {
                    console.debug("Reverting to previous version");
                    await revertVersion({
                      versionId: versions[1].oid,
                    });
                  }
                }

                // Find the last user message
                const lastUserMessage = [...messages]
                  .reverse()
                  .find((message) => message.role === "user");
                if (!lastUserMessage) {
                  console.error("No user message found");
                  return;
                }
                // If we reverted, we don't need to mark "redo" because
                // the old message has already been deleted.
                const redo = !reverted;
                console.debug("Streaming message with redo", redo);

                streamMessage({
                  prompt: lastUserMessage.content,
                  chatId: selectedChatId,
                  redo,
                });
              }}
            >
              <RefreshCw size={16} />
              Retry
            </Button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    );
  }
);
