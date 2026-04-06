import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Loader2, MoreHorizontal, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatSummary } from "@/lib/schemas";
import { useNavigate } from "@tanstack/react-router";
import { useChats } from "@/hooks/useChats";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useSelectChat } from "@/hooks/useSelectChat";
import {
  isStreamingByIdAtom,
  recentViewedChatIdsAtom,
  selectedChatIdAtom,
  setRecentViewedChatIdsAtom,
  removeRecentViewedChatIdAtom,
  pushRecentViewedChatIdAtom,
  closedChatIdsAtom,
  pruneClosedChatIdsAtom,
  sessionOpenedChatIdsAtom,
  closeMultipleTabsAtom,
  virtualTabsAtom,
  activeVirtualTabIdAtom,
  addVirtualTabAtom,
  removeVirtualTabAtom,
} from "@/atoms/chatAtoms";
import type { VirtualTabId } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { ipc } from "@/ipc/types";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function NewTabDropdown({
  onNewApp,
  onNewChatInApp,
  newChatDisabled,
}: {
  onNewApp: () => void;
  onNewChatInApp: () => void;
  newChatDisabled: boolean;
}) {
  const { t } = useTranslation("chat");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-7 w-7 ml-1 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        aria-label={t("newTabOptions")}
      >
        <Plus size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4}>
        <DropdownMenuItem onClick={onNewApp}>{t("newApp")}</DropdownMenuItem>
        <DropdownMenuItem onClick={onNewChatInApp} disabled={newChatDisabled}>
          {t("newChatInApp")}
          {newChatDisabled && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({t("selectAppFirst")})
            </span>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const MIN_VISIBLE_TAB_WIDTH_PX = 160;
const TAB_GAP_PX = 4;
const OVERFLOW_TRIGGER_WIDTH_PX = 36;
const DEFAULT_UNMEASURED_VISIBLE_TABS = 3;
const MAX_OVERFLOW_MENU_ITEMS = 8;

const TAB_BASE_CLASSES =
  "group relative flex h-9 min-w-[160px] max-w-[240px] flex-1 shrink-0 items-center gap-1 rounded-t-lg px-2.5 transition-colors";
const TAB_ACTIVE_CLASSES =
  "bg-background text-foreground -mb-px border-b border-b-background shadow-[0_-1px_3px_0_rgba(0,0,0,0.06)]";
const TAB_INACTIVE_CLASSES = "text-muted-foreground hover:bg-muted/40";
const CLOSE_BUTTON_BASE_CLASSES =
  "flex h-5 w-5 items-center justify-center rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const CLOSE_BUTTON_ACTIVE_CLASSES = "opacity-60 hover:bg-muted/50";
const CLOSE_BUTTON_INACTIVE_CLASSES =
  "opacity-0 group-hover:opacity-60 hover:bg-muted/50 focus-visible:opacity-60";

/**
 * Returns an ordered list of chat IDs to display as tabs.
 *
 * @param recentViewedChatIds - IDs in the order they were recently viewed
 * @param chats - All available chats
 * @param closedChatIds - IDs of explicitly closed tabs
 * @param sessionOpenedChatIds - IDs of chats opened in the current session.
 *   If empty, no tabs will be shown (session-scoped behavior). This is intentional:
 *   tabs only appear for chats explicitly opened during the current app session.
 */
export function getOrderedRecentChatIds(
  recentViewedChatIds: number[],
  chats: ChatSummary[],
  closedChatIds: Set<number> = new Set(),
  sessionOpenedChatIds: Set<number> = new Set(),
): number[] {
  if (chats.length === 0) return [];

  const chatIds = new Set(chats.map((chat) => chat.id));
  const ordered: number[] = [];
  const seen = new Set<number>();

  // Helper to check if a chat ID should be shown as a tab
  const canShow = (id: number) =>
    !seen.has(id) && !closedChatIds.has(id) && sessionOpenedChatIds.has(id);

  for (const chatId of recentViewedChatIds) {
    if (chatIds.has(chatId) && canShow(chatId)) {
      ordered.push(chatId);
      seen.add(chatId);
    }
  }

  // Add remaining chats that were opened in this session but not in recentViewedChatIds
  for (const chat of chats) {
    if (canShow(chat.id)) {
      ordered.push(chat.id);
      seen.add(chat.id);
    }
  }

  return ordered;
}

export function getVisibleTabCapacity(
  containerWidth: number,
  totalTabs: number,
  minTabWidth = MIN_VISIBLE_TAB_WIDTH_PX,
): number {
  if (containerWidth <= 0 || totalTabs <= 0) return 0;

  const withoutOverflow = Math.max(
    1,
    Math.floor((containerWidth + TAB_GAP_PX) / (minTabWidth + TAB_GAP_PX)),
  );

  if (totalTabs <= withoutOverflow) {
    return withoutOverflow;
  }

  const withOverflow = Math.max(
    1,
    Math.floor(
      (containerWidth - OVERFLOW_TRIGGER_WIDTH_PX + TAB_GAP_PX) /
        (minTabWidth + TAB_GAP_PX),
    ),
  );

  return Math.min(withOverflow, totalTabs);
}

export function applySelectionToOrderedChatIds(
  orderedChatIds: number[],
  selectedChatId: number,
  visibleTabCount: number,
): number[] {
  const selectedIndex = orderedChatIds.indexOf(selectedChatId);
  if (selectedIndex === -1) {
    // Unknown chat ID — don't modify the order. The caller should
    // ensure selectedChatId is valid before invoking this function.
    return orderedChatIds;
  }

  if (selectedIndex < visibleTabCount) {
    return orderedChatIds;
  }

  const nextIds = [...orderedChatIds];
  nextIds.splice(selectedIndex, 1);
  nextIds.unshift(selectedChatId);
  return nextIds;
}

export function reorderVisibleChatIds(
  orderedChatIds: number[],
  visibleTabCount: number,
  sourceChatId: number,
  targetChatId: number,
): number[] {
  const visibleIds = orderedChatIds.slice(0, visibleTabCount);
  const sourceIndex = visibleIds.indexOf(sourceChatId);
  const targetIndex = visibleIds.indexOf(targetChatId);

  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return orderedChatIds;
  }

  const nextVisible = [...visibleIds];
  const [movedId] = nextVisible.splice(sourceIndex, 1);
  nextVisible.splice(targetIndex, 0, movedId);

  return [...nextVisible, ...orderedChatIds.slice(visibleTabCount)];
}

export function partitionChatsByVisibleCount(
  orderedChats: ChatSummary[],
  visibleTabCount: number,
): { visibleTabs: ChatSummary[]; overflowTabs: ChatSummary[] } {
  return {
    visibleTabs: orderedChats.slice(0, visibleTabCount),
    overflowTabs: orderedChats.slice(visibleTabCount),
  };
}

export function getFallbackChatIdAfterClose(
  tabs: ChatSummary[],
  closedChatId: number,
): number | null {
  const closedIndex = tabs.findIndex((tab) => tab.id === closedChatId);
  if (closedIndex === -1) return null;

  const remainingTabs = tabs.filter((tab) => tab.id !== closedChatId);
  if (remainingTabs.length === 0) return null;

  const fallbackIndex = Math.min(closedIndex, remainingTabs.length - 1);
  return remainingTabs[fallbackIndex]?.id ?? null;
}

interface ChatTabsProps {
  selectedChatId: number | null;
}

export function ChatTabs({ selectedChatId }: ChatTabsProps) {
  const { t } = useTranslation("chat");
  const { chats } = useChats(null);
  const { apps } = useLoadApps();
  const isStreamingById = useAtomValue(isStreamingByIdAtom);
  const recentViewedChatIds = useAtomValue(recentViewedChatIdsAtom);
  const closedChatIds = useAtomValue(closedChatIdsAtom);
  const sessionOpenedChatIds = useAtomValue(sessionOpenedChatIdsAtom);
  const setRecentViewedChatIds = useSetAtom(setRecentViewedChatIdsAtom);
  const removeRecentViewedChatId = useSetAtom(removeRecentViewedChatIdAtom);
  const pushRecentViewedChatId = useSetAtom(pushRecentViewedChatIdAtom);
  const pruneClosedChatIds = useSetAtom(pruneClosedChatIdsAtom);
  const closeMultipleTabs = useSetAtom(closeMultipleTabsAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const virtualTabs = useAtomValue(virtualTabsAtom);
  const activeVirtualTabId = useAtomValue(activeVirtualTabIdAtom);
  const addVirtualTab = useSetAtom(addVirtualTabAtom);
  const removeVirtualTab = useSetAtom(removeVirtualTabAtom);
  const setActiveVirtualTabId = useSetAtom(activeVirtualTabIdAtom);
  const { selectChat } = useSelectChat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isScrollable, setIsScrollable] = useState(false);
  const [scrollThumb, setScrollThumb] = useState({ left: 0, width: 0 });
  const [isHoveringTabs, setIsHoveringTabs] = useState(false);
  const [draggingChatId, setDraggingChatId] = useState<number | null>(null);
  const [notifiedChatIds, setNotifiedChatIds] = useState<Set<number>>(
    new Set(),
  );
  const prevStreamingRef = useRef<Map<number, boolean>>(new Map());

  const chatsById = useMemo(
    () => new Map(chats.map((chat) => [chat.id, chat])),
    [chats],
  );

  // Prune stale IDs from closedChatIds when the chat list changes
  const chatIdSet = useMemo(() => new Set(chats.map((c) => c.id)), [chats]);
  useEffect(() => {
    pruneClosedChatIds(chatIdSet);
  }, [chatIdSet, pruneClosedChatIds]);

  const appNameById = useMemo(
    () => new Map(apps.map((app) => [app.id, app.name])),
    [apps],
  );

  const orderedChatIds = useMemo(
    () =>
      getOrderedRecentChatIds(
        recentViewedChatIds,
        chats,
        closedChatIds,
        sessionOpenedChatIds,
      ),
    [recentViewedChatIds, chats, closedChatIds, sessionOpenedChatIds],
  );

  const orderedChats = useMemo(
    () =>
      orderedChatIds
        .map((chatId) => chatsById.get(chatId))
        .filter((chat): chat is ChatSummary => chat !== undefined),
    [orderedChatIds, chatsById],
  );

  const visibleTabCapacity = useMemo(
    () => getVisibleTabCapacity(containerWidth, orderedChats.length),
    [containerWidth, orderedChats.length],
  );

  const visibleTabCount =
    visibleTabCapacity > 0
      ? visibleTabCapacity
      : Math.min(orderedChats.length, DEFAULT_UNMEASURED_VISIBLE_TABS);

  const { visibleTabs, overflowTabs } = useMemo(
    () => partitionChatsByVisibleCount(orderedChats, visibleTabCount),
    [orderedChats, visibleTabCount],
  );
  const overflowTabsForMenu = useMemo(
    () => overflowTabs.slice(0, MAX_OVERFLOW_MENU_ITEMS),
    [overflowTabs],
  );

  // Re-run when tabs become non-empty so the ResizeObserver attaches
  // after the container div renders (it returns null when there are no tabs).
  const hasTabs = orderedChats.length > 0 || virtualTabs.length > 0;
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateWidth = () => {
      const measuredWidth =
        node.getBoundingClientRect().width ||
        node.clientWidth ||
        node.parentElement?.getBoundingClientRect().width ||
        node.parentElement?.clientWidth ||
        0;
      setContainerWidth(measuredWidth);
    };

    // Measure once on next frame to avoid early 0-width reads during mount/layout.
    const frameId = window.requestAnimationFrame(updateWidth);
    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(node);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [hasTabs]);

  // Detect whether the tabs area is scrollable and track scroll thumb
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const update = () => {
      const scrollable = node.scrollWidth > node.clientWidth;
      setIsScrollable(scrollable);
      if (scrollable) {
        const ratio =
          node.scrollWidth > 0 ? node.clientWidth / node.scrollWidth : 0;
        const thumbWidth =
          node.clientWidth > 0 ? Math.max(ratio * node.clientWidth, 30) : 0;
        const maxScrollLeft = node.scrollWidth - node.clientWidth;
        const scrollRatio =
          maxScrollLeft > 0 ? node.scrollLeft / maxScrollLeft : 0;
        const trackWidth = node.clientWidth - thumbWidth;
        setScrollThumb({ left: scrollRatio * trackWidth, width: thumbWidth });
      }
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [orderedChats.length, virtualTabs.length]);

  // Detect streaming → finished transitions for non-active tabs to show a
  // notification dot.
  useEffect(() => {
    const prev = prevStreamingRef.current;

    setNotifiedChatIds((currentNotified) => {
      const newNotified = new Set(currentNotified);
      let changed = false;

      for (const [chatId, wasStreaming] of prev) {
        const isNowStreaming = isStreamingById.get(chatId) === true;
        if (wasStreaming && !isNowStreaming && chatId !== selectedChatId) {
          newNotified.add(chatId);
          changed = true;
        }
      }

      // Clear notification for the currently viewed tab
      if (selectedChatId !== null && newNotified.has(selectedChatId)) {
        newNotified.delete(selectedChatId);
        changed = true;
      }

      return changed ? newNotified : currentNotified;
    });

    prevStreamingRef.current = new Map(isStreamingById);
  }, [isStreamingById, selectedChatId]);

  const clearNotification = useCallback((chatId: number) => {
    setNotifiedChatIds((prev) => {
      if (!prev.has(chatId)) return prev;
      const next = new Set(prev);
      next.delete(chatId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (
      selectedChatId === null ||
      !chatsById.has(selectedChatId) ||
      containerWidth <= 0
    ) {
      return;
    }

    // If the selected chat was previously closed, re-open it as a tab.
    // This prevents an infinite loop where applySelectionToOrderedChatIds
    // would try to insert an ID that getOrderedRecentChatIds filters out.
    if (closedChatIds.has(selectedChatId)) {
      pushRecentViewedChatId(selectedChatId);
      return;
    }

    const nextIds = applySelectionToOrderedChatIds(
      orderedChatIds,
      selectedChatId,
      visibleTabCount,
    );

    if (!isSameIdOrder(orderedChatIds, nextIds)) {
      setRecentViewedChatIds(nextIds);
    }
  }, [
    chatsById,
    closedChatIds,
    containerWidth,
    orderedChatIds,
    pushRecentViewedChatId,
    selectedChatId,
    setRecentViewedChatIds,
    visibleTabCount,
  ]);

  const handleTabClick = (chat: ChatSummary, fromOverflow = false) => {
    if (fromOverflow) {
      const nextIds = applySelectionToOrderedChatIds(
        orderedChatIds,
        chat.id,
        visibleTabCount,
      );
      if (!isSameIdOrder(orderedChatIds, nextIds)) {
        setRecentViewedChatIds(nextIds);
      }
    }

    clearNotification(chat.id);

    selectChat({
      chatId: chat.id,
      appId: chat.appId,
      preserveTabOrder: true,
    });
  };

  const handleCloseTab = (chatId: number) => {
    // Use orderedChats (all tabs: visible + overflow) instead of just visibleTabs
    const closedTab = chatsById.get(chatId);
    const fallbackChatId = getFallbackChatIdAfterClose(orderedChats, chatId);

    removeRecentViewedChatId(chatId);
    clearNotification(chatId);

    if (!closedTab || selectedChatId !== chatId) {
      return;
    }

    // If no fallback tab (last tab closed), switch to existing virtual tab or create one
    if (fallbackChatId === null) {
      setSelectedChatId(null);
      if (virtualTabs.length > 0) {
        setActiveVirtualTabId(virtualTabs[0].id);
      } else {
        addVirtualTab();
      }
      navigate({ to: "/" });
      return;
    }

    const fallbackTab = chatsById.get(fallbackChatId);
    if (!fallbackTab) return;

    selectChat({
      chatId: fallbackTab.id,
      appId: fallbackTab.appId,
      preserveTabOrder: true,
    });
  };

  // Helper to close multiple tabs and optionally switch to a fallback
  const closeTabsAndClearNotifications = useCallback(
    (idsToClose: number[], fallbackChatId?: number) => {
      if (idsToClose.length === 0) return;

      for (const id of idsToClose) {
        clearNotification(id);
      }

      closeMultipleTabs(idsToClose);

      // Switch to fallback if:
      // - fallback is provided AND
      // - (selected chat is being closed OR selected chat differs from requested fallback)
      if (
        fallbackChatId !== undefined &&
        (idsToClose.includes(selectedChatId ?? -1) ||
          selectedChatId !== fallbackChatId)
      ) {
        const fallbackTab = chatsById.get(fallbackChatId);
        if (fallbackTab) {
          selectChat({
            chatId: fallbackTab.id,
            appId: fallbackTab.appId,
            preserveTabOrder: true,
          });
        }
      }
    },
    [
      clearNotification,
      closeMultipleTabs,
      selectedChatId,
      chatsById,
      selectChat,
    ],
  );

  const handleCloseOtherTabs = (keepChatId: number) => {
    const idsToClose = orderedChatIds.filter((id) => id !== keepChatId);
    // Always switch to the kept tab if we're not already on it
    const fallback = selectedChatId !== keepChatId ? keepChatId : undefined;
    closeTabsAndClearNotifications(idsToClose, fallback);
  };

  const handleCloseTabsToRight = (chatId: number) => {
    const chatIndex = orderedChatIds.indexOf(chatId);
    if (chatIndex === -1) return;

    const idsToClose = orderedChatIds.slice(chatIndex + 1);
    // Only switch to this chat if the selected one is being closed
    const fallback =
      selectedChatId !== null && idsToClose.includes(selectedChatId)
        ? chatId
        : undefined;
    closeTabsAndClearNotifications(idsToClose, fallback);
  };

  // Safety net: ensure at least one tab always exists
  useEffect(() => {
    if (orderedChats.length === 0 && virtualTabs.length === 0) {
      addVirtualTab();
      navigate({ to: "/" });
    }
  }, [orderedChats.length, virtualTabs.length, addVirtualTab, navigate]);

  const handleNewApp = () => {
    // Reuse existing virtual tab if one already exists
    if (virtualTabs.length > 0) {
      setActiveVirtualTabId(virtualTabs[0].id);
      setSelectedChatId(null);
      navigate({ to: "/" });
      return;
    }
    addVirtualTab();
    setSelectedChatId(null);
    navigate({ to: "/" });
  };

  const handleNewChatInApp = async () => {
    if (!selectedAppId) return;
    try {
      const chatId = await ipc.chat.createChat(selectedAppId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      selectChat({ chatId, appId: selectedAppId });
    } catch (error) {
      showError(t("failedCreateChat", { error: (error as Error).toString() }));
    }
  };

  const handleVirtualTabClick = (tabId: VirtualTabId) => {
    setActiveVirtualTabId(tabId);
    setSelectedChatId(null);
    navigate({ to: "/" });
  };

  const handleCloseVirtualTab = (tabId: VirtualTabId) => {
    removeVirtualTab(tabId);

    if (activeVirtualTabId === tabId) {
      const remaining = virtualTabs.filter((t) => t.id !== tabId);
      if (remaining.length > 0) {
        setActiveVirtualTabId(remaining[remaining.length - 1].id);
        navigate({ to: "/" });
      } else if (orderedChats.length > 0) {
        const fallback = orderedChats[0];
        selectChat({
          chatId: fallback.id,
          appId: fallback.appId,
          preserveTabOrder: true,
        });
      }
    }
  };

  if (orderedChats.length === 0 && virtualTabs.length === 0) return null;

  return (
    <TooltipProvider delay={500}>
      <div
        ref={containerRef}
        className="relative flex min-w-0 items-center border-b border-border px-2 pt-1"
      >
        <div
          className="relative flex min-w-0 flex-1 items-center"
          onMouseEnter={() => setIsHoveringTabs(true)}
          onMouseLeave={() => setIsHoveringTabs(false)}
        >
          <div
            ref={scrollRef}
            className="hide-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto"
          >
            {visibleTabs.map((chat, index) => {
              const isActive = selectedChatId === chat.id;
              const isNextActive =
                index < visibleTabs.length - 1 &&
                selectedChatId === visibleTabs[index + 1].id;
              const title = chat.title?.trim() || t("newChat");
              const appName =
                appNameById.get(chat.appId) ?? `App ${chat.appId}`;
              const titleExcerpt = getChatTitleExcerpt(title);
              const isDragging = draggingChatId === chat.id;
              const inProgress = isStreamingById.get(chat.id) === true;
              const hasNotification =
                !inProgress && notifiedChatIds.has(chat.id);

              const tabIndex = orderedChatIds.indexOf(chat.id);
              const hasTabsToRight =
                tabIndex !== -1 && tabIndex < orderedChatIds.length - 1;
              const hasOtherTabs = orderedChatIds.length > 1;

              return (
                <ContextMenu key={chat.id}>
                  <ContextMenuTrigger>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <div
                            draggable
                            onAuxClick={(event) => {
                              // Middle-click (button 1) to close tab
                              if (event.button === 1) {
                                event.preventDefault();
                                handleCloseTab(chat.id);
                              }
                            }}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData(
                                "text/plain",
                                String(chat.id),
                              );
                              setDraggingChatId(chat.id);
                            }}
                            onDragEnd={() => setDraggingChatId(null)}
                            onDragOver={(event) => {
                              if (
                                draggingChatId === null ||
                                draggingChatId === chat.id
                              ) {
                                return;
                              }
                              event.preventDefault();
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (
                                draggingChatId === null ||
                                draggingChatId === chat.id
                              ) {
                                return;
                              }

                              const nextIds = reorderVisibleChatIds(
                                orderedChatIds,
                                visibleTabs.length,
                                draggingChatId,
                                chat.id,
                              );
                              if (!isSameIdOrder(orderedChatIds, nextIds)) {
                                setRecentViewedChatIds(nextIds);
                              }
                              setDraggingChatId(null);
                            }}
                            className={cn(
                              TAB_BASE_CLASSES,
                              isActive
                                ? TAB_ACTIVE_CLASSES
                                : TAB_INACTIVE_CLASSES,
                              isDragging && "opacity-60",
                              // Chrome-style divider on right edge
                              !isActive &&
                                !isNextActive &&
                                index < visibleTabs.length - 1 &&
                                "after:absolute after:right-0 after:top-1/4 after:h-1/2 after:w-px after:bg-border",
                            )}
                          />
                        }
                      >
                        {inProgress && (
                          <span
                            className="flex items-center text-purple-600"
                            aria-label={t("chatInProgress")}
                            title={t("chatInProgress")}
                          >
                            <Loader2 size={12} className="animate-spin" />
                          </span>
                        )}
                        {hasNotification && (
                          <span
                            className="flex items-center"
                            aria-label={t("newActivity")}
                            title={t("newActivity")}
                          >
                            <span className="h-2 w-2 rounded-full bg-blue-500" />
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleTabClick(chat)}
                          className="min-w-0 flex-1 text-left rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          aria-current={isActive ? "page" : undefined}
                        >
                          <span className="block truncate text-sm">
                            {appName} &middot; {title}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleCloseTab(chat.id);
                          }}
                          className={cn(
                            CLOSE_BUTTON_BASE_CLASSES,
                            isActive
                              ? CLOSE_BUTTON_ACTIVE_CLASSES
                              : CLOSE_BUTTON_INACTIVE_CLASSES,
                          )}
                          aria-label={t("closeChatTab", { title })}
                        >
                          <X size={12} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        align="start"
                        sideOffset={6}
                        className="max-w-80 !rounded-lg !border !border-border !bg-popover !px-3.5 !py-2.5 !text-popover-foreground !shadow-lg [&>:last-child]:!hidden"
                      >
                        <div className="min-w-0">
                          <div className="text-[11px] leading-4 break-words">
                            <span className="font-semibold">{appName}</span>
                            <span className="opacity-70">
                              {" "}
                              &middot; {titleExcerpt}
                            </span>
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => handleCloseTab(chat.id)}>
                      {t("closeTab")}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={() => handleCloseOtherTabs(chat.id)}
                      disabled={!hasOtherTabs}
                    >
                      {t("closeOtherTabs")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => handleCloseTabsToRight(chat.id)}
                      disabled={!hasTabsToRight}
                    >
                      {t("closeTabsToRight")}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
            {virtualTabs.map((vt) => {
              const isActive =
                activeVirtualTabId === vt.id && selectedChatId === null;
              const isOnlyTab =
                orderedChats.length === 0 && virtualTabs.length === 1;
              return (
                <div
                  key={vt.id}
                  onAuxClick={(event) => {
                    if (event.button === 1 && !isOnlyTab) {
                      event.preventDefault();
                      handleCloseVirtualTab(vt.id);
                    }
                  }}
                  className={cn(
                    TAB_BASE_CLASSES,
                    "max-w-[200px]",
                    isActive ? TAB_ACTIVE_CLASSES : TAB_INACTIVE_CLASSES,
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleVirtualTabClick(vt.id)}
                    className="min-w-0 flex-1 text-left rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span className="block truncate text-sm">
                      {t("newAppTab")}
                    </span>
                  </button>
                  {!isOnlyTab && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseVirtualTab(vt.id);
                      }}
                      className={cn(
                        CLOSE_BUTTON_BASE_CLASSES,
                        isActive
                          ? CLOSE_BUTTON_ACTIVE_CLASSES
                          : CLOSE_BUTTON_INACTIVE_CLASSES,
                      )}
                      aria-label={t("closeChatTab", { title: t("newAppTab") })}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              );
            })}
            {!isScrollable && (
              <NewTabDropdown
                onNewApp={handleNewApp}
                onNewChatInApp={handleNewChatInApp}
                newChatDisabled={selectedAppId === null}
              />
            )}
          </div>
          {isScrollable && (
            <NewTabDropdown
              onNewApp={handleNewApp}
              onNewChatInApp={handleNewChatInApp}
              newChatDisabled={selectedAppId === null}
            />
          )}
          {isScrollable && isHoveringTabs && (
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[5px]">
              <div
                className="absolute top-0 h-full rounded-full bg-foreground/30 transition-opacity"
                style={{ left: scrollThumb.left, width: scrollThumb.width }}
              />
            </div>
          )}
        </div>

        {overflowTabs.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex h-7 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("openOverflowTabs", {
                count: overflowTabs.length,
              })}
            >
              <MoreHorizontal size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {overflowTabsForMenu.map((chat) => {
                const title = chat.title?.trim() || t("newChat");
                const appName =
                  appNameById.get(chat.appId) ?? `App ${chat.appId}`;
                const inProgress = isStreamingById.get(chat.id) === true;
                const hasNotification =
                  !inProgress && notifiedChatIds.has(chat.id);
                return (
                  <DropdownMenuItem
                    key={chat.id}
                    onClick={() => handleTabClick(chat, true)}
                    onAuxClick={(event) => {
                      if (event.button === 1) {
                        event.preventDefault();
                        handleCloseTab(chat.id);
                      }
                    }}
                    className="flex items-center gap-2"
                  >
                    {inProgress && (
                      <span
                        className="flex items-center text-purple-600"
                        aria-label={t("chatInProgress")}
                        title={t("chatInProgress")}
                      >
                        <Loader2 size={12} className="animate-spin" />
                      </span>
                    )}
                    {hasNotification && (
                      <span
                        className="flex items-center"
                        aria-label={t("newActivity")}
                        title={t("newActivity")}
                      >
                        <span className="h-2 w-2 rounded-full bg-blue-500" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {appName} &middot; {title}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleCloseTab(chat.id);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={t("closeChatTab", { title })}
                    >
                      <X size={12} />
                    </button>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </TooltipProvider>
  );
}

function isSameIdOrder(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function getChatTitleExcerpt(title: string, maxLength = 140): string {
  if (title.length <= maxLength) return title;
  return `${title.slice(0, maxLength - 3)}...`;
}
