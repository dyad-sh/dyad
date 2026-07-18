import {
  lazy,
  Suspense,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { selectAtom } from "jotai/utils";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import {
  chatErrorByIdAtom,
  chatMessagesByIdAtom,
  chatStreamCountByIdAtom,
  isStreamingByIdAtom,
  scrollToBottomRequestedChatIdsAtom,
} from "../atoms/chatAtoms";
import { ipc } from "@/ipc/types";

import { ChatHeader } from "./chat/ChatHeader";
import { MessagesList } from "./chat/MessagesList";
import { ChatInput } from "./chat/ChatInput";
import { VersionPane } from "./chat/VersionPane";
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
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import { useChatMode } from "@/hooks/useChatMode";
import { isDyadProEnabled } from "@/lib/schemas";
import { terminalOpenByChatIdAtom } from "@/atoms/terminalAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useReducedMotionPref } from "@/hooks/useReducedMotion";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useVersionPreview } from "@/hooks/useVersionPreview";
import { isPaneVisibleState } from "@/version_preview/state";

const TerminalPanel = lazy(() => import("./chat/TerminalPanel"));

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
  const chatErrorById = useAtomValue(chatErrorByIdAtom);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const setScrollToBottomRequestedChatIds = useSetAtom(
    scrollToBottomRequestedChatIdsAtom,
  );
  // Subscribe only to whether THIS chat has a pending scroll request, not to the
  // whole Set. Otherwise adding/removing any other chat id re-fires the
  // scroll-to-bottom effect for the visible chat (running its double-RAF
  // setup/cleanup) even though nothing about the current chat changed.
  const isScrollToBottomRequestedForChat = useAtomValue(
    useMemo(
      () =>
        selectAtom(scrollToBottomRequestedChatIdsAtom, (requested) =>
          chatId != null ? requested.has(chatId) : false,
        ),
      [chatId],
    ),
  );
  const [terminalOpenByChatId, setTerminalOpenByChatId] = useAtom(
    terminalOpenByChatIdAtom,
  );
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { apps } = useLoadApps();
  const currentApp = apps.find((app) => app.id === selectedAppId);
  const reducedMotion = useReducedMotionPref();
  // Pane visibility derives from the version preview machine; open/close are
  // events, so hiding the pane can never skip repository recovery.
  const { state: versionPreviewState, send: sendVersionPreview } =
    useVersionPreview(selectedAppId);
  const isVersionPaneOpen = isPaneVisibleState(versionPreviewState);
  const [terminalFitSignal, setTerminalFitSignal] = useState(0);
  const streamCountById = useAtomValue(chatStreamCountByIdAtom);
  const isStreamingById = useAtomValue(isStreamingByIdAtom);
  const store = useStore();
  const { settings } = useSettings();
  const { selectedMode, setChatMode } = useChatMode(chatId);
  const { isQuotaExceeded } = useFreeAgentQuota();
  const showFreeAgentQuotaBanner =
    settings &&
    !isDyadProEnabled(settings) &&
    selectedMode === "local-agent" &&
    isQuotaExceeded;

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  // Tracks whether the user is at the bottom of the scroll container.
  // Uses a ref so followOutput can read it without stale closures,
  // and state for the scroll button UI which needs re-renders.
  const isAtBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  // Ref to track previous streaming state for stream-complete scroll
  const prevIsStreamingRef = useRef(false);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth"): boolean => {
      const messagesEnd = messagesEndRef.current;
      if (!messagesEnd) {
        return false;
      }
      messagesEnd.scrollIntoView({ behavior });
      return true;
    },
    [],
  );

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
  const streamError = chatId ? (chatErrorById.get(chatId) ?? null) : null;
  const isTerminalOpen = chatId
    ? (terminalOpenByChatId.get(chatId) ?? false)
    : false;

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

  useEffect(() => {
    if (
      chatId == null ||
      !messagesById.has(chatId) ||
      !isScrollToBottomRequestedForChat
    ) {
      return;
    }

    isAtBottomRef.current = true;
    setShowScrollButton(false);

    // Wait for messages to render before scrolling. If the chat is loaded and
    // empty, there is nothing to scroll to, so clear the request instead of
    // leaving stale per-chat state behind.
    if (messages.length === 0) {
      setScrollToBottomRequestedChatIds((prev) => {
        if (!prev.has(chatId)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(chatId);
        return next;
      });
      return;
    }

    // Defer the scroll to after paint, but capture the RAF ids so a chat switch
    // (which cleans up / re-runs this effect) cancels the pending scroll.
    // scrollToBottom resolves the shared messagesEndRef at execution time, so
    // an un-cancelled callback firing after a rapid switch would scroll whatever
    // chat is now mounted. Clear the request only after the scroll actually
    // runs, so the cleanup can't outrace the deferred scroll.
    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        // The message list is unmounted while Version History is open. Keep the
        // per-chat request queued until the list is visible and its end marker
        // exists, then consume it after the scroll actually runs.
        if (!scrollToBottom("instant")) {
          return;
        }
        setScrollToBottomRequestedChatIds((prev) => {
          if (!prev.has(chatId)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(chatId);
          return next;
        });
      });
    });

    return () => {
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
    };
  }, [
    chatId,
    messages.length,
    messagesById,
    isVersionPaneOpen,
    scrollToBottom,
    isScrollToBottomRequestedForChat,
    setScrollToBottomRequestedChatIds,
  ]);

  const fetchChatMessages = useCallback(async () => {
    if (!chatId) {
      // no-op when no chat
      return;
    }
    // Skip IPC fetch entirely when streaming: the patch stream carries fresher
    // content than the throttled DB snapshot, and overwriting would corrupt the
    // renderer's base for subsequent patches (offset mismatch). onEnd will do
    // a correct full sync when the stream finishes.
    // Read via store.get so both checks see the current atom value regardless
    // of React batching or commit-to-effect timing.
    if (store.get(isStreamingByIdAtom).get(chatId)) return;
    const chat = await ipc.chat.getChat(chatId);
    // Re-check after the async fetch: streaming may have started while in flight.
    if (store.get(isStreamingByIdAtom).get(chatId)) return;
    setMessagesById((prev) => {
      const next = new Map(prev);
      next.set(chatId, chat.messages);
      return next;
    });
  }, [chatId, setMessagesById, store]); // store is stable; isStreamingById read via store.get at call time

  useEffect(() => {
    fetchChatMessages();
  }, [fetchChatMessages]);

  const isStreaming = chatId ? (isStreamingById.get(chatId) ?? false) : false;

  // Scroll to bottom when streaming completes to ensure footer content is visible,
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

  // Keep footer actions (including Retry) visible when stream errors render below.
  useEffect(() => {
    if (!streamError) return;

    const container = messagesContainerRef.current;
    const distanceFromBottom = container
      ? container.scrollHeight - (container.scrollTop + container.clientHeight)
      : 0;
    const isNearBottom = distanceFromBottom <= 220;
    if (!isAtBottomRef.current && !isNearBottom) return;

    let cancelled = false;
    let firstRafId: number | undefined;
    let secondRafId: number | undefined;
    let timeoutId: number | undefined;

    firstRafId = requestAnimationFrame(() => {
      if (cancelled) return;
      secondRafId = requestAnimationFrame(() => {
        if (cancelled) return;
        scrollToBottom("instant");
        timeoutId = window.setTimeout(() => {
          if (!cancelled) {
            scrollToBottom("smooth");
          }
        }, 120);
      });
    });

    return () => {
      cancelled = true;
      if (firstRafId !== undefined) {
        window.cancelAnimationFrame(firstRafId);
      }
      if (secondRafId !== undefined) {
        window.cancelAnimationFrame(secondRafId);
      }
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [streamError, scrollToBottom]);

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

  const closeTerminal = useCallback(() => {
    if (!chatId) return;
    setTerminalOpenByChatId((prev) => {
      const next = new Map(prev);
      next.set(chatId, false);
      return next;
    });
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="toggle-terminal-button"]',
        )
        ?.focus();
    });
  }, [chatId, setTerminalOpenByChatId]);

  const drawerEase: [number, number, number, number] = [0.22, 1, 0.36, 1];
  const chatLayerTransition: Transition = reducedMotion
    ? { duration: 0.12 }
    : { duration: 0.18, ease: drawerEase };
  const terminalLayerTransition: Transition = reducedMotion
    ? { duration: 0.12 }
    : { duration: 0.22, ease: drawerEase };

  const showTerminalDrawer = isTerminalOpen && chatId && !isVersionPaneOpen;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <ChatHeader
        isVersionPaneOpen={isVersionPaneOpen}
        isPreviewOpen={isPreviewOpen}
        onTogglePreview={onTogglePreview}
        onVersionClick={() => {
          if (isVersionPaneOpen) {
            sendVersionPreview({ type: "CLOSE" });
          } else if (selectedAppId !== null) {
            sendVersionPreview({ type: "OPEN", appId: selectedAppId });
          }
        }}
      />
      <div className="flex flex-1 overflow-hidden">
        {!isVersionPaneOpen && (
          <div className="relative flex-1 min-w-0 overflow-hidden">
            <AnimatePresence>
              {!showTerminalDrawer && (
                <motion.div
                  key="chat"
                  className="absolute inset-0 flex min-h-0 flex-col"
                  initial={
                    reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }
                  }
                  animate={
                    reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }
                  }
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
                  transition={chatLayerTransition}
                >
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
                  {showFreeAgentQuotaBanner && (
                    <FreeAgentQuotaBanner
                      onSwitchToBuildMode={() =>
                        void setChatMode("build").catch(() => {})
                      }
                    />
                  )}
                  <NotificationBanner />
                  <ChatInput chatId={chatId} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        <VersionPane />
      </div>
      <AnimatePresence initial={false}>
        {showTerminalDrawer && (
          <motion.div
            key="terminal"
            data-testid="terminal-drawer"
            className="absolute inset-0 z-20 flex min-h-0 flex-col"
            initial={reducedMotion ? { opacity: 0 } : { y: "100%" }}
            animate={reducedMotion ? { opacity: 1 } : { y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { y: "100%" }}
            transition={terminalLayerTransition}
            onAnimationComplete={() => {
              setTerminalFitSignal((value) => value + 1);
            }}
          >
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {t("terminal.loading")}
                </div>
              }
            >
              <TerminalPanel
                appId={selectedAppId}
                chatId={chatId}
                appName={currentApp?.name}
                onExit={closeTerminal}
                fitSignal={terminalFitSignal}
                size="full"
              />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
