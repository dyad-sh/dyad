import { PanelRightOpen, History, PlusCircle } from "lucide-react";
import { PanelRightClose } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useVersions } from "@/hooks/useVersions";
import { Button } from "../ui/button";
import { IpcClient } from "@/ipc/ipc_client";
import { useRouter } from "@tanstack/react-router";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useChats } from "@/hooks/useChats";
import { showError } from "@/lib/toast";

interface ChatHeaderProps {
  isPreviewOpen: boolean;
  onTogglePreview: () => void;
  onVersionClick: () => void;
}

export function ChatHeader({
  isPreviewOpen,
  onTogglePreview,
  onVersionClick,
}: ChatHeaderProps) {
  const appId = useAtomValue(selectedAppIdAtom);
  const { versions, loading } = useVersions(appId);
  const { navigate } = useRouter();
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const { refreshChats } = useChats(appId);

  const handleNewChat = async () => {
    // Only create a new chat if an app is selected
    if (appId) {
      try {
        // Create a new chat with an empty title for now
        const chatId = await IpcClient.getInstance().createChat(appId);

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
  // TODO: KEEP UP TO DATE WITH app_handlers.ts
  const versionPostfix = versions.length === 10_000 ? `+` : "";
  return (
    <div className="@container flex items-center justify-between py-1.5">
      <div className="flex items-center space-x-2">
        <Button
          onClick={handleNewChat}
          variant="ghost"
          className="hidden @2xs:flex items-center justify-start gap-2 mx-2 py-3"
        >
          <PlusCircle size={16} />
          <span>New Chat</span>
        </Button>
        <Button
          onClick={onVersionClick}
          variant="ghost"
          className="hidden @6xs:flex cursor-pointer items-center gap-1 text-sm px-2 py-1 rounded-md"
        >
          <History size={16} />
          {loading ? "..." : `Version ${versions.length}${versionPostfix}`}
        </Button>
      </div>

      <button
        onClick={onTogglePreview}
        className="cursor-pointer p-2 hover:bg-(--background-lightest) rounded-md"
      >
        {isPreviewOpen ? (
          <PanelRightClose size={20} />
        ) : (
          <PanelRightOpen size={20} />
        )}
      </button>
    </div>
  );
}
