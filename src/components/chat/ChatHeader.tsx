import {
  PanelRightOpen,
  History,
  PlusCircle,
  GitBranch,
  Info,
} from "lucide-react";
import { PanelRightClose } from "lucide-react";
import { useAtom, useAtomValue } from "jotai";
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
import { showError, showSuccess } from "@/lib/toast";
import { useEffect } from "react";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useCurrentBranch } from "@/hooks/useCurrentBranch";
import { useCheckoutVersion } from "@/hooks/useCheckoutVersion";
import { useRenameBranch } from "@/hooks/useRenameBranch";

interface ChatHeaderProps {
  isVersionPaneOpen: boolean;
  isPreviewOpen: boolean;
  onTogglePreview: () => void;
  onVersionClick: () => void;
}

export function ChatHeader({
  isVersionPaneOpen,
  isPreviewOpen,
  onTogglePreview,
  onVersionClick,
}: ChatHeaderProps) {
  const appId = useAtomValue(selectedAppIdAtom);
  const { versions, loading: versionsLoading } = useVersions(appId);
  const { navigate } = useRouter();
  const [selectedChatId, setSelectedChatId] = useAtom(selectedChatIdAtom);
  const { refreshChats } = useChats(appId);
  const { isStreaming } = useStreamChat();

  const {
    branchInfo,
    isLoading: branchInfoLoading,
    refetchBranchInfo,
  } = useCurrentBranch(appId);

  const { checkoutVersion, isCheckingOutVersion } = useCheckoutVersion();
  const { renameBranch, isRenamingBranch } = useRenameBranch();

  useEffect(() => {
    if (appId) {
      refetchBranchInfo();
    }
  }, [appId, selectedChatId, isStreaming, refetchBranchInfo]);

  const handleCheckoutMainBranch = async () => {
    if (!appId) return;
    await checkoutVersion({ appId, versionId: "main" });
  };

  const handleRenameMasterToMain = async () => {
    if (!appId) return;
    // If this throws, it will automatically show an error toast
    await renameBranch({ oldBranchName: "master", newBranchName: "main" });

    showSuccess("Master branch renamed to main");
  };

  const handleNewChat = async () => {
    if (appId) {
      try {
        const chatId = await IpcClient.getInstance().createChat(appId);
        setSelectedChatId(chatId);
        navigate({
          to: "/chat",
          search: { id: chatId },
        });
        await refreshChats();
      } catch (error) {
        showError(`Failed to create new chat: ${(error as any).toString()}`);
      }
    } else {
      navigate({ to: "/" });
    }
  };

  // REMINDER: KEEP UP TO DATE WITH app_handlers.ts
  const versionPostfix = versions.length === 10_000 ? `+` : "";

  const isNotMainBranch = branchInfo && branchInfo.branch !== "main";

  const currentBranchName = branchInfo?.branch;

  return (
    <div className="flex flex-col w-full @container">
      {/* If the version pane is open, it's expected to not always be on the main branch. */}
      {isNotMainBranch && !isVersionPaneOpen && (
        <div className="flex flex-col @sm:flex-row items-center justify-between px-4 py-2 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200">
          <div className="flex items-center gap-2 text-sm">
            <GitBranch size={16} />
            <span>
              {currentBranchName === "<no-branch>" && (
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
              {currentBranchName && currentBranchName !== "<no-branch>" && (
                <span>
                  You are on branch: <strong>{currentBranchName}</strong>.
                </span>
              )}
              {branchInfoLoading && <span>Checking branch...</span>}
            </span>
          </div>
          {currentBranchName === "master" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRenameMasterToMain}
              disabled={isRenamingBranch || branchInfoLoading}
            >
              {isRenamingBranch ? "Renaming..." : "Rename master to main"}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheckoutMainBranch}
              disabled={isCheckingOutVersion || branchInfoLoading}
            >
              {isCheckingOutVersion
                ? "Checking out..."
                : "Switch to main branch"}
            </Button>
          )}
        </div>
      )}

      <div className="@container flex items-center justify-between py-1">
        <div className="flex items-center space-x-2">
          <Button
            onClick={handleNewChat}
            variant="ghost"
            className="flex items-center justify-start gap-1.5 mx-1.5 sm:mx-2 py-2.5"
          >
            <PlusCircle size={16} />
            <span>New Chat</span>
          </Button>
          <Button
            onClick={onVersionClick}
            variant="ghost"
            className="flex cursor-pointer items-center gap-1 text-xs sm:text-sm px-1.5 sm:px-2 py-1 rounded-md"
          >
            <History size={16} />
            {versionsLoading
              ? "..."
              : `Version ${versions.length}${versionPostfix}`}
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
