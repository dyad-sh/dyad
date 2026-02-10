import { useAtom, useAtomValue } from "jotai";
import { previewModeAtom, selectedAppIdAtom } from "../atoms/appAtoms";
import { ipc } from "@/ipc/types";

import {
  Eye,
  Code,
  MoreVertical,
  Cog,
  Trash2,
  AlertTriangle,
  Wrench,
  Globe,
  Shield,
} from "lucide-react";
import { ChatActivityButton } from "@/components/chat/ChatActivity";
import { useCallback } from "react";

import { useRunApp } from "@/hooks/useRunApp";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { showError, showSuccess } from "@/lib/toast";
import { useMutation } from "@tanstack/react-query";
import { useCheckProblems } from "@/hooks/useCheckProblems";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { useTranslation } from "react-i18next";
import type { PreviewMode } from "./preview_panel/ActionHeader";

// Right Action Sidebar component - mirrors the left sidebar when collapsed
export const RightActionSidebar = () => {
  const { t } = useTranslation("home");
  const [previewMode, setPreviewMode] = useAtom(previewModeAtom);
  const [isPreviewOpen, setIsPreviewOpen] = useAtom(isPreviewOpenAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { problemReport } = useCheckProblems(selectedAppId);
  const { restartApp, refreshAppIframe } = useRunApp();

  const selectPanel = (panel: PreviewMode) => {
    if (previewMode === panel) {
      setIsPreviewOpen(!isPreviewOpen);
    } else {
      setPreviewMode(panel);
      setIsPreviewOpen(true);
    }
  };

  const onCleanRestart = useCallback(() => {
    restartApp({ removeNodeModules: true });
  }, [restartApp]);

  const useClearSessionData = () => {
    return useMutation({
      mutationFn: () => {
        return ipc.system.clearSessionData();
      },
      onSuccess: async () => {
        await refreshAppIframe();
        showSuccess("Preview data cleared");
      },
      onError: (error) => {
        showError(`Error clearing preview data: ${error}`);
      },
    });
  };

  const { mutate: clearSessionData } = useClearSessionData();

  const onClearSessionData = useCallback(() => {
    clearSessionData();
  }, [clearSessionData]);

  // Get the problem count for the selected app
  const problemCount = problemReport ? problemReport.problems.length : 0;

  // Format the problem count for display
  const formatProblemCount = (count: number): string => {
    if (count === 0) return "";
    if (count > 100) return "100+";
    return count.toString();
  };

  const displayCount = formatProblemCount(problemCount);

  const iconSize = 20;

  const renderButton = (
    mode: PreviewMode,
    icon: React.ReactNode,
    text: string,
    testId: string,
    badge?: React.ReactNode,
  ) => {
    const isActive = previewMode === mode && isPreviewOpen;
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              data-testid={testId}
              className={`no-app-region-drag cursor-pointer relative flex flex-col items-center gap-1 w-14 h-14 justify-center rounded-2xl text-xs font-medium transition-colors ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
              onClick={() => selectPanel(mode)}
            />
          }
        >
          <div className="relative">
            {icon}
            {badge}
          </div>
          <span className="text-xs">{text}</span>
        </TooltipTrigger>
        <TooltipContent side="left">{text}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delay={0}>
      <div className="flex flex-col h-full w-[4.5rem] bg-sidebar border-l border-sidebar-border">
        {/* Main action buttons */}
        <div className="flex flex-col items-center gap-1 pt-2 flex-1">
          {renderButton(
            "preview",
            <Eye size={iconSize} />,
            t("preview.title"),
            "preview-mode-button",
          )}
          {renderButton(
            "problems",
            <AlertTriangle size={iconSize} />,
            t("preview.problems"),
            "problems-mode-button",
            displayCount && (
              <span className="absolute -top-1 -right-1 px-1 py-0.5 text-[10px] font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full min-w-[16px] text-center">
                {displayCount}
              </span>
            ),
          )}
          {renderButton(
            "code",
            <Code size={iconSize} />,
            t("preview.code"),
            "code-mode-button",
          )}
          {renderButton(
            "configure",
            <Wrench size={iconSize} />,
            t("preview.configure"),
            "configure-mode-button",
          )}
          {renderButton(
            "security",
            <Shield size={iconSize} />,
            t("preview.security"),
            "security-mode-button",
          )}
          {renderButton(
            "publish",
            <Globe size={iconSize} />,
            t("preview.publish"),
            "publish-mode-button",
          )}
        </div>

        {/* Bottom section with chat activity and more options */}
        <div className="flex flex-col items-center gap-2 pb-4">
          <ChatActivityButton />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    data-testid="preview-more-options-button"
                    className="no-app-region-drag flex items-center justify-center w-10 h-10 rounded-md text-sm hover:bg-sidebar-accent transition-colors"
                  />
                }
              >
                <MoreVertical size={20} />
              </TooltipTrigger>
              <TooltipContent side="left">
                {t("preview.moreOptions")}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" side="left" className="w-60">
              <DropdownMenuItem onClick={onCleanRestart}>
                <Cog size={16} />
                <div className="flex flex-col">
                  <span>{t("preview.rebuild")}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("preview.rebuildDescription")}
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onClearSessionData}>
                <Trash2 size={16} />
                <div className="flex flex-col">
                  <span>{t("preview.clearCache")}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("preview.clearCacheDescription")}
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  );
};
