import { useAtom, useAtomValue } from "jotai";
import {
  previewModeAtom,
  selectedAppIdAtom,
  currentAppAtom,
} from "../../atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";

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
  CloudUpload,
  Loader2,
} from "lucide-react";
import { ChatActivityButton } from "@/components/chat/ChatActivity";
import { motion } from "framer-motion";
import { useEffect, useRef, useState, useCallback } from "react";

import { useRunApp } from "@/hooks/useRunApp";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { showError, showSuccess } from "@/lib/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCheckProblems } from "@/hooks/useCheckProblems";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";

export type PreviewMode =
  | "preview"
  | "code"
  | "problems"
  | "configure"
  | "publish"
  | "security";

// Preview Header component with preview mode toggle
export const ActionHeader = () => {
  const [previewMode, setPreviewMode] = useAtom(previewModeAtom);
  const [isPreviewOpen, setIsPreviewOpen] = useAtom(isPreviewOpenAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const currentApp = useAtomValue(currentAppAtom);
  const queryClient = useQueryClient();
  const [isBackupDialogOpen, setIsBackupDialogOpen] = useState(false);
  const [backupNotes, setBackupNotes] = useState("");
  const previewRef = useRef<HTMLButtonElement>(null);
  const codeRef = useRef<HTMLButtonElement>(null);
  const problemsRef = useRef<HTMLButtonElement>(null);
  const configureRef = useRef<HTMLButtonElement>(null);
  const publishRef = useRef<HTMLButtonElement>(null);
  const securityRef = useRef<HTMLButtonElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const { problemReport } = useCheckProblems(selectedAppId);
  const { restartApp, refreshAppIframe } = useRunApp();

  const isCompact = windowWidth < 888;

  // Track window width
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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

  const backupMutation = useMutation({
    mutationFn: async ({ appId, notes }: { appId: number; notes?: string }) => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke<void>("vault:create-backup", { appId, notes });
    },
    onSuccess: () => {
      showSuccess(`Backup created for "${currentApp?.name || "app"}"`);
      queryClient.invalidateQueries({ queryKey: ["vault-backups"] });
      setIsBackupDialogOpen(false);
      setBackupNotes("");
    },
    onError: (error: Error) => {
      showError(error.message || "Failed to create backup");
    },
  });

  const onBackupToVault = useCallback(() => {
    setIsBackupDialogOpen(true);
  }, []);

  const handleBackupConfirm = useCallback(() => {
    if (selectedAppId) {
      backupMutation.mutate({
        appId: selectedAppId,
        notes: backupNotes || undefined,
      });
    }
  }, [selectedAppId, backupNotes, backupMutation]);

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
        case "configure":
          targetRef = configureRef;
          break;
        case "publish":
          targetRef = publishRef;
          break;
        case "security":
          targetRef = securityRef;
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
  }, [previewMode, displayCount, isPreviewOpen, isCompact]);

  const renderButton = (
    mode: PreviewMode,
    ref: React.RefObject<HTMLButtonElement | null>,
    icon: React.ReactNode,
    text: string,
    testId: string,
    badge?: React.ReactNode,
  ) => {
    const buttonContent = (
      <button
        data-testid={testId}
        ref={ref}
        className="no-app-region-drag cursor-pointer relative flex items-center gap-0.5 px-2 py-0.5 rounded-md text-xs font-medium z-10 hover:bg-[var(--background)] flex-col"
        onClick={() => selectPanel(mode)}
      >
        {icon}
        <span>
          {!isCompact && <span>{text}</span>}
          {badge}
        </span>
      </button>
    );

    if (isCompact) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
          <TooltipContent>
            <p>{text}</p>
          </TooltipContent>
        </Tooltip>
      );
    }

    return buttonContent;
  };
  const iconSize = 15;

  return (
    <TooltipProvider>
      <div className="flex items-center justify-between px-1 py-2 mt-1 border-b border-border">
        <div className="relative flex rounded-md p-0.5 gap-0.5">
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
          {renderButton(
            "preview",
            previewRef,
            <Eye size={iconSize} />,
            "Preview",
            "preview-mode-button",
          )}
          {renderButton(
            "problems",
            problemsRef,
            <AlertTriangle size={iconSize} />,
            "Problems",
            "problems-mode-button",
            displayCount && (
              <span className="ml-0.5 px-1 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full min-w-[16px] text-center">
                {displayCount}
              </span>
            ),
          )}
          {renderButton(
            "code",
            codeRef,
            <Code size={iconSize} />,
            "Code",
            "code-mode-button",
          )}
          {renderButton(
            "configure",
            configureRef,
            <Wrench size={iconSize} />,
            "Configure",
            "configure-mode-button",
          )}
          {renderButton(
            "security",
            securityRef,
            <Shield size={iconSize} />,
            "Security",
            "security-mode-button",
          )}
          {renderButton(
            "publish",
            publishRef,
            <Globe size={iconSize} />,
            "Publish",
            "publish-mode-button",
          )}
        </div>
        {/* Chat activity bell */}
        <div className="flex items-center gap-1">
          <ChatActivityButton />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-testid="preview-more-options-button"
                className="no-app-region-drag flex items-center justify-center p-1.5 rounded-md text-sm hover:bg-[var(--background-darkest)] transition-colors"
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
              <DropdownMenuItem
                onClick={onBackupToVault}
                data-testid="backup-to-vault-menu-item"
              >
                <CloudUpload size={16} />
                <div className="flex flex-col">
                  <span>Backup to Vault</span>
                  <span className="text-xs text-muted-foreground">
                    Create a cloud backup of this app
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Backup to Vault Dialog */}
      <Dialog open={isBackupDialogOpen} onOpenChange={setIsBackupDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Backup to Vault</DialogTitle>
            <DialogDescription>
              Create a cloud backup of "{currentApp?.name || "this app"}" to
              Vault. You can restore this backup later.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="backup-notes">Notes (optional)</Label>
              <Input
                id="backup-notes"
                placeholder="e.g., Before major refactor..."
                value={backupNotes}
                onChange={(e) => setBackupNotes(e.target.value)}
                disabled={backupMutation.isPending}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsBackupDialogOpen(false)}
              disabled={backupMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleBackupConfirm}
              disabled={backupMutation.isPending}
              className="flex items-center gap-2"
            >
              {backupMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Backing up...
                </>
              ) : (
                <>
                  <CloudUpload className="h-4 w-4" />
                  Create Backup
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
};
