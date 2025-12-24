import React from "react";
import type { Message } from "@/ipc/ipc_types";
import { forwardRef, useState, useCallback, useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
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
import { ContextLimitBanner } from "./ContextLimitBanner";
import { useCountTokens } from "@/hooks/useCountTokens";

interface MessagesListProps {
  messages: Message[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

// Memoize ChatMessage at module level to prevent recreation on every render
const MemoizedChatMessage = React.memo(ChatMessage);

// Context type for Virtuoso
interface FooterContext {
  messages: Message[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  isStreaming: boolean;
  tokenCountResult: ReturnType<typeof useCountTokens>["result"];
  isUndoLoading: boolean;
  isRetryLoading: boolean;
  setIsUndoLoading: (loading: boolean) => void;
  setIsRetryLoading: (loading: boolean) => void;
  versions: ReturnType<typeof useVersions>["versions"];
  revertVersion: ReturnType<typeof useVersions>["revertVersion"];
  streamMessage: ReturnType<typeof useStreamChat>["streamMessage"];
  selectedChatId: number | null;
  appId: number | null;
  setMessagesById: ReturnType<typeof useSetAtom<typeof chatMessagesByIdAtom>>;
  settings: ReturnType<typeof useSettings>["settings"];
  userBudget: ReturnType<typeof useUserBudgetInfo>["userBudget"];
  renderSetupBanner: () => React.ReactNode;
}

// Footer component for Virtuoso - receives context via props
function FooterComponent({ context }: { context?: FooterContext }) {
  if (!context) return null;

  const {
    messages,
    messagesEndRef,
    isStreaming,
    tokenCountResult,
    isUndoLoading,
    isRetryLoading,
    setIsUndoLoading,
    setIsRetryLoading,
    versions,
    revertVersion,
    streamMessage,
    selectedChatId,
    appId,
    setMessagesById,
    settings,
    userBudget,
    renderSetupBanner,
  } = context;

  return (
    <>
      {/* Show context limit banner when close to token limit */}
      {!isStreaming && tokenCountResult && (
        <ContextLimitBanner
          totalTokens={tokenCountResult.actualMaxTokens}
          contextWindow={tokenCountResult.contextWindow}
        />
      )}

      {!isStreaming && (
        <div className="flex max-w-3xl mx-auto gap-2">
          {!!messages.length &&
            messages[messages.length - 1].role === "assistant" && (
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
                    const currentMessage = messages[messages.length - 1];
                    // The user message that triggered this assistant response
                    const userMessage = messages[messages.length - 2];
                    if (currentMessage?.sourceCommitHash) {
                      console.debug(
                        "Reverting to source commit hash",
                        currentMessage.sourceCommitHash,
                      );
                      await revertVersion({
                        versionId: currentMessage.sourceCommitHash,
                        currentChatMessageId: userMessage
                          ? {
                              chatId: selectedChatId,
                              messageId: userMessage.id,
                            }
                          : undefined,
                      });
                      const chat =
                        await IpcClient.getInstance().getChat(selectedChatId);
                      setMessagesById((prev) => {
                        const next = new Map(prev);
                        next.set(selectedChatId, chat.messages);
                        return next;
                      });
                    } else {
                      showWarning(
                        "No source commit hash found for message. Need to manually undo code changes",
                      );
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
                      console.debug("Reverting to previous assistant version");
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
    </>
  );
}

export const MessagesList = forwardRef<HTMLDivElement, MessagesListProps>(
  function MessagesList({ messages, messagesEndRef }, ref) {
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

    // Virtualization only renders visible DOM elements, which creates issues for E2E tests:
    // 1. Off-screen logs don't exist in the DOM and can't be queried by test selectors
    // 2. Tests would need complex scrolling logic to bring elements into view before interaction
    // 3. Race conditions and timing issues occur when waiting for virtualized elements to render after scrolling
    const isTestMode = settings?.isTestMode;
    // Only fetch token count when not streaming
    const { result: tokenCountResult } = useCountTokens(
      !isStreaming ? selectedChatId : null,
      "",
    );

    // Wrap state setters in useCallback to stabilize references
    const handleSetIsUndoLoading = useCallback((loading: boolean) => {
      setIsUndoLoading(loading);
    }, []);

    const handleSetIsRetryLoading = useCallback((loading: boolean) => {
      setIsRetryLoading(loading);
    }, []);

    // Stabilize renderSetupBanner with proper dependencies
    const renderSetupBanner = useCallback(() => {
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
    }, [
      settings?.selectedModel?.name,
      settings?.selectedModel?.provider,
      isProviderSetup,
      isAnyProviderSetup,
    ]);

    // Memoized item renderer for virtualized list
    const itemContent = useCallback(
      (index: number, message: Message) => {
        const isLastMessage = index === messages.length - 1;
        const messageKey = message.id;

        return (
          <div className="px-4" key={messageKey}>
            <MemoizedChatMessage
              message={message}
              isLastMessage={isLastMessage}
            />
          </div>
        );
      },
      [messages.length],
    );

    // Create context object for Footer component with stable references
    const footerContext = useMemo<FooterContext>(
      () => ({
        messages,
        messagesEndRef,
        isStreaming,
        tokenCountResult,
        isUndoLoading,
        isRetryLoading,
        setIsUndoLoading: handleSetIsUndoLoading,
        setIsRetryLoading: handleSetIsRetryLoading,
        versions,
        revertVersion,
        streamMessage,
        selectedChatId,
        appId,
        setMessagesById,
        settings,
        userBudget,
        renderSetupBanner,
      }),
      [
        messages,
        messagesEndRef,
        isStreaming,
        tokenCountResult,
        isUndoLoading,
        isRetryLoading,
        handleSetIsUndoLoading,
        handleSetIsRetryLoading,
        versions,
        revertVersion,
        streamMessage,
        selectedChatId,
        appId,
        setMessagesById,
        settings,
        userBudget,
        renderSetupBanner,
      ],
    );

    // Render empty state or setup banner
    if (messages.length === 0) {
      const setupBanner = renderSetupBanner();
      if (setupBanner) {
        return (
          <div
            className="absolute inset-0 overflow-y-auto p-4"
            ref={ref}
            data-testid="messages-list"
          >
            {setupBanner}
          </div>
        );
      }
      return (
        <div
          className="absolute inset-0 overflow-y-auto p-4"
          ref={ref}
          data-testid="messages-list"
        >
          <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto">
            <div className="flex flex-1 items-center justify-center text-gray-500">
              No messages yet
            </div>
          </div>
        </div>
      );
    }

    // In test mode, render all messages without virtualization
    // so E2E tests can query all messages in the DOM
    if (isTestMode) {
      return (
        <div
          className="absolute inset-0 p-4 overflow-y-auto"
          ref={ref}
          data-testid="messages-list"
        >
          {messages.map((message, index) => {
            const isLastMessage = index === messages.length - 1;
            return (
              <div className="px-4" key={message.id}>
                <ChatMessage message={message} isLastMessage={isLastMessage} />
              </div>
            );
          })}
          <FooterComponent context={footerContext} />
        </div>
      );
    }

    return (
      <div
        className="absolute inset-0 p-4"
        ref={ref}
        data-testid="messages-list"
      >
        <Virtuoso
          data={messages}
          increaseViewportBy={{ top: 1000, bottom: 500 }}
          initialTopMostItemIndex={messages.length - 1}
          followOutput="smooth"
          itemContent={itemContent}
          components={{ Footer: FooterComponent }}
          context={footerContext}
        />
      </div>
    );
  },
);
