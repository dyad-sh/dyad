import { useState, useRef, useEffect, useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  chatMessagesByIdAtom,
  chatStreamCountByIdAtom,
} from "../atoms/chatAtoms";
import { IpcClient } from "@/ipc/ipc_client";

import { ChatHeader } from "./chat/ChatHeader";
import { MessagesList } from "./chat/MessagesList";
import { ChatInput } from "./chat/ChatInput";
import { VersionPane } from "./chat/VersionPane";
import { ChatError } from "./chat/ChatError";
import { Button } from "@/components/ui/button";
import { ArrowDown } from "lucide-react";

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
  // Reference to store the processed prompt so we don't submit it twice

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  // Scroll-related properties
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const userScrollTimeoutRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef<number>(0);
  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  const handleScrollButtonClick = () => {
    if (!messagesContainerRef.current) return;

    scrollToBottom("smooth");
  };

  const getDistanceFromBottom = () => {
    if (!messagesContainerRef.current) return 0;
    const container = messagesContainerRef.current;
    return (
      container.scrollHeight - (container.scrollTop + container.clientHeight)
    );
  };

  const isNearBottom = (threshold: number = 100) => {
    return getDistanceFromBottom() <= threshold;
  };

  const scrollAwayThreshold = 150; // pixels from bottom to consider "scrolled away"

  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;

    const container = messagesContainerRef.current;
    const distanceFromBottom =
      container.scrollHeight - (container.scrollTop + container.clientHeight);

    // User has scrolled away from bottom
    if (distanceFromBottom > scrollAwayThreshold) {
      setIsUserScrolling(true);
      setShowScrollButton(true);

      if (userScrollTimeoutRef.current) {
        window.clearTimeout(userScrollTimeoutRef.current);
      }

      userScrollTimeoutRef.current = window.setTimeout(() => {
        setIsUserScrolling(false);
      }, 2000); // Increased timeout to 2 seconds
    } else {
      // User is near bottom
      setIsUserScrolling(false);
      setShowScrollButton(false);
    }
    lastScrollTopRef.current = container.scrollTop;
  }, []);

  useEffect(() => {
    const streamCount = chatId ? (streamCountById.get(chatId) ?? 0) : 0;
    console.log("streamCount - scrolling to bottom", streamCount);
    scrollToBottom();
  }, [chatId, chatId ? (streamCountById.get(chatId) ?? 0) : 0]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll, { passive: true });
    }

    return () => {
      if (container) {
        container.removeEventListener("scroll", handleScroll);
      }
      if (userScrollTimeoutRef.current) {
        window.clearTimeout(userScrollTimeoutRef.current);
      }
    };
  }, [handleScroll]);

  const fetchChatMessages = useCallback(async () => {
    if (!chatId) {
      // no-op when no chat
      return;
    }
    const chat = await IpcClient.getInstance().getChat(chatId);
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
  // Auto-scroll effect when messages change
  useEffect(() => {
    if (
      !isUserScrolling &&
      messagesContainerRef.current &&
      messages.length > 0
    ) {
      // Only auto-scroll if user is close to bottom
      if (isNearBottom(280)) {
        requestAnimationFrame(() => {
          scrollToBottom("instant");
        });
      }
    }
  }, [messages, isUserScrolling]);

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
