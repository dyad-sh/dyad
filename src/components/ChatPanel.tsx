import { useState, useRef, useEffect, useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  chatMessagesByIdAtom,
  chatStreamCountByIdAtom,
  isStreamingByIdAtom,
} from "../atoms/chatAtoms";
import { ipc } from "@/ipc/types";

import { ChatHeader } from "./chat/ChatHeader";
import { MessagesList } from "./chat/MessagesList";
import { ChatInput } from "./chat/ChatInput";
import { VersionPane } from "./chat/VersionPane";
import { ChatError } from "./chat/ChatError";
import { FreeAgentQuotaBanner } from "./chat/FreeAgentQuotaBanner";
import { Button } from "@/components/ui/button";
import { ArrowDown } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import { isBasicAgentMode } from "@/lib/schemas";

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
  const messagesById = useAtomValue(chatMessagesByIdAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const [isVersionPaneOpen, setIsVersionPaneOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamCountById = useAtomValue(chatStreamCountByIdAtom);
  const isStreamingById = useAtomValue(isStreamingByIdAtom);
  const { settings, updateSettings } = useSettings();
  const { isQuotaExceeded } = useFreeAgentQuota();
  const showFreeAgentQuotaBanner =
    settings && isBasicAgentMode(settings) && isQuotaExceeded;

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  // Scroll-related state
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isUserScrolling, setIsUserScrolling] = useState(false);

  // Refs for scroll tracking (both test and Virtuoso modes)
  const distanceFromBottomRef = useRef<number>(0);
  const userScrollTimeoutRef = useRef<number | null>(null);
  // Ref to store cleanup function for Virtuoso scroller event listener
  const scrollerCleanupRef = useRef<(() => void) | null>(null);
  // Ref to track previous streaming state
  const prevIsStreamingRef = useRef(false);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  const handleScrollButtonClick = () => {
    scrollToBottom("smooth");
  };

  // Unified scroll tracking handler for both test and Virtuoso modes
  const handleScrollTracking = useCallback((container: HTMLElement) => {
    const distanceFromBottom =
      container.scrollHeight - (container.scrollTop + container.clientHeight);
    distanceFromBottomRef.current = distanceFromBottom;

    const scrollAwayThreshold = 150; // pixels from bottom to consider "scrolled away"

    // User has scrolled away from bottom
    if (distanceFromBottom > scrollAwayThreshold) {
      setIsUserScrolling(true);
      setShowScrollButton(true);

      // Clear existing timeout
      if (userScrollTimeoutRef.current) {
        window.clearTimeout(userScrollTimeoutRef.current);
      }

      // Reset isUserScrolling after 2 seconds
      userScrollTimeoutRef.current = window.setTimeout(() => {
        setIsUserScrolling(false);
      }, 2000);
    } else {
      // User is near bottom
      setIsUserScrolling(false);
      setShowScrollButton(false);
    }
  }, []);

  // Callback to receive scrollerRef from Virtuoso (production mode)
  // scrollerRef is called with the element on mount and null on unmount
  const handleScrollerRef = useCallback(
    (ref: HTMLElement | Window | null) => {
      // Always cleanup previous listener first
      if (scrollerCleanupRef.current) {
        scrollerCleanupRef.current();
        scrollerCleanupRef.current = null;
      }

      // If ref is null or window, nothing to attach to
      if (!ref || ref === window) return;

      const element = ref as HTMLElement;
      const handleScroll = () => handleScrollTracking(element);
      element.addEventListener("scroll", handleScroll, { passive: true });

      // Store cleanup function for later invocation
      scrollerCleanupRef.current = () => {
        element.removeEventListener("scroll", handleScroll);
      };
    },
    [handleScrollTracking],
  );

  useEffect(() => {
    const streamCount = chatId ? (streamCountById.get(chatId) ?? 0) : 0;
    console.log("streamCount - scrolling to bottom", streamCount);
    scrollToBottom();
  }, [chatId, chatId ? (streamCountById.get(chatId) ?? 0) : 0]);

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

  const messages = chatId ? (messagesById.get(chatId) ?? []) : [];
  const isStreaming = chatId ? (isStreamingById.get(chatId) ?? false) : false;

  // Scroll to bottom when streaming completes to ensure footer content is visible
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = isStreaming;

    // When streaming transitions from true to false
    if (wasStreaming && !isStreaming) {
      // Double RAF ensures DOM is fully updated with footer content
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToBottom("smooth");
        });
      });
    }
  }, [isStreaming]);

  // Test mode only: Attach scroll listener to messagesContainerRef
  // In production mode, handleScrollerRef attaches to Virtuoso's scroller
  useEffect(() => {
    const isTestMode = settings?.isTestMode;
    if (!isTestMode) return; // Only for test mode

    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => handleScrollTracking(container);
    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [handleScrollTracking, settings?.isTestMode, isVersionPaneOpen]);

  // Test mode: Auto-scroll during streaming (280px threshold)
  // Note: Virtuoso handles this via followOutput in production mode
  useEffect(() => {
    const isTestMode = settings?.isTestMode;
    if (!isTestMode) return; // Only for test mode

    if (
      !isUserScrolling &&
      isStreaming &&
      messagesEndRef.current &&
      distanceFromBottomRef.current <= 280
    ) {
      requestAnimationFrame(() => {
        scrollToBottom("instant");
      });
    }
  }, [messages, isUserScrolling, isStreaming, settings?.isTestMode]);

  // Cleanup timeout and scroller listener on unmount
  useEffect(() => {
    return () => {
      if (userScrollTimeoutRef.current) {
        window.clearTimeout(userScrollTimeoutRef.current);
      }
      if (scrollerCleanupRef.current) {
        scrollerCleanupRef.current();
        scrollerCleanupRef.current = null;
      }
    };
  }, []);

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
                onScrollerRef={handleScrollerRef}
                distanceFromBottomRef={distanceFromBottomRef}
                isUserScrolling={isUserScrolling}
              />

              {/* Scroll to bottom button */}
              {showScrollButton && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
                  <Button
                    onClick={handleScrollButtonClick}
                    size="icon"
                    className="rounded-full shadow-lg hover:shadow-xl transition-all border border-border/50 backdrop-blur-sm bg-background/95 hover:bg-accent"
                    variant="outline"
                    title={"Scroll to bottom"}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            <ChatError error={error} onDismiss={() => setError(null)} />
            {showFreeAgentQuotaBanner && (
              <FreeAgentQuotaBanner
                onSwitchToBuildMode={() =>
                  updateSettings({ selectedChatMode: "build" })
                }
              />
            )}
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
