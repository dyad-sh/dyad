import { useAtom, useAtomValue } from "jotai";
import { previewModeAtom, selectedAppIdAtom } from "../../atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";

import {
  Eye,
  Code,
  MoreVertical,
  Cog,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useRef, useState, useCallback } from "react";

import { useRunApp } from "@/hooks/useRunApp";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { showError, showSuccess } from "@/lib/toast";
import { useMutation } from "@tanstack/react-query";
import { useCheckProblems } from "@/hooks/useCheckProblems";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";

export type PreviewMode = "preview" | "code" | "problems";

// Preview Header component with preview mode toggle
export const PreviewHeader = () => {
  const [previewMode, setPreviewMode] = useAtom(previewModeAtom);
  const [isPreviewOpen, setIsPreviewOpen] = useAtom(isPreviewOpenAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const previewRef = useRef<HTMLButtonElement>(null);
  const codeRef = useRef<HTMLButtonElement>(null);
  const problemsRef = useRef<HTMLButtonElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
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
        const ipcClient = IpcClient.getInstance();
        return ipcClient.clearSessionData();
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

  // Update indicator position when mode changes
  useEffect(() => {
    const updateIndicator = () => {
      let targetRef: React.RefObject<HTMLButtonElement | null>;

      switch (previewMode) {
        case "preview":
          targetRef = previewRef;
          break;
        case "code":
          targetRef = codeRef;
          break;
        case "problems":
          targetRef = problemsRef;
          break;
        default:
          return;
      }

      if (targetRef.current) {
        const button = targetRef.current;
        const container = button.parentElement;
        if (container) {
          const containerRect = container.getBoundingClientRect();
          const buttonRect = button.getBoundingClientRect();
          const left = buttonRect.left - containerRect.left;
          const width = buttonRect.width;

          setIndicatorStyle({ left, width });
          if (!isPreviewOpen) {
            setIndicatorStyle({ left: left, width: 0 });
          }
        }
      }
    };

    // Small delay to ensure DOM is updated
    const timeoutId = setTimeout(updateIndicator, 10);
    return () => clearTimeout(timeoutId);
  }, [previewMode, displayCount, isPreviewOpen]);

  return (
    <div className="flex items-center justify-between px-4 py-2 mt-1 border-b border-border">
      <div className="relative flex rounded-md p-0.5 gap-2">
        <motion.div
          className="absolute top-0.5 bottom-0.5 bg-[var(--background-lightest)] shadow rounded-md"
          animate={{
            left: indicatorStyle.left,
            width: indicatorStyle.width,
          }}
          transition={{
            type: "spring",
            stiffness: 600,
            damping: 35,
            mass: 0.6,
          }}
        />
        <button
          data-testid="preview-mode-button"
          ref={previewRef}
          className="cursor-pointer relative flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium z-10"
          onClick={() => selectPanel("preview")}
        >
          <Eye size={14} />
          <span>Preview</span>
        </button>
        <button
          data-testid="problems-mode-button"
          ref={problemsRef}
          className="cursor-pointer relative flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium z-10"
          onClick={() => selectPanel("problems")}
        >
          <AlertTriangle size={14} />
          <span>Problems</span>
          {displayCount && (
            <span className="ml-0.5 px-1 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full min-w-[16px] text-center">
              {displayCount}
            </span>
          )}
        </button>
        <button
          data-testid="code-mode-button"
          ref={codeRef}
          className="cursor-pointer relative flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium z-10"
          onClick={() => selectPanel("code")}
        >
          <Code size={14} />
          <span>Code</span>
        </button>
      </div>
      <div className="flex items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              data-testid="preview-more-options-button"
              className="flex items-center justify-center p-1.5 rounded-md text-sm hover:bg-[var(--background-darkest)] transition-colors"
              title="More options"
            >
              <MoreVertical size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onClick={onCleanRestart}>
              <Cog size={16} />
              <div className="flex flex-col">
                <span>Rebuild</span>
                <span className="text-xs text-muted-foreground">
                  Re-installs node_modules and restarts
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onClearSessionData}>
              <Trash2 size={16} />
              <div className="flex flex-col">
                <span>Clear Cache</span>
                <span className="text-xs text-muted-foreground">
                  Clears cookies and local storage and other app cache
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
