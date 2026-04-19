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
import { ArrowDown, Loader } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { isDyadProEnabled } from "@/lib/schemas";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import { useChats } from "@/hooks/useChats";
import { usePersistChatMode } from "@/hooks/usePersistChatMode";
import { useRestoreChatMode } from "@/hooks/useRestoreChatMode";

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
  const {
    settings,
    envVars,
    updateSettings,
    loading: settingsLoading,
  } = useSettings();
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();
  const { chats } = useChats(selectedAppId);
  const currentChat = chats.find((c) => c.id === chatId);
  const isProEnabled = settings ? isDyadProEnabled(settings) : false;
  const isRestoreContextReady =
    !settingsLoading && (isProEnabled || !isQuotaLoading);
  const quotaCheckMode =
    currentChat?.chatMode ?? settings?.selectedChatMode ?? "build";
  const showFreeAgentQuotaBanner =
    settings &&
    !isProEnabled &&
    quotaCheckMode === "local-agent" &&
    isQuotaExceeded;
  const queryClient = useQueryClient();
  const { persistChatMode } = usePersistChatMode();

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

  const { isRestoringMode } = useRestoreChatMode({
    chatId,
    appId: selectedAppId,
    settings,
    envVars,
    isQuotaExceeded,
    isContextReady: isRestoreContextReady,
    updateSettings,
  });
  const isModeRestoreBlocking = Boolean(chatId) && !isRestoreContextReady;
  const isModeTransitioning = isRestoringMode || isModeRestoreBlocking;

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

  const switchToBuildMode = useCallback(() => {
    const appIdForPersist = selectedAppId ?? currentChat?.appId;
    if (!appIdForPersist) {
      toast.error(
        t("chatMode.noAppSelected", {
          defaultValue: "No app selected — can't change chat mode",
        }),
      );
      return;
    }
    if (!chatId) {
      toast.error(
        t("chatMode.noChatSelected", {
          defaultValue: "No chat selected — can't change chat mode",
        }),
      );
      return;
    }

    void persistChatMode({
      chatId,
      appId: appIdForPersist,
      chatMode: "build",
      optimistic: true,
      onPersistSuccess: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.chats.all }),
      onPersistError: () => {
        toast.error(
          t("chatMode.persistFailed", {
            defaultValue: "Failed to save chat mode to database",
          }),
          { id: "switch-to-build-error" },
        );
      },
    });
  }, [
    chatId,
    currentChat?.appId,
    persistChatMode,
    queryClient,
    selectedAppId,
    t,
  ]);

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
              <FreeAgentQuotaBanner onSwitchToBuildMode={switchToBuildMode} />
            )}
            <NotificationBanner />
            <div className="flex flex-col gap-2">
              <div className="min-h-8 flex justify-center pointer-events-none">
                {isModeTransitioning && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="w-fit px-3 py-1.5 text-xs bg-background/80 backdrop-blur-sm border border-border shadow-sm rounded-full text-muted-foreground flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-200"
                  >
                    <Loader size={12} className="animate-spin" />
                    {t("chatMode.restoringChatMode", {
                      defaultValue: "Restoring chat mode...",
                    })}
                  </div>
                )}
              </div>
              <ChatInput
                chatId={chatId}
                isRestoringMode={isModeTransitioning}
              />
            </div>
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
