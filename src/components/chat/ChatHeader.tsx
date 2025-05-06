import {
  PanelRightOpen,
  History,
  PlusCircle,
  GitBranch,
  AlertCircle,
  Info,
} from "lucide-react";
import { PanelRightClose } from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useVersions } from "@/hooks/useVersions";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { IpcClient } from "@/ipc/ipc_client";
import { useRouter } from "@tanstack/react-router";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useChats } from "@/hooks/useChats";
import { showError } from "@/lib/toast";
import { useEffect, useState } from "react";
import { BranchResult } from "@/ipc/ipc_types";
import { useStreamChat } from "@/hooks/useStreamChat";

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
  const [selectedChatId, setSelectedChatId] = useAtom(selectedChatIdAtom);
  const { refreshChats } = useChats(appId);
  const [branchInfo, setBranchInfo] = useState<BranchResult | null>(null);
  const [checkingOutMain, setCheckingOutMain] = useState(false);
  const { isStreaming } = useStreamChat();

  // Fetch the current branch when appId changes
  useEffect(() => {
    if (!appId) return;

    const fetchBranch = async () => {
      try {
        const result = await IpcClient.getInstance().getCurrentBranch(appId);
        if (result.success) {
          setBranchInfo(result);
        } else {
          showError("Failed to get current branch: " + result.errorMessage);
        }
      } catch (error) {
        showError(`Failed to get current branch: ${error}`);
      }
    };

    fetchBranch();
    // The use of selectedChatId and isStreaming is a hack to ensure that
    // the branch info is relatively up to date.
  }, [appId, selectedChatId, isStreaming]);

  const handleCheckoutMainBranch = async () => {
    if (!appId) return;

    try {
      setCheckingOutMain(true);
      // Find the latest commit on main branch
      // For simplicity, we'll just checkout to "main" directly
      await IpcClient.getInstance().checkoutVersion({
        appId,
        versionId: "main",
      });

      // Refresh branch info
      const result = await IpcClient.getInstance().getCurrentBranch(appId);
      if (result.success) {
        setBranchInfo(result);
      } else {
        showError(result.errorMessage);
      }
    } catch (error) {
      showError(`Failed to checkout main branch: ${error}`);
    } finally {
      setCheckingOutMain(false);
    }
  };

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

  // Check if we're not on the main branch
  const isNotMainBranch =
    branchInfo?.success && branchInfo.data.branch !== "main";

  return (
    <div className="flex flex-col w-full @container">
      {isNotMainBranch && (
        <div className="flex flex-col @sm:flex-row items-center justify-between px-4 py-2 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200">
          <div className="flex items-center gap-2 text-sm">
            <GitBranch size={16} />
            <span>
              {branchInfo?.data.branch === "<no-branch>" && (
                <>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center  gap-1">
                          <strong>Warning:</strong>
                          <span>You are not on a branch</span>
                          <Info size={14} />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          Checkout main branch, otherwise changes will not be
                          saved properly
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              )}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckoutMainBranch}
            disabled={checkingOutMain}
          >
            {checkingOutMain ? "Checking out..." : "Switch to main branch"}
          </Button>
        </div>
      )}

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
    </div>
  );
}
