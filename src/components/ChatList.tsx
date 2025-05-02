import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { ChatSummary } from "@/lib/schemas";
import { formatDistanceToNow } from "date-fns";
import { PlusCircle } from "lucide-react";
import { useAtom } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import { showError } from "@/lib/toast";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useChats } from "@/hooks/useChats";

export function ChatList({ show }: { show?: boolean }) {
  const navigate = useNavigate();
  const [selectedChatId, setSelectedChatId] = useAtom(selectedChatIdAtom);
  const [selectedAppId, setSelectedAppId] = useAtom(selectedAppIdAtom);
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
                  <Button
                    variant="ghost"
                    onClick={() =>
                      handleChatClick({ chatId: chat.id, appId: chat.appId })
                    }
                    className={`justify-start w-full text-left py-3 hover:bg-sidebar-accent/80 ${
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
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
