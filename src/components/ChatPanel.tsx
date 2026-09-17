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
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import {
  chatMessagesByIdAtom,
  scrollToBottomRequestedChatIdsAtom,
} from "../atoms/chatAtoms";
import { ipc } from "@/ipc/types";

import { ChatHeader } from "./chat/ChatHeader";
import { MessagesList } from "./chat/MessagesList";
import { ChatInput } from "./chat/ChatInput";
import { VersionPane } from "./chat/VersionPane";
import { FreeAgentQuotaBanner } from "./chat/FreeAgentQuotaBanner";
import { NotificationBanner } from "./chat/NotificationBanner";
import { SupabaseLegacyKeyBanner } from "./chat/SupabaseLegacyKeyBanner";
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
import { isFreeProModel } from "@/lib/freeProModel";
import { terminalOpenByChatIdAtom } from "@/atoms/terminalAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useReducedMotionPref } from "@/hooks/useReducedMotion";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useVersionPreview } from "@/hooks/useVersionPreview";
import { useChatStreamState } from "@/hooks/useChatStream";
import { useChatStreamManager } from "@/chat_stream/ChatStreamProvider";
import { streamInvocationRef } from "@/chat_stream/transition";
import { useChatScroll } from "./chat/scroll/useChatScroll";
import { automaticChatScrollReason } from "./chatPanelScroll";
import {
  useChatMessages,
  useChatMessagesLoaded,
} from "@/hooks/useChatMessages";

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
  const messages = useChatMessages(chatId);
  const messagesLoaded = useChatMessagesLoaded(chatId);
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
  const { isPaneVisible: isVersionPaneOpen, send: sendVersionPreview } =
    useVersionPreview(selectedAppId);
  const [terminalFitSignal, setTerminalFitSignal] = useState(0);
  const streamState = useChatStreamState(chatId) ?? { type: "idle" };
  const chatStreamManager = useChatStreamManager();
  const { settings } = useSettings();
  const { selectedMode, selectedModel, setChatMode } = useChatMode(chatId);
  const { isQuotaExceeded } = useFreeAgentQuota();
  const showFreeAgentQuotaBanner =
    settings &&
    !isDyadProEnabled(settings) &&
    selectedMode === "local-agent" &&
    isQuotaExceeded;

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const {
    scrollerRef,
    contentRef,
    onContentHeightChange,
    scrollToBottom,
    showScrollButton,
  } = useChatScroll(chatId);

  // Scroll to bottom when a new stream starts (user sent a message)
  const streamOperationId = streamInvocationRef(streamState)?.operationId ?? "";
  const isTerminalOpen = chatId
    ? (terminalOpenByChatId.get(chatId) ?? false)
    : false;

  // Track previous chatId to detect chat switches
  const prevChatIdRef = useRef<number | undefined>(undefined);
  const prevStreamOperationIdRef = useRef("");
  const pendingInitialScrollChatIdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const isChatSwitch = prevChatIdRef.current !== chatId;
    const reason = automaticChatScrollReason({
      previousChatId: prevChatIdRef.current,
      chatId,
      previousOperationId: prevStreamOperationIdRef.current,
      operationId: streamOperationId,
      pendingInitialScrollChatId: pendingInitialScrollChatIdRef.current,
      messagesLength: messages.length,
    });
    prevChatIdRef.current = chatId;
    prevStreamOperationIdRef.current = streamOperationId;

    if (isChatSwitch) {
      pendingInitialScrollChatIdRef.current =
        messages.length === 0 ? chatId : undefined;
    } else if (reason === "initial-messages-loaded") {
      pendingInitialScrollChatIdRef.current = undefined;
    }

    if (reason === null) return;

    scrollToBottom();
  }, [chatId, streamOperationId, messages.length, scrollToBottom]);

  useEffect(() => {
    if (
      chatId == null ||
      !messagesLoaded ||
      !isScrollToBottomRequestedForChat
    ) {
      return;
    }

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

    // The controller owns frame scheduling and cancels it on ref teardown.
    // Retain requests while the message list is hidden.
    if (!scrollToBottom()) return;
    setScrollToBottomRequestedChatIds((prev) => {
      if (!prev.has(chatId)) return prev;
      const next = new Set(prev);
      next.delete(chatId);
      return next;
    });
  }, [
    chatId,
    messages.length,
    messagesLoaded,
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
    // Read at call time so both checks observe the current machine snapshot.
    if (chatStreamManager.getIsStreaming(chatId)) return;
    const chat = await ipc.chat.getChat(chatId);
    // Re-check after the async fetch: streaming may have started while in flight.
    if (chatStreamManager.getIsStreaming(chatId)) return;
    setMessagesById((prev) => {
      const next = new Map(prev);
      next.set(chatId, chat.messages);
      return next;
    });
  }, [chatId, chatStreamManager, setMessagesById]);

  useEffect(() => {
    fetchChatMessages();
  }, [fetchChatMessages]);

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
                      chatId={chatId ?? null}
                      messages={messages}
                      messagesEndRef={messagesEndRef}
                      key={chatId}
                      ref={scrollerRef}
                      contentRef={contentRef}
                      onContentHeightChange={onContentHeightChange}
                    />

                    {/* Scroll to bottom button */}
                    {showScrollButton && (
                      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                onClick={scrollToBottom}
                                aria-label={t("scrollToBottom")}
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
                      onSwitchToBuildMode={
                        isFreeProModel(selectedModel)
                          ? undefined
                          : () => void setChatMode("build").catch(() => {})
                      }
                    />
                  )}
                  <SupabaseLegacyKeyBanner appId={selectedAppId} />
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
