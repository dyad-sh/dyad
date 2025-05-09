import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { formatDistanceToNow } from "date-fns";
import { PlusCircle, MoreVertical, Trash2 } from "lucide-react";
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

export function ChatList({ show }: { show?: boolean }) {
  const navigate = useNavigate();
  const [selectedChatId, setSelectedChatId] = useAtom(selectedChatIdAtom);
  const [selectedAppId, setSelectedAppId] = useAtom(selectedAppIdAtom);
  const [, setIsDropdownOpen] = useAtom(dropdownOpenAtom);
  const { chats, loading, refreshChats } = useChats(selectedAppId);
  const routerState = useRouterState();
  const isChatRoute = routerState.location.pathname === "/chat";

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
    setSelectedChatId(chatId);
    setSelectedAppId(appId);
    navigate({
      to: "/chat",
      search: { id: chatId },
    });
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
      const result = await IpcClient.getInstance().deleteChat(chatId);
      if (!result.success) {
        showError("Failed to delete chat");
        return;
      }
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

  return (
    <SidebarGroup className="overflow-y-auto h-[calc(100vh-112px)]">
      <SidebarGroupLabel>Recent Chats</SidebarGroupLabel>
      <SidebarGroupContent>
        <div className="flex flex-col space-y-4">
          <Button
            onClick={handleNewChat}
            variant="outline"
            className="flex items-center justify-start gap-2 mx-2 py-3"
          >
            <PlusCircle size={16} />
            <span>New Chat</span>
          </Button>

          {loading ? (
            <div className="py-3 px-4 text-sm text-gray-500">
              Loading chats...
            </div>
          ) : chats.length === 0 ? (
            <div className="py-3 px-4 text-sm text-gray-500">
              No chats found
            </div>
          ) : (
            <SidebarMenu className="space-y-1">
              {chats.map((chat) => (
                <SidebarMenuItem key={chat.id} className="mb-1">
                  <div className="flex w-[175px] items-center">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        handleChatClick({ chatId: chat.id, appId: chat.appId })
                      }
                      className={`justify-start w-full text-left py-3 pr-1 hover:bg-sidebar-accent/80 ${
                        selectedChatId === chat.id
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : ""
                      }`}
                    >
                      <div className="flex flex-col w-full">
                        <span className="truncate">
                          {chat.title || "New Chat"}
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
                        onOpenChange={(open) => setIsDropdownOpen(open)}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="ml-1 w-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleDeleteChat(chat.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            <span>Delete Chat</span>
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
  );
}
