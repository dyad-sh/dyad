import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import {
  chatMessagesByIdAtom,
  chatStreamCountByIdAtom,
  isStreamingByIdAtom,
} from "../atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { ipc } from "@/ipc/types";
import { toast } from "sonner";
import { persistChatModeToDb } from "@/lib/chatModeUtils";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

import { ChatHeader } from "./chat/ChatHeader";
import { MessagesList } from "./chat/MessagesList";
import { ChatInput } from "./chat/ChatInput";
import { VersionPane } from "./chat/VersionPane";
import { ChatError } from "./chat/ChatError";
import { FreeAgentQuotaBanner } from "./chat/FreeAgentQuotaBanner";
import { NotificationBanner } from "./chat/NotificationBanner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ArrowDown } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { useInitialChatMode } from "@/hooks/useInitialChatMode";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import { isBasicAgentMode, type ChatSummary } from "@/lib/schemas";

interface ChatPanelProps {
  chatId?: number;
  isPreviewOpen: boolean;
  onTogglePreview: () => void;
}

export function ChatPanel({
  chatId,
  isPreviewOpen,
  onTogglePreview,
}: ChatPanelProps) {
  const { t } = useTranslation("chat");
  const messagesById = useAtomValue(chatMessagesByIdAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const [isVersionPaneOpen, setIsVersionPaneOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamCountById = useAtomValue(chatStreamCountByIdAtom);
  const isStreamingById = useAtomValue(isStreamingByIdAtom);
  const { settings, updateSettings } = useSettings();
  const initialChatMode = useInitialChatMode();
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { isQuotaExceeded } = useFreeAgentQuota();
  const showFreeAgentQuotaBanner =
    settings && isBasicAgentMode(settings) && isQuotaExceeded;
  const queryClient = useQueryClient();

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  // Tracks whether the user is at the bottom of the scroll container.
  // Uses a ref so followOutput can read it without stale closures,
  // and state for the scroll button UI which needs re-renders.
  const isAtBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  // Ref to track previous streaming state for stream-complete scroll
  const prevIsStreamingRef = useRef(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  // Called by Virtuoso's atBottomStateChange (production) or scroll handler (test mode).
  // Pure position-based: no timeouts, no debounce.
  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    setShowScrollButton(!atBottom);
  }, []);

  const handleScrollButtonClick = useCallback(() => {
    // Optimistically mark as at-bottom so followOutput resumes immediately
    isAtBottomRef.current = true;
    setShowScrollButton(false);
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  // Scroll to bottom when a new stream starts (user sent a message)
  const streamCount = chatId ? (streamCountById.get(chatId) ?? 0) : 0;
  const messages = chatId ? (messagesById.get(chatId) ?? []) : [];

  // Track previous chatId to detect chat switches
  const prevChatIdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const isChatSwitch = prevChatIdRef.current !== chatId;
    prevChatIdRef.current = chatId;

    isAtBottomRef.current = true;
    setShowScrollButton(false);

    if (isChatSwitch && messages.length > 0) {
      // When switching chats with existing messages, wait for Virtuoso to render
      // then scroll to ensure we're at the bottom
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToBottom("instant");
        });
      });
    } else if (!isChatSwitch) {
      // For stream count changes (new message sent), wait for Virtuoso to render
      // the placeholder message before scrolling
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      });
    }
    // Note: if isChatSwitch && messages.length === 0, we don't scroll yet.
    // The messages will be fetched and this effect will re-run with messages.length > 0.
  }, [chatId, streamCount, messages.length, scrollToBottom]);

  const fetchChatMessages = useCallback(async () => {
    if (!chatId) {
      // no-op when no chat
      return;
    }
    const chat = await ipc.chat.getChat(chatId);
    setMessagesById((prev) => {
      const next = new Map(prev);
      next.set(chatId, chat.messages);
      return next;
    });
  }, [chatId, setMessagesById]);

  useEffect(() => {
    fetchChatMessages();
  }, [fetchChatMessages]);

  // Restore mode on route-driven chat switches (fallback if useSelectChat isn't called, e.g., browser history)
  useEffect(() => {
    if (!chatId || !selectedAppId) return;

    try {
      const chatSummaries = queryClient.getQueryData<ChatSummary[]>(
        queryKeys.chats.list({ appId: selectedAppId }),
      );

      if (chatSummaries) {
        const currentChat = chatSummaries.find((c) => c.id === chatId);
        // Handle both new chats with explicit mode and legacy chats (chatMode === null)
        const chatMode = currentChat?.chatMode ?? initialChatMode;
        if (chatMode && chatMode !== settings?.selectedChatMode) {
          updateSettings({ selectedChatMode: chatMode });
        }
      } else {
        // Fallback: fetch chat directly when cache is empty (cold deep-link / browser history)
        ipc.chat
          .getChat(chatId)
          .then((chat) => {
            const chatMode = chat.chatMode ?? initialChatMode;
            if (chatMode && chatMode !== settings?.selectedChatMode) {
              updateSettings({ selectedChatMode: chatMode });
            }
          })
          .catch((err) => {
            console.error("Failed to restore chat mode on deep-link:", err);
          });
      }
    } catch (err) {
      console.error(err);
    }

    // Exclude settings?.selectedChatMode from dependencies to prevent race condition/infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, selectedAppId, queryClient, updateSettings, initialChatMode]);

  const isStreaming = chatId ? (isStreamingById.get(chatId) ?? false) : false;
  // but only if the user was following (at bottom) during the stream.
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = isStreaming;

    if (wasStreaming && !isStreaming && isAtBottomRef.current) {
      // Double RAF ensures DOM is fully updated with footer content
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToBottom("smooth");
        });
      });
    }
  }, [isStreaming, scrollToBottom]);

  // Test mode only: Track scroll position to update isAtBottom state.
  // In production, Virtuoso's atBottomStateChange handles this.
  useEffect(() => {
    if (!settings?.isTestMode) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - (container.scrollTop + container.clientHeight);
      handleAtBottomChange(distanceFromBottom <= 80);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [settings?.isTestMode, isVersionPaneOpen, handleAtBottomChange]);

  // Test mode: Auto-scroll during streaming when user is at the bottom.
  // In production, Virtuoso's followOutput handles this.
  useEffect(() => {
    if (!settings?.isTestMode) return;

    if (isAtBottomRef.current && isStreaming) {
      requestAnimationFrame(() => {
        scrollToBottom("instant");
      });
    }
  }, [messages, isStreaming, settings?.isTestMode, scrollToBottom]);

  return (
    <div className="flex flex-col h-full">
      <ChatHeader
        isVersionPaneOpen={isVersionPaneOpen}
        isPreviewOpen={isPreviewOpen}
        onTogglePreview={onTogglePreview}
        onVersionClick={() => setIsVersionPaneOpen(!isVersionPaneOpen)}
      />
      <div className="flex flex-1 overflow-hidden">
        {!isVersionPaneOpen && (
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 relative overflow-hidden">
              <MessagesList
                messages={messages}
                messagesEndRef={messagesEndRef}
                ref={messagesContainerRef}
                onAtBottomChange={handleAtBottomChange}
              />

              {/* Scroll to bottom button */}
              {showScrollButton && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          onClick={handleScrollButtonClick}
                          size="icon"
                          className="rounded-full shadow-lg hover:shadow-xl transition-all border border-border/50 backdrop-blur-sm bg-background/95 hover:bg-accent"
                          variant="outline"
                        />
                      }
                    >
                      <ArrowDown className="h-4 w-4" />
                    </TooltipTrigger>
                    <TooltipContent>{t("scrollToBottom")}</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>

            <ChatError error={error} onDismiss={() => setError(null)} />
            {showFreeAgentQuotaBanner && (
              <FreeAgentQuotaBanner
                onSwitchToBuildMode={() => {
                  const previousMode = settings?.selectedChatMode;
                  updateSettings({ selectedChatMode: "build" });
                  // Also persist to current chat if in a chat
                  if (chatId) {
                    persistChatModeToDb(
                      chatId,
                      "build",
                      () =>
                        queryClient.invalidateQueries({
                          queryKey: queryKeys.chats.all,
                        }),
                      () => {
                        toast.error("Failed to save chat mode");
                        // Only rollback if mode is still "build" (no newer override from another code path)
                        if (
                          previousMode &&
                          settings?.selectedChatMode === "build"
                        ) {
                          updateSettings({ selectedChatMode: previousMode });
                        }
                      },
                    );
                  }
                }}
              />
            )}
            <NotificationBanner />
            <ChatInput chatId={chatId} />
          </div>
        )}
        <VersionPane
          isVisible={isVersionPaneOpen}
          onClose={() => setIsVersionPaneOpen(false)}
        />
      </div>
    </div>
  );
}
