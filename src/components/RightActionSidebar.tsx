import { useAtom, useAtomValue } from "jotai";
import { previewModeAtom, selectedAppIdAtom } from "../atoms/appAtoms";
import {
  Eye,
  Code,
  AlertTriangle,
  Wrench,
  Globe,
  Shield,
  Terminal,
} from "lucide-react";
import { motion } from "framer-motion";
import { useCheckProblems } from "@/hooks/useCheckProblems";
import { isPreviewOpenAtom, isTerminalOpenAtom } from "@/atoms/viewAtoms";
import { useTranslation } from "react-i18next";
import type { PreviewMode } from "./preview_panel/ActionHeader";

// Right Action Sidebar component - mirrors the left sidebar when collapsed
export const RightActionSidebar = () => {
  const { t } = useTranslation("home");
  const [previewMode, setPreviewMode] = useAtom(previewModeAtom);
  const [isPreviewOpen, setIsPreviewOpen] = useAtom(isPreviewOpenAtom);
  const [isTerminalOpen, setIsTerminalOpen] = useAtom(isTerminalOpenAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { problemReport } = useCheckProblems(selectedAppId);

  const selectPanel = (panel: PreviewMode) => {
    if (previewMode === panel) {
      setIsPreviewOpen(!isPreviewOpen);
    } else {
      setPreviewMode(panel);
      setIsPreviewOpen(true);
    }
  };

  // Get the problem count for the selected app
  const problemCount = problemReport ? problemReport.problems.length : 0;

  // Format the problem count for display
  const formatProblemCount = (count: number): string => {
    if (count === 0) return "";
    if (count > 100) return "100+";
    return count.toString();
  };

  const displayCount = formatProblemCount(problemCount);

  const iconSize = 18;

  const renderButton = (
    mode: PreviewMode,
    icon: React.ReactNode,
    text: string,
    testId: string,
    badge?: React.ReactNode,
  ) => {
    const isActive = previewMode === mode && isPreviewOpen;
    return (
      <button
        data-testid={testId}
        className={`no-app-region-drag cursor-pointer relative flex flex-col items-center justify-center w-12 h-12 rounded-lg font-medium transition-colors duration-150 active:scale-90 ${
          isActive
            ? "text-sidebar-accent-foreground"
            : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        }`}
        onClick={() => selectPanel(mode)}
      >
        {isActive && (
          <motion.div
            layoutId="active-sidebar-indicator"
            className="absolute inset-0 rounded-lg bg-sidebar-accent"
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
          />
        )}
        <div className="relative z-10">
          {icon}
          {badge}
        </div>
        <span className="relative z-10 text-[10px] leading-tight mt-0.5 truncate max-w-full">
          {text}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col h-full w-16 pl-1 -mr-1.5 bg-sidebar border-l border-sidebar-border">
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
      {/* Terminal toggle button at bottom */}
      <div className="flex flex-col items-center gap-1 pb-2 border-t border-sidebar-border pt-2">
        <button
          data-testid="terminal-toggle-button"
          className={`no-app-region-drag cursor-pointer relative flex flex-col items-center justify-center w-12 h-12 rounded-lg font-medium transition-colors duration-150 active:scale-90 ${
            isTerminalOpen
              ? "text-sidebar-accent-foreground"
              : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          }`}
          onClick={() => setIsTerminalOpen(!isTerminalOpen)}
          title={isTerminalOpen ? "Close terminal" : "Open terminal"}
        >
          {isTerminalOpen && (
            <motion.div
              layoutId="terminal-indicator"
              className="absolute inset-0 rounded-lg bg-sidebar-accent"
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
          )}
          <div className="relative z-10">
            <Terminal size={iconSize} />
          </div>
          <span className="relative z-10 text-[10px] leading-tight mt-0.5 truncate max-w-full">
            Terminal
          </span>
        </button>
      </div>
    </div>
  );
};
