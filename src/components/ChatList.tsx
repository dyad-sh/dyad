import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { formatDistanceToNow } from "date-fns";
import { PlusCircle, MoreVertical, Trash2, Edit3, Search } from "lucide-react";
import { useAtom, useSetAtom } from "jotai";
import {
  selectedChatIdAtom,
  removeChatIdFromAllTrackingAtom,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { dropdownOpenAtom } from "@/atoms/uiAtoms";
import { ipc } from "@/ipc/types";
import { showError, showSuccess } from "@/lib/toast";
import { useSettings } from "@/hooks/useSettings";
import { getEffectiveDefaultChatMode } from "@/lib/schemas";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChats } from "@/hooks/useChats";
import { RenameChatDialog } from "@/components/chat/RenameChatDialog";
import { DeleteChatDialog } from "@/components/chat/DeleteChatDialog";

import { ChatSearchDialog } from "./ChatSearchDialog";
import { useSelectChat } from "@/hooks/useSelectChat";

export function ChatList({ show }: { show?: boolean }) {
  const { t } = useTranslation("chat");
  const navigate = useNavigate();
  const [selectedChatId, setSelectedChatId] = useAtom(selectedChatIdAtom);
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const [, setIsDropdownOpen] = useAtom(dropdownOpenAtom);
  const { settings, updateSettings, envVars } = useSettings();
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();

  const { chats, loading, invalidateChats } = useChats(selectedAppId);
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
  const removeChatIdFromAllTracking = useSetAtom(
    removeChatIdFromAllTrackingAtom,
  );

  // Update selectedChatId when route changes
  useEffect(() => {
    if (isChatRoute) {
      const id = routerState.location.search.id;
      const chatId = Number(id);
      if (Number.isFinite(chatId) && chatId > 0) {
        setSelectedChatId(chatId);
      }
    }
  }, [isChatRoute, routerState.location.search, setSelectedChatId]);

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
        const chatId = await ipc.chat.createChat(selectedAppId);

        // Set the default chat mode for the new chat
        // Only consider quota available if it has finished loading and is not exceeded
        if (settings) {
          const freeAgentQuotaAvailable = !isQuotaLoading && !isQuotaExceeded;
          const effectiveDefaultMode = getEffectiveDefaultChatMode(
            settings,
            envVars,
            freeAgentQuotaAvailable,
          );
          updateSettings({ selectedChatMode: effectiveDefaultMode });
        }

        // Navigate to the new chat (use selectChat so it appears at front of tab bar)
        selectChat({ chatId, appId: selectedAppId });

        // Refresh the chat list
        await invalidateChats();
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

      // If the deleted chat was selected, navigate to home
      if (selectedChatId === chatId) {
        setSelectedChatId(null);
        navigate({ to: "/chat" });
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

  return (
    <>
      <SidebarGroup
        className="overflow-y-auto h-[calc(100vh-112px)]"
        data-testid="chat-list-container"
      >
        <SidebarGroupLabel>{t("recentChats")}</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex flex-col space-y-4">
            <Button
              onClick={handleNewChat}
              variant="outline"
              className="flex items-center justify-start gap-2 mx-2 py-3"
              data-testid="new-chat-button"
            >
              <PlusCircle size={16} />
              <span>{t("newChat")}</span>
            </Button>
            <Button
              onClick={() => setIsSearchDialogOpen(!isSearchDialogOpen)}
              variant="outline"
              className="flex items-center justify-start gap-2 mx-2 py-3"
              data-testid="search-chats-button"
            >
              <Search size={16} />
              <span>{t("searchChats")}</span>
            </Button>

            {loading ? (
              <div className="py-3 px-4 text-sm text-gray-500">
                {t("loadingChats")}
              </div>
            ) : chats.length === 0 ? (
              <div className="py-3 px-4 text-sm text-gray-500">
                {t("noChatsFound")}
              </div>
            ) : (
              <SidebarMenu className="space-y-1">
                {chats.map((chat) => (
                  <SidebarMenuItem key={chat.id} className="mb-1">
                    <div className="flex w-[175px] items-center">
                      <Button
                        variant="ghost"
                        onClick={() =>
                          handleChatClick({
                            chatId: chat.id,
                            appId: chat.appId,
                          })
                        }
                        className={`justify-start w-full text-left py-3 pr-1 hover:bg-sidebar-accent/80 ${
                          selectedChatId === chat.id
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : ""
                        }`}
                      >
                        <div className="flex flex-col w-full">
                          <span className="truncate">
                            {chat.title || t("newChat")}
                          </span>
                          <span className="text-xs text-gray-500">
                            {formatDistanceToNow(new Date(chat.createdAt), {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                      </Button>

                      {selectedChatId === chat.id && (
                        <DropdownMenu
                          modal={false}
                          onOpenChange={(open) => setIsDropdownOpen(open)}
                        >
                          <DropdownMenuTrigger
                            className={buttonVariants({
                              variant: "ghost",
                              size: "icon",
                              className: "ml-1",
                            })}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="space-y-1 p-2"
                          >
                            <DropdownMenuItem
                              onClick={() =>
                                handleRenameChat(chat.id, chat.title || "")
                              }
                              className="px-3 py-2"
                            >
                              <Edit3 className="mr-2 h-4 w-4" />
                              <span>{t("renameChat")}</span>
                            </DropdownMenuItem>
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
                      )}
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
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
    </>
  );
}
