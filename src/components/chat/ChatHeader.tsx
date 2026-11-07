import {
  PanelRightOpen,
  History,
  PlusCircle,
  GitBranch,
  Info,
  SquareTerminal,
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
import { showError } from "@/lib/toast";
import { useEffect } from "react";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useCurrentBranch } from "@/hooks/useCurrentBranch";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { describeLinkedRemote } from "@/shared/linked_remote";
import { useVersionPreview } from "@/hooks/useVersionPreview";
import { isMutatingState } from "@/version_preview/state";
import { LoadingBar } from "../ui/LoadingBar";
import { UncommittedFilesBanner } from "./UncommittedFilesBanner";
import { terminalOpenByChatIdAtom } from "@/atoms/terminalAtoms";
import { cn } from "@/lib/utils";

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
  const [terminalOpenByChatId, setTerminalOpenByChatId] = useAtom(
    terminalOpenByChatIdAtom,
  );
  const { invalidateChats } = useChats(appId);
  const { selectChat } = useSelectChat();
  const { isStreaming } = useStreamChat();
  const {
    branchInfo,
    isLoading: branchInfoLoading,
    refetchBranchInfo,
  } = useCurrentBranch(appId);

  const {
    state: versionPreviewState,
    projection: versionPreviewProjection,
    send: sendVersionPreviewEvent,
  } = useVersionPreview(appId);
  const isCheckingOutVersion = isMutatingState(versionPreviewState);

  useEffect(() => {
    if (appId) {
      refetchBranchInfo();
    }
  }, [appId, selectedChatId, isStreaming, refetchBranchInfo]);

  const isDetachedHead = branchInfo?.branch === "<no-branch>";
  const { app } = useLoadApp(appId);
  const { data: localBranches } = useQuery({
    queryKey: queryKeys.branches.local({ appId }),
    queryFn: async () =>
      appId === null
        ? []
        : (await ipc.github.listLocalBranches({ appId })).branches,
    enabled: appId !== null && isDetachedHead,
  });
  // Only offers a branch that exists locally. Prevents the case where a
  // failed checkout leaves a Neon app on its development database.
  const switchTarget = [describeLinkedRemote(app)?.branch, "main"].find(
    (branch): branch is string => !!branch && !!localBranches?.includes(branch),
  );

  const handleSwitchToBranch = async () => {
    if (!appId || !switchTarget) return;
    sendVersionPreviewEvent({
      type: "SWITCH_BRANCH",
      appId,
      branch: switchTarget,
    });
  };

  const handleNewChat = async () => {
    if (appId) {
      try {
        const chatId = await ipc.chat.createChat({ appId });
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

  const isTerminalOpen = selectedChatId
    ? (terminalOpenByChatId.get(selectedChatId) ?? false)
    : false;
  const isTerminalDisabled = !appId || !selectedChatId;

  const handleToggleTerminal = () => {
    if (!appId || !selectedChatId) return;

    const nextOpen = !isTerminalOpen;
    setTerminalOpenByChatId((prev) => {
      const next = new Map(prev);
      next.set(selectedChatId, nextOpen);
      return next;
    });
  };

  return (
    <div className="flex flex-col w-full @container">
      <LoadingBar isVisible={isCheckingOutVersion} />
      {/* The version pane checks out detached versions on purpose, so the banner waits until it closes. */}
      {isDetachedHead && !isVersionPaneOpen && (
        <div
          data-testid="detached-head-banner"
          className="flex flex-col @sm:flex-row items-center justify-between px-4 py-2 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200"
        >
          <div className="flex items-center gap-2 text-sm">
            <GitBranch size={16} />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <span className="flex items-center gap-1">
                    {isCheckingOutVersion ? (
                      <span>{t("header.switchingToLatest")}</span>
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
                    {isCheckingOutVersion
                      ? t("header.checkoutInProgress")
                      : t("header.checkoutBranch")}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {switchTarget && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSwitchToBranch}
              disabled={
                !versionPreviewProjection.capabilities.canSwitchBranch ||
                branchInfoLoading
              }
            >
              {isCheckingOutVersion
                ? t("header.checkingOut")
                : t("header.switchToBranch", { branch: switchTarget })}
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

        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    data-testid="toggle-terminal-button"
                    onClick={handleToggleTerminal}
                    disabled={isTerminalDisabled}
                    aria-label={t("terminal.toggleAriaLabel")}
                    aria-pressed={isTerminalOpen}
                    className={cn(
                      "cursor-pointer rounded-md p-2 hover:bg-(--background-lightest) disabled:cursor-not-allowed disabled:opacity-50",
                      isTerminalOpen && "bg-primary/10 text-primary",
                    )}
                  />
                }
              >
                <SquareTerminal size={20} />
              </TooltipTrigger>
              <TooltipContent>
                {isTerminalDisabled
                  ? t("terminal.toggleDisabledTooltip")
                  : t("terminal.toggleTooltip")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
    </div>
  );
}
