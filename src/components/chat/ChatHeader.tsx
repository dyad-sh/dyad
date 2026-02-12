import {
  PanelRightOpen,
  History,
  PlusCircle,
  GitBranch,
  Info,
} from "lucide-react";
import { PanelRightClose } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { ipc } from "@/ipc/types";
import { useRouter } from "@tanstack/react-router";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useSelectChat } from "@/hooks/useSelectChat";
import { useChats } from "@/hooks/useChats";
import { showError, showSuccess } from "@/lib/toast";
import { useEffect } from "react";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useCurrentBranch } from "@/hooks/useCurrentBranch";
import { useCheckoutVersion } from "@/hooks/useCheckoutVersion";
import { useRenameBranch } from "@/hooks/useRenameBranch";
import { isAnyCheckoutVersionInProgressAtom } from "@/store/appAtoms";
import { LoadingBar } from "../ui/LoadingBar";
import { UncommittedFilesBanner } from "./UncommittedFilesBanner";

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
  const { t } = useTranslation("chat");
  const appId = useAtomValue(selectedAppIdAtom);
  const { versions, loading: versionsLoading } = useVersions(appId);
  const { navigate } = useRouter();
  const [selectedChatId] = useAtom(selectedChatIdAtom);
  const { invalidateChats } = useChats(appId);
  const { selectChat } = useSelectChat();
  const { isStreaming } = useStreamChat();
  const isAnyCheckoutVersionInProgress = useAtomValue(
    isAnyCheckoutVersionInProgressAtom,
  );

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

    showSuccess(t("header.masterRenamed"));
  };

  const handleNewChat = async () => {
    if (appId) {
      try {
        const chatId = await ipc.chat.createChat(appId);
        await invalidateChats();
        selectChat({ chatId, appId });
      } catch (error) {
        showError(t("failedCreateChat", { error: (error as any).toString() }));
      }
    } else {
      navigate({ to: "/" });
    }
  };

  // REMINDER: KEEP UP TO DATE WITH app_handlers.ts
  const versionPostfix = versions.length === 100_000 ? `+` : "";

  const isNotMainBranch = branchInfo && branchInfo.branch !== "main";

  const currentBranchName = branchInfo?.branch;

  return (
    <div className="flex flex-col w-full @container">
      <LoadingBar isVisible={isAnyCheckoutVersionInProgress} />
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
                      <TooltipTrigger>
                        <span className="flex items-center  gap-1">
                          {isAnyCheckoutVersionInProgress ? (
                            <>
                              <span>{t("header.switchingToLatest")}</span>
                            </>
                          ) : (
                            <>
                              <strong>
                                {t("header.warningNotOnBranch").split(":")[0]}:
                              </strong>
                              <span>{t("header.notOnBranch")}</span>
                              <Info size={14} />
                            </>
                          )}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          {isAnyCheckoutVersionInProgress
                            ? t("header.checkoutInProgress")
                            : t("header.checkoutMainBranch")}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              )}
              {currentBranchName && currentBranchName !== "<no-branch>" && (
                <span>{t("header.onBranch", { name: currentBranchName })}</span>
              )}
              {branchInfoLoading && <span>{t("header.checkingBranch")}</span>}
            </span>
          </div>
          {currentBranchName === "master" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRenameMasterToMain}
              disabled={isRenamingBranch || branchInfoLoading}
            >
              {isRenamingBranch
                ? t("header.renaming")
                : t("header.renameMasterToMain")}
            </Button>
          ) : isAnyCheckoutVersionInProgress && !isCheckingOutVersion ? null : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheckoutMainBranch}
              disabled={isCheckingOutVersion || branchInfoLoading}
            >
              {isCheckingOutVersion
                ? t("header.checkingOut")
                : t("header.switchToMainBranch")}
            </Button>
          )}
        </div>
      )}

      {/* Show uncommitted files banner when on a branch and there are uncommitted changes */}
      {/* Hide while streaming to avoid distracting the user */}
      {!isVersionPaneOpen && branchInfo?.branch && !isStreaming && (
        <UncommittedFilesBanner appId={appId} />
      )}

      {/* Why is this pt-0.5? Because the loading bar is h-1 (it always takes space) and we want the vertical spacing to be consistent.*/}
      <div className="@container flex items-center justify-between pb-1.5 pt-0.5">
        <div className="flex items-center space-x-2">
          <Button
            onClick={handleNewChat}
            variant="ghost"
            className="hidden @2xs:flex items-center justify-start gap-2 mx-2 py-3"
            data-testid="new-chat-button"
          >
            <PlusCircle size={16} />
            <span>{t("newChat")}</span>
          </Button>
          <Button
            onClick={onVersionClick}
            variant="ghost"
            className="hidden @6xs:flex cursor-pointer items-center gap-1 text-sm px-2 py-1 rounded-md"
          >
            <History size={16} />
            {versionsLoading
              ? "..."
              : `${t("header.versionCount", { count: versions.length })}${versionPostfix}`}
          </Button>
        </div>

        <button
          data-testid="toggle-preview-panel-button"
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
