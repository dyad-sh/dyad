import type React from "react";
import type { Message } from "@/ipc/ipc_types";
import { forwardRef, useCallback, useState } from "react";
import ChatMessage from "./ChatMessage";
import { OpenRouterSetupBanner, SetupBanner } from "../SetupBanner";

import { useStreamChat } from "@/hooks/useStreamChat";
import {
  selectedChatIdAtom,
  chatMessagesByIdAtom,
  chatVisibleMessageIdsAtom,
} from "@/atoms/chatAtoms";
import { useAtomValue, useSetAtom } from "jotai";
import { Loader2, RefreshCw, Undo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVersions } from "@/hooks/useVersions";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { showError, showWarning } from "@/lib/toast";
import { IpcClient } from "@/ipc/ipc_client";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useSettings } from "@/hooks/useSettings";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { PromoMessage } from "./PromoMessage";
import type { MessageVersionMeta } from "@/lib/chat_branching";

interface MessagesListProps {
  messages: Message[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  versionMetaByMessageId?: Map<number, MessageVersionMeta>;
  onSelectVersion?: (stepKey: string, index: number) => void;
  chatId?: number;
}

export const MessagesList = forwardRef<HTMLDivElement, MessagesListProps>(
  function MessagesList(
    {
      messages,
      messagesEndRef,
      versionMetaByMessageId,
      onSelectVersion,
      chatId,
    },
    ref,
  ) {
    const appId = useAtomValue(selectedAppIdAtom);
    const { versions, revertVersion } = useVersions(appId);
    const { streamMessage, isStreaming } = useStreamChat();
    const { isAnyProviderSetup, isProviderSetup } = useLanguageModelProviders();
    const { settings } = useSettings();
    const setMessagesById = useSetAtom(chatMessagesByIdAtom);
    const [isUndoLoading, setIsUndoLoading] = useState(false);
    const [isRetryLoading, setIsRetryLoading] = useState(false);
    const selectedChatId = useAtomValue(selectedChatIdAtom);
    const visibleMessageIdsByChat = useAtomValue(chatVisibleMessageIdsAtom);
    const activeChatId = chatId ?? selectedChatId;
    const { userBudget } = useUserBudgetInfo();

    const handleEditMessage = useCallback(
      async ({
        message,
        newContent,
        conversationStep,
        assistantMessageId,
      }: {
        message: Message;
        newContent: string;
        conversationStep?: number;
        assistantMessageId?: number | null;
      }) => {
        if (!activeChatId) {
          throw new Error("No chat selected");
        }
        if (typeof conversationStep !== "number") {
          throw new Error("Unable to edit this message");
        }
        const selectedIds = visibleMessageIdsByChat.get(activeChatId) ?? [];
        await streamMessage({
          prompt: newContent,
          chatId: activeChatId,
          branch: {
            conversationStep,
            parentUserMessageId: message.id,
            parentAssistantMessageId: assistantMessageId ?? undefined,
            selectedMessageIds: selectedIds,
          },
        });
      },
      [activeChatId, streamMessage, visibleMessageIdsByChat],
    );

    const renderSetupBanner = () => {
      const selectedModel = settings?.selectedModel;
      if (
        selectedModel?.name === "free" &&
        selectedModel?.provider === "auto" &&
        !isProviderSetup("openrouter")
      ) {
        return <OpenRouterSetupBanner className="w-full" />;
      }
      if (!isAnyProviderSetup()) {
        return <SetupBanner />;
      }
      return null;
    };

    return (
      <div
        className="absolute inset-0 overflow-y-auto p-4"
        ref={ref}
        data-testid="messages-list"
      >
        {messages.length > 0
          ? messages.map((message, index) => {
              const versionMeta = versionMetaByMessageId?.get(message.id);
              const versionControls =
                versionMeta && onSelectVersion
                  ? {
                      totalVersions: versionMeta.totalVersions,
                      currentIndex: versionMeta.currentIndex,
                      onSelectIndex: (nextIndex: number) => {
                        const clamped = Math.max(
                          0,
                          Math.min(nextIndex, versionMeta.totalVersions - 1),
                        );
                        onSelectVersion(versionMeta.stepKey, clamped);
                      },
                    }
                  : undefined;

              const onEditMessageHandler =
                versionMeta && message.role === "user"
                  ? (editedContent: string) =>
                      handleEditMessage({
                        message,
                        newContent: editedContent,
                        conversationStep: versionMeta.conversationStep,
                        assistantMessageId:
                          versionMeta.assistantMessageId ?? undefined,
                      })
                  : undefined;

              return (
                <ChatMessage
                  key={index}
                  message={message}
                  isLastMessage={index === messages.length - 1}
                  versionControls={versionControls}
                  onEditMessage={onEditMessageHandler}
                />
              );
            })
          : !renderSetupBanner() && (
              <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto">
                <div className="flex flex-1 items-center justify-center text-gray-500">
                  No messages yet
                </div>
              </div>
            )}
        {!isStreaming && (
          <div className="flex max-w-3xl mx-auto gap-2">
            {!!messages.length &&
              messages[messages.length - 1].role === "assistant" &&
              messages[messages.length - 1].commitHash && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isUndoLoading}
                  onClick={async () => {
                    if (!activeChatId || !appId) {
                      console.error("No chat selected or app ID not available");
                      return;
                    }

                    setIsUndoLoading(true);
                    try {
                      if (messages.length >= 3) {
                        const previousAssistantMessage =
                          messages[messages.length - 3];
                        if (
                          previousAssistantMessage?.role === "assistant" &&
                          previousAssistantMessage?.commitHash
                        ) {
                          console.debug(
                            "Reverting to previous assistant version",
                          );
                          await revertVersion({
                            versionId: previousAssistantMessage.commitHash,
                          });
                          const chat =
                            await IpcClient.getInstance().getChat(activeChatId);
                          setMessagesById((prev) => {
                            const next = new Map(prev);
                            next.set(activeChatId, chat.messages);
                            return next;
                          });
                        }
                      } else {
                        const chat =
                          await IpcClient.getInstance().getChat(activeChatId);
                        if (chat.initialCommitHash) {
                          await revertVersion({
                            versionId: chat.initialCommitHash,
                          });
                          try {
                            await IpcClient.getInstance().deleteMessages(
                              activeChatId,
                            );
                            setMessagesById((prev) => {
                              const next = new Map(prev);
                              next.set(activeChatId, []);
                              return next;
                            });
                          } catch (err) {
                            showError(err);
                          }
                        } else {
                          showWarning(
                            "No initial commit hash found for chat. Need to manually undo code changes",
                          );
                        }
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
            {!!messages.length && (
              <Button
                variant="outline"
                size="sm"
                disabled={isRetryLoading}
                onClick={async () => {
                  if (!activeChatId) {
                    console.error("No chat selected");
                    return;
                  }

                  setIsRetryLoading(true);
                  try {
                    // The last message is usually an assistant, but it might not be.
                    const lastVersion = versions[0];
                    const lastMessage = messages[messages.length - 1];
                    let shouldRedo = true;
                    if (
                      lastVersion.oid === lastMessage.commitHash &&
                      lastMessage.role === "assistant"
                    ) {
                      const previousAssistantMessage =
                        messages[messages.length - 3];
                      if (
                        previousAssistantMessage?.role === "assistant" &&
                        previousAssistantMessage?.commitHash
                      ) {
                        console.debug(
                          "Reverting to previous assistant version",
                        );
                        await revertVersion({
                          versionId: previousAssistantMessage.commitHash,
                        });
                        shouldRedo = false;
                      } else {
                        const chat =
                          await IpcClient.getInstance().getChat(activeChatId);
                        if (chat.initialCommitHash) {
                          console.debug(
                            "Reverting to initial commit hash",
                            chat.initialCommitHash,
                          );
                          await revertVersion({
                            versionId: chat.initialCommitHash,
                          });
                        } else {
                          showWarning(
                            "No initial commit hash found for chat. Need to manually undo code changes",
                          );
                        }
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
                    // Need to do a redo, if we didn't delete the message from a revert.
                    const redo = shouldRedo;
                    console.debug("Streaming message with redo", redo);

                    streamMessage({
                      prompt: lastUserMessage.content,
                      chatId: activeChatId,
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
            )}
          </div>
        )}

        {isStreaming &&
          !settings?.enableDyadPro &&
          !userBudget &&
          messages.length > 0 && (
            <PromoMessage
              seed={messages.length * (appId ?? 1) * (activeChatId ?? 1)}
            />
          )}
        <div ref={messagesEndRef} />
        {renderSetupBanner()}
      </div>
    );
  },
);
