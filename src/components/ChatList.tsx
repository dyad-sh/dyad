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
import { useAtom, useSetAtom } from "jotai";
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
import { cn } from "@/lib/utils";
import { useEntityDisposal } from "@/state_machines/react";

const CHAT_ACTION_SPRING = {
  type: "spring" as const,
  stiffness: 750,
  damping: 34,
  mass: 0.45,
};

export function ChatList({
  show,
  showViewAllAppsButton,
  onViewAllApps,
}: {
  show?: boolean;
  showViewAllAppsButton?: boolean;
  onViewAllApps?: () => void;
}) {
  const { t } = useTranslation("chat");
  const navigate = useNavigate();
  const [selectedChatId, setSelectedChatId] = useAtom(selectedChatIdAtom);
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const [, setIsDropdownOpen] = useAtom(dropdownOpenAtom);
  const entityDisposal = useEntityDisposal();

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
  const [hoveredChatActionsId, setHoveredChatActionsId] = useState<
    number | null
  >(null);
  const [focusedChatActionsId, setFocusedChatActionsId] = useState<
    number | null
  >(null);
  const [openChatActionsId, setOpenChatActionsId] = useState<number | null>(
    null,
  );
  const favoriteButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const pendingFavoriteChatIdsRef = useRef(new Set<number>());
  const pendingFavoriteFocusChatId = useRef<number | null>(null);
  const favoriteAnimationTimers = useRef(new Map<number, number>());
  const removeChatIdFromAllTracking = useSetAtom(
    removeChatIdFromAllTrackingAtom,
  );
  const ensureRecentViewedChatId = useSetAtom(ensureRecentViewedChatIdAtom);

  useEffect(() => {
    const chatId = pendingFavoriteFocusChatId.current;
    if (chatId === null) return;

    const frame = window.requestAnimationFrame(() => {
      favoriteButtonRefs.current.get(chatId)?.focus({ preventScroll: true });
      pendingFavoriteFocusChatId.current = null;
    });
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
      entityDisposal.disposeForChat(chatId);
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
        window.requestAnimationFrame(() => {
          favoriteButtonRefs.current
            .get(chatId)
            ?.focus({ preventScroll: true });
          pendingFavoriteFocusChatId.current = null;
        });
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

  return (
    <>
      <SidebarGroup
        className="h-[calc(100vh-112px)] overflow-x-hidden overflow-y-auto"
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
                          <div
                            className="group/chat-row relative flex w-full items-center"
                            onMouseEnter={() =>
                              setHoveredChatActionsId(chat.id)
                            }
                            onMouseLeave={() => setHoveredChatActionsId(null)}
                            onFocusCapture={() =>
                              setFocusedChatActionsId(chat.id)
                            }
                            onBlurCapture={(event) => {
                              if (
                                !event.currentTarget.contains(
                                  event.relatedTarget as Node | null,
                                )
                              ) {
                                setFocusedChatActionsId(null);
                              }
                            }}
                          >
                            <Button
                              variant="ghost"
                              onClick={() =>
                                handleChatClick({
                                  chatId: chat.id,
                                  appId: chat.appId,
                                })
                              }
                              className={`justify-start w-full text-left py-3 pr-14 hover:bg-sidebar-accent/80 ${
                                selectedChatId === chat.id
                                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                  : ""
                              }`}
                              data-testid={`chat-list-item-${chat.id}`}
                            >
                              <div className="flex flex-col w-full">
                                <span className="truncate">
                                  {chat.title || t("newChat")}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {formatDistanceToNow(
                                    new Date(chat.createdAt),
                                    { addSuffix: true },
                                  )}
                                </span>
                              </div>
                            </Button>

                            <div className="absolute right-0 flex w-14 items-center">
                              <motion.button
                                ref={(element) => {
                                  if (element) {
                                    favoriteButtonRefs.current.set(
                                      chat.id,
                                      element,
                                    );
                                  } else {
                                    favoriteButtonRefs.current.delete(chat.id);
                                  }
                                }}
                                type="button"
                                className={cn(
                                  "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-[#6c55dc] focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                                  "aria-disabled:cursor-wait aria-disabled:opacity-60",
                                  !chat.isFavorite &&
                                    !confirmedFavoriteChatIds.has(chat.id) &&
                                    "pointer-events-none opacity-0 group-focus-within/chat-row:pointer-events-auto group-focus-within/chat-row:opacity-100",
                                  chat.isFavorite && "text-[#6c55dc]",
                                  "transition-[opacity,color] duration-200 ease-out motion-reduce:transition-none",
                                )}
                                initial={false}
                                animate={{
                                  x:
                                    chat.isFavorite &&
                                    hoveredChatActionsId !== chat.id &&
                                    focusedChatActionsId !== chat.id &&
                                    openChatActionsId !== chat.id
                                      ? 28
                                      : 0,
                                }}
                                transition={
                                  reducedMotion
                                    ? { duration: 0 }
                                    : CHAT_ACTION_SPRING
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleSetChatFavorite({
                                    chatId: chat.id,
                                    appId: chat.appId,
                                    title: chat.title || t("newChat"),
                                    isFavorite: !chat.isFavorite,
                                    restoreFocus: event.detail === 0,
                                  });
                                }}
                                aria-disabled={pendingFavoriteChatIds.has(
                                  chat.id,
                                )}
                                aria-label={t(
                                  chat.isFavorite
                                    ? "removeChatFromFavorites"
                                    : "addChatToFavorites",
                                  { title: chat.title || t("newChat") },
                                )}
                                aria-pressed={chat.isFavorite}
                                title={t(
                                  chat.isFavorite
                                    ? "removeFromFavorites"
                                    : "addToFavorites",
                                )}
                                data-testid={`chat-favorite-button-${chat.id}`}
                              >
                                <motion.span
                                  className="flex"
                                  initial={false}
                                  animate={
                                    confirmedFavoriteChatIds.has(chat.id) &&
                                    !reducedMotion
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
                                  setIsDropdownOpen(open);
                                  setOpenChatActionsId((current) =>
                                    open
                                      ? chat.id
                                      : current === chat.id
                                        ? null
                                        : current,
                                  );
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
                                  aria-label={t("chatActions", {
                                    title: chat.title || t("newChat"),
                                  })}
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  className="space-y-1 p-2"
                                >
                                  <DropdownMenuItem
                                    onClick={(event) =>
                                      void handleSetChatFavorite({
                                        chatId: chat.id,
                                        appId: chat.appId,
                                        title: chat.title || t("newChat"),
                                        isFavorite: !chat.isFavorite,
                                        restoreFocus: event.detail === 0,
                                      })
                                    }
                                    disabled={pendingFavoriteChatIds.has(
                                      chat.id,
                                    )}
                                    className="px-3 py-2"
                                  >
                                    <Star
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        chat.isFavorite && "fill-current",
                                      )}
                                    />
                                    <span>
                                      {t(
                                        chat.isFavorite
                                          ? "removeFromFavorites"
                                          : "addToFavorites",
                                      )}
                                    </span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleRenameChat(
                                        chat.id,
                                        chat.title || "",
                                      )
                                    }
                                    className="px-3 py-2"
                                  >
                                    <Edit3 className="mr-2 h-4 w-4" />
                                    <span>{t("renameChat")}</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleDeleteChatClick(
                                        chat.id,
                                        chat.title || t("newChat"),
                                      )
                                    }
                                    className="px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 focus:bg-red-50 dark:focus:bg-red-950/50"
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    <span>{t("deleteChat")}</span>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
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
