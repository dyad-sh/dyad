import type React from "react";
import type { Message } from "@/ipc/ipc_types";
import { forwardRef, useState, useMemo } from "react";
import ChatMessage from "./ChatMessage";
import { OpenRouterSetupBanner, SetupBanner } from "../SetupBanner";

import { useStreamChat } from "@/hooks/useStreamChat";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useAtomValue, useSetAtom } from "jotai";
import { Loader2, RefreshCw, Undo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVersions } from "@/hooks/useVersions";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { showError, showWarning } from "@/lib/toast";
import { IpcClient } from "@/ipc/ipc_client";
import { chatMessagesByIdAtom } from "@/atoms/chatAtoms";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useSettings } from "@/hooks/useSettings";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { PromoMessage } from "./PromoMessage";

interface MessagesListProps {
  messages: Message[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export const MessagesList = forwardRef<HTMLDivElement, MessagesListProps>(
  ({ messages, messagesEndRef }, ref) => {
    const appId = useAtomValue(selectedAppIdAtom);
    const { versions, revertVersion } = useVersions(appId);
    const { streamMessage, isStreaming } = useStreamChat();
    const { isAnyProviderSetup, isProviderSetup } = useLanguageModelProviders();
    const { settings } = useSettings();
    const setMessagesById = useSetAtom(chatMessagesByIdAtom);
    const [isUndoLoading, setIsUndoLoading] = useState(false);
    const [isRetryLoading, setIsRetryLoading] = useState(false);
    const selectedChatId = useAtomValue(selectedChatIdAtom);
    const { userBudget } = useUserBudgetInfo();

    // Helper to build tree and get visible messages
    const { tree, rootIds, rootMessages } = useMemo(() => {
      const tree: Record<number, Message[]> = {}; // parentId -> children
      const rootMessages: Message[] = [];
      messages.forEach((msg) => {
        if (msg.parentMessageId) {
          if (!tree[msg.parentMessageId]) tree[msg.parentMessageId] = [];
          tree[msg.parentMessageId].push(msg);
        } else {
          rootMessages.push(msg);
        }
      });
      // Sort children by versionNumber or createdAt
      Object.values(tree).forEach((children) => {
        children.sort(
          (a, b) => (a.versionNumber || 0) - (b.versionNumber || 0),
        );
      });

      // Sort roots too
      rootMessages.sort(
        (a, b) => (a.versionNumber || 0) - (b.versionNumber || 0),
      );
      const sortedRootIds = rootMessages.map((m) => m.id);

      return { tree, rootIds: sortedRootIds, rootMessages };
    }, [messages]);

    const [activeVersionsState, setActiveVersionsState] = useState<
      Record<number, number>
    >({});

    const visibleMessages = useMemo(() => {
      const result: Message[] = [];
      if (messages.length === 0) return result;

      const traverse = (msgId: number) => {
        const msg = messages.find((m) => m.id === msgId);
        if (!msg) return;
        result.push(msg);

        const children = tree[msgId];
        if (children && children.length > 0) {
          const selectedChildId =
            activeVersionsState[msgId] || children[children.length - 1].id;
          traverse(selectedChildId);
        }
      };

      // Only traverse the active root? Or all roots?
      // Usually only one root path is active if we branch at root.
      if (rootIds.length > 0) {
        const selectedRootId =
          activeVersionsState[-1] || rootIds[rootIds.length - 1];
        traverse(selectedRootId);
      }
      return result;
    }, [messages, tree, rootIds, activeVersionsState]);

    const setActiveVersions = setActiveVersionsState;

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
        {visibleMessages.length > 0
          ? visibleMessages.map((message, index) => {
              const parentId = message.parentMessageId;
              let versionInfo = undefined;

              // Determine siblings to calculate version info
              let siblings: Message[] = [];
              if (parentId) {
                siblings = tree[parentId] || [];
              } else {
                // Roots are siblings
                siblings = rootMessages;
              }

              if (siblings.length > 1) {
                const currentIndex =
                  siblings.findIndex((m) => m.id === message.id) + 1;
                versionInfo = {
                  current: currentIndex,
                  total: siblings.length,
                  onNext: () => {
                    if (currentIndex < siblings.length) {
                      const nextId = siblings[currentIndex].id;
                      setActiveVersions((prev) => ({
                        ...prev,
                        [parentId || -1]: nextId,
                      }));
                    }
                  },
                  onPrev: () => {
                    if (currentIndex > 1) {
                      const prevId = siblings[currentIndex - 2].id;
                      setActiveVersions((prev) => ({
                        ...prev,
                        [parentId || -1]: prevId,
                      }));
                    }
                  },
                };
              }

              return (
                <ChatMessage
                  key={index}
                  message={message}
                  isLastMessage={index === visibleMessages.length - 1}
                  versionInfo={versionInfo}
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
                    if (!selectedChatId || !appId) {
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
                            await IpcClient.getInstance().getChat(
                              selectedChatId,
                            );
                          setMessagesById((prev) => {
                            const next = new Map(prev);
                            next.set(selectedChatId, chat.messages);
                            return next;
                          });
                        }
                      } else {
                        const chat =
                          await IpcClient.getInstance().getChat(selectedChatId);
                        if (chat.initialCommitHash) {
                          await revertVersion({
                            versionId: chat.initialCommitHash,
                          });
                          try {
                            await IpcClient.getInstance().deleteMessages(
                              selectedChatId,
                            );
                            setMessagesById((prev) => {
                              const next = new Map(prev);
                              next.set(selectedChatId, []);
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
                  if (!selectedChatId) {
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
                          await IpcClient.getInstance().getChat(selectedChatId);
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
            )}
          </div>
        )}

        {isStreaming &&
          !settings?.enableDyadPro &&
          !userBudget &&
          messages.length > 0 && (
            <PromoMessage
              seed={messages.length * (appId ?? 1) * (selectedChatId ?? 1)}
            />
          )}
        <div ref={messagesEndRef} />
        {renderSetupBanner()}
      </div>
    );
  },
);
