import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import {
  differenceInCalendarDays,
  formatDistanceToNow,
  isToday,
  isYesterday,
} from "date-fns";
import {
  PlusCircle,
  MoreVertical,
  Trash2,
  Edit3,
  Search,
  ArrowLeft,
  Star,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  Virtuoso,
  type ItemProps,
  type ListProps,
  type VirtuosoHandle,
} from "react-virtuoso";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  selectedChatIdAtom,
  removeChatIdFromAllTrackingAtom,
  ensureRecentViewedChatIdAtom,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { dropdownOpenAtom } from "@/atoms/uiAtoms";
import { ipc } from "@/ipc/types";
import { showError, showSuccess } from "@/lib/toast";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChats } from "@/hooks/useChats";
import { AppAvatar } from "@/components/AppAvatar";
import { RenameChatDialog } from "@/components/chat/RenameChatDialog";
import { DeleteChatDialog } from "@/components/chat/DeleteChatDialog";

import { ChatSearchDialog } from "./ChatSearchDialog";
import { useSelectChat } from "@/hooks/useSelectChat";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useSetChatFavorite } from "@/hooks/useSetChatFavorite";
import { useReducedMotionPref } from "@/hooks/useReducedMotion";
import type { ChatSummary } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const CHAT_ACTION_SPRING = {
  type: "spring" as const,
  stiffness: 750,
  damping: 34,
  mass: 0.45,
};

// Above this many chats, only the rows near the viewport are rendered. Every
// row mounts motion values, a menu and icons, so a full list of thousands of
// chats blocks the renderer for seconds each time the sidebar opens.
const VIRTUALIZE_CHAT_LIST_THRESHOLD = 100;

// Rows rendered before Virtuoso has measured the sidebar, so the list is not
// blank for a frame when it first opens.
const VIRTUAL_CHAT_LIST_INITIAL_ROWS = 30;

type ChatListRowItem =
  | { kind: "group"; key: string; label: string; isFirst: boolean }
  | { kind: "chat"; chat: ChatSummary };

function VirtualChatListRoot({ children, style, ref }: ListProps) {
  return (
    <div
      ref={ref}
      style={style}
      role="list"
      data-slot="sidebar-menu"
      className="flex w-full min-w-0 flex-col"
    >
      {children}
    </div>
  );
}

function VirtualChatListItem({
  item,
  children,
  ...props
}: ItemProps<ChatListRowItem>) {
  return (
    <div
      {...props}
      // Group headers are labels, not chats.
      role={item?.kind === "group" ? "presentation" : "listitem"}
      className="relative pb-1"
    >
      {children}
    </div>
  );
}

export function ChatList({
  show,
  showViewAllAppsButton,
  onViewAllApps,
  appId,
}: {
  show?: boolean;
  showViewAllAppsButton?: boolean;
  onViewAllApps?: () => void;
  /**
   * The app whose chats to list. Defaults to the selected app. The sidebar
   * passes it explicitly so a list that is animating out keeps showing its
   * own app's chats instead of re-rendering with every chat of every app
   * once the selection is cleared.
   */
  appId?: number | null;
}) {
  const { t } = useTranslation("chat");
  const navigate = useNavigate();
  const [selectedChatId, setSelectedChatId] = useAtom(selectedChatIdAtom);
  const atomSelectedAppId = useAtomValue(selectedAppIdAtom);
  const selectedAppId = appId === undefined ? atomSelectedAppId : appId;
  const [, setIsDropdownOpen] = useAtom(dropdownOpenAtom);

  const { chats, loading, invalidateChats } = useChats(selectedAppId);
  const { apps } = useLoadApps();
  const selectedApp = apps.find((app) => app.id === selectedAppId);

  const chatGroups = useMemo(() => {
    const favorites: typeof chats = [];
    const today: typeof chats = [];
    const yesterday: typeof chats = [];
    const thisWeek: typeof chats = [];
    const older: typeof chats = [];
    const now = new Date();

    for (const chat of chats) {
      if (chat.isFavorite) {
        favorites.push(chat);
        continue;
      }
      const date = new Date(chat.createdAt);
      if (isToday(date)) today.push(chat);
      else if (isYesterday(date)) yesterday.push(chat);
      else if (differenceInCalendarDays(now, date) < 7) thisWeek.push(chat);
      else older.push(chat);
    }

    return [
      { key: "favorites", label: t("favoriteChats"), chats: favorites },
      { key: "today", label: t("groupToday"), chats: today },
      { key: "yesterday", label: t("groupYesterday"), chats: yesterday },
      { key: "thisWeek", label: t("groupThisWeek"), chats: thisWeek },
      { key: "older", label: t("groupOlder"), chats: older },
    ].filter((group) => group.chats.length > 0);
  }, [chats, t]);
  const shouldVirtualize = chats.length > VIRTUALIZE_CHAT_LIST_THRESHOLD;
  const virtualRows = useMemo<ChatListRowItem[]>(() => {
    if (!shouldVirtualize) return [];
    return chatGroups.flatMap((group, index) => [
      {
        kind: "group" as const,
        key: group.key,
        label: group.label,
        isFirst: index === 0,
      },
      ...group.chats.map((chat) => ({ kind: "chat" as const, chat })),
    ]);
  }, [chatGroups, shouldVirtualize]);
  const routerState = useRouterState();
  const isChatRoute = routerState.location.pathname === "/chat";

  // Rename dialog state
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [renameChatId, setRenameChatId] = useState<number | null>(null);
  const [renameChatTitle, setRenameChatTitle] = useState("");

  // Delete dialog state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteChatId, setDeleteChatId] = useState<number | null>(null);
  const [deleteChatTitle, setDeleteChatTitle] = useState("");

  // search dialog state
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);
  const { selectChat } = useSelectChat();
  const setChatFavorite = useSetChatFavorite();
  const reducedMotion = useReducedMotionPref();
  const [pendingFavoriteChatIds, setPendingFavoriteChatIds] = useState(
    () => new Set<number>(),
  );
  const [confirmedFavoriteChatIds, setConfirmedFavoriteChatIds] = useState(
    () => new Set<number>(),
  );
  const [favoriteAnnouncement, setFavoriteAnnouncement] = useState("");
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null);
  const favoriteButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const pendingFavoriteChatIdsRef = useRef(new Set<number>());
  const pendingFavoriteFocusChatId = useRef<number | null>(null);
  // A chat scrolled to because its row was not rendered; its favorite button
  // takes focus as soon as the row mounts.
  const scrolledFavoriteFocusChatId = useRef<number | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const virtualRowsRef = useRef(virtualRows);
  virtualRowsRef.current = virtualRows;
  const favoriteAnimationTimers = useRef(new Map<number, number>());
  const removeChatIdFromAllTracking = useSetAtom(
    removeChatIdFromAllTrackingAtom,
  );
  const ensureRecentViewedChatId = useSetAtom(ensureRecentViewedChatIdAtom);

  const restoreFavoriteFocus = (chatId: number) => {
    pendingFavoriteFocusChatId.current = null;
    scrolledFavoriteFocusChatId.current = null;
    const button = favoriteButtonRefs.current.get(chatId);
    if (button) {
      button.focus({ preventScroll: true });
      return;
    }
    // In a virtualized list the chat may have moved outside the rendered rows.
    const index = virtualRowsRef.current.findIndex(
      (row) => row.kind === "chat" && row.chat.id === chatId,
    );
    if (index >= 0 && virtuosoRef.current) {
      scrolledFavoriteFocusChatId.current = chatId;
      virtuosoRef.current.scrollToIndex({ index, align: "center" });
    }
  };

  useEffect(() => {
    const chatId = pendingFavoriteFocusChatId.current;
    if (chatId === null) return;

    const frame = window.requestAnimationFrame(() =>
      restoreFavoriteFocus(chatId),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [chats]);

  useEffect(
    () => () => {
      for (const timer of favoriteAnimationTimers.current.values()) {
        window.clearTimeout(timer);
      }
    },
    [],
  );

  // Update selectedChatId when route changes and ensure chat appears in tabs.
  // Uses ensureRecentViewedChatId (not push) to avoid moving existing tabs to
  // the front on every navigation, which would defeat preserveTabOrder and
  // drag-to-reorder.
  useEffect(() => {
    if (isChatRoute) {
      const id = routerState.location.search.id;
      const chatId = Number(id);
      if (Number.isFinite(chatId) && chatId > 0) {
        setSelectedChatId(chatId);
        ensureRecentViewedChatId(chatId);
      }
    }
  }, [
    isChatRoute,
    routerState.location.search,
    setSelectedChatId,
    ensureRecentViewedChatId,
  ]);

  if (!show) {
    return;
  }

  const handleChatClick = ({
    chatId,
    appId,
  }: {
    chatId: number;
    appId: number;
  }) => {
    selectChat({ chatId, appId });
    setIsSearchDialogOpen(false);
  };

  const handleNewChat = async () => {
    // Only create a new chat if an app is selected
    if (selectedAppId) {
      try {
        // Create a new chat with an empty title for now
        const chatId = await ipc.chat.createChat({ appId: selectedAppId });

        // Refresh the chat list first so the new chat is in the cache
        // before selectChat adds it to the tab bar
        await invalidateChats();

        // Navigate to the new chat (use selectChat so it appears at front of tab bar)
        selectChat({ chatId, appId: selectedAppId });
      } catch (error) {
        // DO A TOAST
        showError(t("failedCreateChat", { error: (error as any).toString() }));
      }
    } else {
      // If no app is selected, navigate to home page
      navigate({ to: "/" });
    }
  };

  const handleDeleteChat = async (chatId: number) => {
    try {
      await ipc.chat.deleteChat(chatId);
      showSuccess(t("chatDeleted"));

      // Remove from tab tracking to prevent stale IDs
      removeChatIdFromAllTracking(chatId);

      // If the deleted chat was selected, navigate to home (matches tab-close behavior)
      if (selectedChatId === chatId) {
        setSelectedChatId(null);
        if (selectedAppId) {
          navigate({ to: "/app-details", search: { appId: selectedAppId } });
        } else {
          navigate({ to: "/" });
        }
      }

      // Refresh the chat list
      await invalidateChats();
    } catch (error) {
      showError(t("failedDeleteChat", { error: (error as any).toString() }));
    }
  };

  const handleDeleteChatClick = (chatId: number, chatTitle: string) => {
    setDeleteChatId(chatId);
    setDeleteChatTitle(chatTitle);
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (deleteChatId !== null) {
      await handleDeleteChat(deleteChatId);
      setIsDeleteDialogOpen(false);
      setDeleteChatId(null);
      setDeleteChatTitle("");
    }
  };

  const handleRenameChat = (chatId: number, currentTitle: string) => {
    setRenameChatId(chatId);
    setRenameChatTitle(currentTitle);
    setIsRenameDialogOpen(true);
  };

  const handleRenameDialogClose = (open: boolean) => {
    setIsRenameDialogOpen(open);
    if (!open) {
      setRenameChatId(null);
      setRenameChatTitle("");
    }
  };

  const handleSetChatFavorite = async ({
    chatId,
    appId,
    title,
    isFavorite,
    restoreFocus,
  }: {
    chatId: number;
    appId: number;
    title: string;
    isFavorite: boolean;
    restoreFocus: boolean;
  }) => {
    if (pendingFavoriteChatIdsRef.current.has(chatId)) return;

    pendingFavoriteChatIdsRef.current.add(chatId);
    setPendingFavoriteChatIds((current) => new Set(current).add(chatId));
    if (restoreFocus) {
      pendingFavoriteFocusChatId.current = chatId;
    }

    try {
      await setChatFavorite.mutateAsync({ chatId, appId, isFavorite });
      setFavoriteAnnouncement(
        t(isFavorite ? "chatAddedToFavorites" : "chatRemovedFromFavorites", {
          title,
        }),
      );
      setConfirmedFavoriteChatIds((current) => new Set(current).add(chatId));

      const existingTimer = favoriteAnimationTimers.current.get(chatId);
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      favoriteAnimationTimers.current.set(
        chatId,
        window.setTimeout(() => {
          setConfirmedFavoriteChatIds((current) => {
            const next = new Set(current);
            next.delete(chatId);
            return next;
          });
          favoriteAnimationTimers.current.delete(chatId);
        }, 240),
      );
    } catch (error) {
      if (restoreFocus) {
        pendingFavoriteFocusChatId.current = chatId;
        window.requestAnimationFrame(() => restoreFavoriteFocus(chatId));
      }
      showError(
        t("failedUpdateChatFavorite", { error: (error as Error).message }),
      );
    } finally {
      pendingFavoriteChatIdsRef.current.delete(chatId);
      setPendingFavoriteChatIds((current) => {
        const next = new Set(current);
        next.delete(chatId);
        return next;
      });
    }
  };

  const renderChatRow = (chat: ChatSummary) => (
    <ChatRow
      chat={chat}
      isSelected={selectedChatId === chat.id}
      isFavoritePending={pendingFavoriteChatIds.has(chat.id)}
      isFavoriteConfirmed={confirmedFavoriteChatIds.has(chat.id)}
      reducedMotion={reducedMotion}
      onSelect={() => handleChatClick({ chatId: chat.id, appId: chat.appId })}
      onToggleFavorite={(restoreFocus) =>
        void handleSetChatFavorite({
          chatId: chat.id,
          appId: chat.appId,
          title: chat.title || t("newChat"),
          isFavorite: !chat.isFavorite,
          restoreFocus,
        })
      }
      onRename={() => handleRenameChat(chat.id, chat.title || "")}
      onDelete={() =>
        handleDeleteChatClick(chat.id, chat.title || t("newChat"))
      }
      onActionsOpenChange={setIsDropdownOpen}
      favoriteButtonRef={(element) => {
        if (element) {
          favoriteButtonRefs.current.set(chat.id, element);
          if (scrolledFavoriteFocusChatId.current === chat.id) {
            scrolledFavoriteFocusChatId.current = null;
            element.focus({ preventScroll: true });
          }
        } else {
          favoriteButtonRefs.current.delete(chat.id);
        }
      }}
    />
  );

  return (
    <>
      <SidebarGroup
        ref={setScrollParent}
        className="h-[calc(100vh-112px-var(--layout-bottom-bar-height))] overflow-x-hidden overflow-y-auto"
        data-testid="chat-list-container"
      >
        {showViewAllAppsButton && (
          <div className="mx-2 mb-2 flex min-w-0 items-center gap-1">
            <Button
              onClick={onViewAllApps}
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 cursor-pointer hover:bg-sidebar-accent"
              title={t("viewAllApps")}
              aria-label={t("viewAllApps")}
              data-testid="view-all-apps-button"
            >
              <ArrowLeft size={16} />
            </Button>
            {selectedApp && (
              <>
                <AppAvatar
                  appId={selectedApp.id}
                  name={selectedApp.name}
                  className="h-5 w-5 rounded text-[9px]"
                />
                <div
                  className="min-w-0 flex-1 truncate text-sm font-semibold text-sidebar-foreground"
                  title={selectedApp.name}
                >
                  {selectedApp.name}
                </div>
              </>
            )}
          </div>
        )}
        <SidebarGroupContent>
          <div className="flex flex-col space-y-4">
            <div className="mx-2 flex items-center gap-2">
              <Button
                onClick={handleNewChat}
                variant="outline"
                className="flex flex-1 items-center justify-start gap-2 py-3"
                data-testid="new-chat-button"
              >
                <PlusCircle size={16} />
                <span>{t("newChat")}</span>
              </Button>
              <Button
                onClick={() => setIsSearchDialogOpen(!isSearchDialogOpen)}
                variant="outline"
                className="flex shrink-0 items-center justify-center py-3 px-3"
                title={t("searchChats")}
                aria-label={t("searchChats")}
                data-testid="search-chats-button"
              >
                <Search size={16} />
              </Button>
            </div>

            {loading ? (
              <div className="py-3 px-4 text-sm text-gray-500">
                {t("loadingChats")}
              </div>
            ) : chats.length === 0 ? (
              <div className="py-3 px-4 text-sm text-gray-500">
                {t("noChatsFound")}
              </div>
            ) : shouldVirtualize ? (
              scrollParent && (
                <Virtuoso
                  ref={virtuosoRef}
                  customScrollParent={scrollParent}
                  initialItemCount={Math.min(
                    virtualRows.length,
                    VIRTUAL_CHAT_LIST_INITIAL_ROWS,
                  )}
                  data={virtualRows}
                  computeItemKey={(_, row) =>
                    row.kind === "group"
                      ? `group-${row.key}`
                      : `chat-${row.chat.id}`
                  }
                  components={{
                    List: VirtualChatListRoot,
                    Item: VirtualChatListItem,
                  }}
                  itemContent={(_, row) =>
                    row.kind === "group" ? (
                      <div
                        className={cn(
                          "px-3 text-xs font-medium text-muted-foreground",
                          !row.isFirst && "pt-2",
                        )}
                        data-testid={`chat-group-${row.key}`}
                      >
                        {row.label}
                      </div>
                    ) : (
                      renderChatRow(row.chat)
                    )
                  }
                />
              )
            ) : (
              <div className="flex flex-col space-y-3">
                {chatGroups.map((group) => (
                  <div key={group.key} data-testid={`chat-group-${group.key}`}>
                    <div className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                      {group.label}
                    </div>
                    <SidebarMenu className="space-y-1">
                      {group.chats.map((chat) => (
                        <SidebarMenuItem key={chat.id} className="mb-1">
                          {renderChatRow(chat)}
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>

      {/* Rename Chat Dialog */}
      {renameChatId !== null && (
        <RenameChatDialog
          chatId={renameChatId}
          currentTitle={renameChatTitle}
          isOpen={isRenameDialogOpen}
          onOpenChange={handleRenameDialogClose}
          onRename={invalidateChats}
        />
      )}

      {/* Delete Chat Dialog */}
      <DeleteChatDialog
        isOpen={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirmDelete={handleConfirmDelete}
        chatTitle={deleteChatTitle}
      />

      {/* Chat Search Dialog */}
      <ChatSearchDialog
        open={isSearchDialogOpen}
        onOpenChange={setIsSearchDialogOpen}
        onSelectChat={handleChatClick}
        appId={selectedAppId}
        allChats={chats}
      />
      <p className="sr-only" role="status" aria-live="polite">
        {favoriteAnnouncement}
      </p>
    </>
  );
}

// Hover, focus and menu state live in each row so that moving the pointer
// across the list re-renders one row instead of all of them.
function ChatRow({
  chat,
  isSelected,
  isFavoritePending,
  isFavoriteConfirmed,
  reducedMotion,
  onSelect,
  onToggleFavorite,
  onRename,
  onDelete,
  onActionsOpenChange,
  favoriteButtonRef,
}: {
  chat: ChatSummary;
  isSelected: boolean;
  isFavoritePending: boolean;
  isFavoriteConfirmed: boolean;
  reducedMotion: boolean;
  onSelect: () => void;
  onToggleFavorite: (restoreFocus: boolean) => void;
  onRename: () => void;
  onDelete: () => void;
  onActionsOpenChange: (open: boolean) => void;
  favoriteButtonRef: (element: HTMLButtonElement | null) => void;
}) {
  const { t } = useTranslation("chat");
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const isActionsOpenRef = useRef(false);
  const title = chat.title || t("newChat");

  // A row scrolled out of a virtualized list unmounts without its menu
  // closing, so release the shared open-menu flag here.
  useEffect(
    () => () => {
      if (isActionsOpenRef.current) onActionsOpenChange(false);
    },
    [onActionsOpenChange],
  );

  return (
    <div
      className="group/chat-row relative flex w-full items-center"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocusCapture={() => setIsFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsFocused(false);
        }
      }}
    >
      <Button
        variant="ghost"
        onClick={onSelect}
        className={`justify-start w-full text-left py-3 pr-14 hover:bg-sidebar-accent/80 ${
          isSelected ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""
        }`}
        data-testid={`chat-list-item-${chat.id}`}
      >
        <div className="flex flex-col w-full">
          <span className="truncate">{title}</span>
          <span className="text-xs text-gray-500">
            {formatDistanceToNow(new Date(chat.createdAt), {
              addSuffix: true,
            })}
          </span>
        </div>
      </Button>

      <div className="absolute right-0 flex w-14 items-center">
        <motion.button
          ref={favoriteButtonRef}
          type="button"
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-[#6c55dc] focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            "aria-disabled:cursor-wait aria-disabled:opacity-60",
            !chat.isFavorite &&
              !isFavoriteConfirmed &&
              "pointer-events-none opacity-0 group-focus-within/chat-row:pointer-events-auto group-focus-within/chat-row:opacity-100",
            chat.isFavorite && "text-[#6c55dc]",
            "transition-[opacity,color] duration-200 ease-out motion-reduce:transition-none",
          )}
          initial={false}
          animate={{
            x:
              chat.isFavorite && !isHovered && !isFocused && !isActionsOpen
                ? 28
                : 0,
          }}
          transition={reducedMotion ? { duration: 0 } : CHAT_ACTION_SPRING}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(event.detail === 0);
          }}
          aria-disabled={isFavoritePending}
          aria-label={t(
            chat.isFavorite ? "removeChatFromFavorites" : "addChatToFavorites",
            { title },
          )}
          aria-pressed={chat.isFavorite}
          title={t(chat.isFavorite ? "removeFromFavorites" : "addToFavorites")}
          data-testid={`chat-favorite-button-${chat.id}`}
        >
          <motion.span
            className="flex"
            initial={false}
            animate={
              isFavoriteConfirmed && !reducedMotion
                ? { scale: [0.8, 1.2, 1] }
                : { scale: 1 }
            }
            transition={{
              duration: 0.22,
              ease: "easeOut",
            }}
          >
            <Star
              className={cn(
                "h-4 w-4 transition-colors motion-reduce:transition-none",
                chat.isFavorite && "fill-current",
              )}
            />
          </motion.span>
        </motion.button>

        <DropdownMenu
          modal={false}
          onOpenChange={(open) => {
            onActionsOpenChange(open);
            isActionsOpenRef.current = open;
            setIsActionsOpen(open);
          }}
        >
          <DropdownMenuTrigger
            className={buttonVariants({
              variant: "ghost",
              size: "icon",
              className:
                "pointer-events-none h-7 w-7 translate-x-1 scale-90 opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover/chat-row:pointer-events-auto group-hover/chat-row:translate-x-0 group-hover/chat-row:scale-100 group-hover/chat-row:opacity-100 group-focus-within/chat-row:pointer-events-auto group-focus-within/chat-row:translate-x-0 group-focus-within/chat-row:scale-100 group-focus-within/chat-row:opacity-100 data-popup-open:pointer-events-auto data-popup-open:translate-x-0 data-popup-open:scale-100 data-popup-open:opacity-100 motion-reduce:transition-none",
            })}
            onClick={(e) => e.stopPropagation()}
            aria-label={t("chatActions", { title })}
          >
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="space-y-1 p-2">
            <DropdownMenuItem
              onClick={(event) => onToggleFavorite(event.detail === 0)}
              disabled={isFavoritePending}
              className="px-3 py-2"
            >
              <Star
                className={cn(
                  "mr-2 h-4 w-4",
                  chat.isFavorite && "fill-current",
                )}
              />
              <span>
                {t(chat.isFavorite ? "removeFromFavorites" : "addToFavorites")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRename} className="px-3 py-2">
              <Edit3 className="mr-2 h-4 w-4" />
              <span>{t("renameChat")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 focus:bg-red-50 dark:focus:bg-red-950/50"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              <span>{t("deleteChat")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
