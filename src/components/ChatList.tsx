import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { formatDistanceToNow } from "date-fns";
import { PlusCircle, MoreVertical, Trash2, Edit3, Search } from "lucide-react";
import { useAtom } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { dropdownOpenAtom } from "@/atoms/uiAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import { showError, showSuccess } from "@/lib/toast";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
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
  const navigate = useNavigate();
  const [selectedChatId, setSelectedChatId] = useAtom(selectedChatIdAtom);
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const [, setIsDropdownOpen] = useAtom(dropdownOpenAtom);

  const { chats, loading, refreshChats } = useChats(selectedAppId);
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

  // Update selectedChatId when route changes
  useEffect(() => {
    if (isChatRoute) {
      const id = routerState.location.search.id;
      if (id) {
        console.log("Setting selected chat id to", id);
        setSelectedChatId(id);
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
        const chatId = await IpcClient.getInstance().createChat(selectedAppId);

        // Navigate to the new chat
        setSelectedChatId(chatId);
        navigate({
          to: "/chat",
          search: { id: chatId },
        });

        // Refresh the chat list
        await refreshChats();
      } catch (error) {
        // DO A TOAST
        showError(`Failed to create new chat: ${(error as any).toString()}`);
      }
    } else {
      // If no app is selected, navigate to home page
      navigate({ to: "/" });
    }
  };

  const handleDeleteChat = async (chatId: number) => {
    try {
      await IpcClient.getInstance().deleteChat(chatId);
      showSuccess("Chat deleted successfully");

      // If the deleted chat was selected, navigate to home
      if (selectedChatId === chatId) {
        setSelectedChatId(null);
        navigate({ to: "/chat" });
      }

      // Refresh the chat list
      await refreshChats();
    } catch (error) {
      showError(`Failed to delete chat: ${(error as any).toString()}`);
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
        <SidebarGroupLabel className="text-muted-foreground dark:text-white/70 px-4 mb-3">Recent Chats</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex flex-col space-y-2 px-3">
            <div className="flex gap-2 justify-start mb-2">
              <Button
                onClick={handleNewChat}
                variant="ghost"
                size="icon"
                className="h-9 w-9 hover:bg-muted dark:hover:bg-white/10 rounded-lg transition-colors text-foreground dark:text-white/90 hover:text-foreground dark:hover:text-white"
                title="New Chat"
              >
                <PlusCircle className="h-4 w-4" />
              </Button>
              <Button
                onClick={() => setIsSearchDialogOpen(!isSearchDialogOpen)}
                variant="ghost"
                size="icon"
                className="h-9 w-9 hover:bg-muted dark:hover:bg-white/10 rounded-lg transition-colors text-foreground dark:text-white/90 hover:text-foreground dark:hover:text-white"
                data-testid="search-chats-button"
                title="Search chats"
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>

            {loading ? (
              <div className="py-3 px-3 text-sm text-muted-foreground dark:text-white/50">
                Loading chats...
              </div>
            ) : chats.length === 0 ? (
              <div className="py-3 px-3 text-sm text-muted-foreground dark:text-white/50">
                No chats found
              </div>
            ) : (
              <div className="space-y-1">
                {chats.map((chat) => (
                  <div key={chat.id} className="group relative">
                    <div className="flex items-center">
                      <Button
                        variant="ghost"
                        onClick={() =>
                          handleChatClick({
                            chatId: chat.id,
                            appId: chat.appId,
                          })
                        }
                        className={`justify-start flex-1 text-left px-3 py-2 hover:bg-muted dark:hover:bg-white/10 transition-colors rounded-lg ${
                          selectedChatId === chat.id
                            ? "bg-muted dark:bg-white/10 text-foreground dark:text-white border-l-2 border-primary dark:border-white/50"
                            : "text-muted-foreground dark:text-white/80 hover:text-foreground dark:hover:text-white"
                        }`}
                      >
                        <div className="flex flex-col w-full">
                          <span className="truncate text-sm font-medium">
                            {chat.title || "New Chat"}
                          </span>
                          <span className="text-xs text-muted-foreground dark:text-white/50">
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
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="ml-1 h-8 w-8 hover:bg-muted dark:hover:bg-white/10 text-muted-foreground dark:text-white/70 hover:text-foreground dark:hover:text-white"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
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
                              <span>Rename Chat</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                handleDeleteChatClick(
                                  chat.id,
                                  chat.title || "New Chat",
                                )
                              }
                              className="px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 focus:bg-red-50 dark:focus:bg-red-950/50"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              <span>Delete Chat</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
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
          onRename={refreshChats}
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
