import type React from "react";
import type { Message } from "@/ipc/ipc_types";
import { forwardRef, useState } from "react";
import ChatMessage from "./ChatMessage";
import { SetupBanner } from "../SetupBanner";
import { useSettings } from "@/hooks/useSettings";
import { useStreamChat } from "@/hooks/useStreamChat";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Loader2, RefreshCw, Undo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVersions } from "@/hooks/useVersions";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { showError } from "@/lib/toast";
import { IpcClient } from "@/ipc/ipc_client";
import { chatMessagesAtom } from "@/atoms/chatAtoms";

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
    const setMessages = useSetAtom(chatMessagesAtom);
    const [isUndoLoading, setIsUndoLoading] = useState(false);
    const [isRetryLoading, setIsRetryLoading] = useState(false);

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
          <div className="flex max-w-3xl mx-auto gap-2">
            {messages[messages.length - 1].role === "assistant" && (
              <Button
                variant="outline"
                size="sm"
                disabled={isUndoLoading}
                onClick={async () => {
                  if (!selectedChatId || !appId) {
                    console.error("No chat selected or app ID not available");
                    return;
                  }
                  if (versions.length < 2) {
                    showError("Cannot undo; no previous version");
                    return;
                  }

                  setIsUndoLoading(true);
                  try {
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
                    } else {
                      // Revert to the previous version
                      await revertVersion({
                        versionId: versions[1].oid,
                      });
                    }
                    if (selectedChatId) {
                      const chat = await IpcClient.getInstance().getChat(
                        selectedChatId
                      );
                      setMessages(chat.messages);
                    }
                  } catch (error) {
                    console.error("Error during undo operation:", error);
                    showError("Failed to undo changes");
                  } finally {
                    setIsUndoLoading(false);
                  }
                }}
              >
                {isUndoLoading ? (
                  <Loader2 size={16} className="mr-1 animate-spin" />
                ) : (
                  <Undo size={16} />
                )}
                Undo
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={isRetryLoading}
              onClick={async () => {
                if (!selectedChatId) {
                  console.error("No chat selected");
                  return;
                }

                setIsRetryLoading(true);
                try {
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
                } catch (error) {
                  console.error("Error during retry operation:", error);
                  showError("Failed to retry message");
                } finally {
                  setIsRetryLoading(false);
                }
              }}
            >
              {isRetryLoading ? (
                <Loader2 size={16} className="mr-1 animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              Retry
            </Button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    );
  }
);
