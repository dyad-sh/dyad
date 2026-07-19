import { useState, useEffect, useCallback } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ipc } from "@/ipc/types";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Network,
  GitBranch,
  Plus,
  Trash2,
  RefreshCw,
  GitMerge,
  Edit2,
  MoreHorizontal,
  AlertCircle,
  GitPullRequestArrow,
  EllipsisVertical,
} from "lucide-react";
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
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { Label } from "@/components/ui/label";
import { showSuccess, showError, showInfo } from "@/lib/toast";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useResolveMergeConflictsWithAI } from "@/hooks/useResolveMergeConflictsWithAI";
import { useTranslation } from "react-i18next";

interface BranchManagerProps {
  appId: number;
  onBranchChange?: () => void;
}

export function GithubBranchManager({
  appId,
  onBranchChange,
}: BranchManagerProps) {
  const { t } = useTranslation(["home", "common"]);
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [branchToDelete, setBranchToDelete] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);

  // New state for features
  const [sourceBranch, setSourceBranch] = useState<string>("");
  const [branchToRename, setBranchToRename] = useState<string | null>(null);
  const [renameBranchName, setRenameBranchName] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [branchToMerge, setBranchToMerge] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  // State for abort confirmation dialog
  const [abortConfirmation, setAbortConfirmation] = useState<{
    show: boolean;
    targetBranch: string;
    operationType: "merge" | "rebase";
    hasConflicts: boolean;
  } | null>(null);
  const [isCancellingSync, setIsCancellingSync] = useState(false);

  const { resolveWithAI, isResolving } = useResolveMergeConflictsWithAI({
    appId,
    conflicts,
    onStartResolving: () => {
      // Clear conflicts state when starting AI resolution
      setConflicts([]);
    },
  });

  const handleCancelSync = async () => {
    setIsCancellingSync(true);
    try {
      const state = await ipc.github.getGitState({ appId });
      let aborted = false;
      if (state.rebaseInProgress) {
        await ipc.github.rebaseAbort({ appId });
        aborted = true;
      } else if (state.mergeInProgress) {
        await ipc.github.mergeAbort({ appId });
        aborted = true;
      }
      setConflicts([]);
      if (aborted) {
        showSuccess(t("integrations.github.syncCancelled"));
        await loadBranches();
      }
    } catch (error: any) {
      showError(error?.message || t("integrations.github.failedCancelSync"));
    } finally {
      setIsCancellingSync(false);
    }
  };

  const loadBranches = useCallback(async () => {
    setIsLoading(true);
    try {
      const [localResult, remoteBranches] = await Promise.all([
        ipc.github.listLocalBranches({ appId }),
        ipc.github.listRemoteBranches({ appId }).catch(() => []),
      ]);

      // Merge local and remote branches, removing duplicates
      const allBranches = new Set([...localResult.branches, ...remoteBranches]);

      setBranches(Array.from(allBranches).sort());
      setCurrentBranch(localResult.current || null);
    } catch (error: any) {
      showError(
        error.message || t("integrations.githubBranch.failedLoadBranches"),
      );
    } finally {
      setIsLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    setIsCreating(true);
    const branchName = newBranchName.trim();
    try {
      await ipc.github.createBranch({
        appId,
        branch: branchName,
        from: sourceBranch || undefined,
      });
      showSuccess(
        t("integrations.githubBranch.branchCreated", { name: branchName }),
      );
      setNewBranchName("");
      setSourceBranch(""); // Reset source branch selection
      setShowCreateDialog(false);
      await loadBranches();
      // Automatically switch to the newly created branch
      await handleSwitchBranch(branchName);
    } catch (error: any) {
      showError(
        error.message || t("integrations.githubBranch.failedCreateBranch"),
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleSwitchBranch = async (branch: string) => {
    if (branch === currentBranch) return;

    setIsSwitching(true);
    try {
      const switchBranch = async () =>
        await ipc.github.switchBranch({ appId, branch });

      try {
        await switchBranch();
        showSuccess(
          t("integrations.githubBranch.switchedToBranch", { name: branch }),
        );
        setCurrentBranch(branch);
        onBranchChange?.();
        return;
      } catch (initialError: any) {
        // Check for structured error codes instead of string matching
        const errorCode = initialError?.code;

        // Fallback: query backend git state if code is missing
        let inferredCode:
          | "REBASE_IN_PROGRESS"
          | "MERGE_IN_PROGRESS"
          | undefined;
        if (!errorCode) {
          try {
            const state = await ipc.github.getGitState({ appId });
            if (state.rebaseInProgress) inferredCode = "REBASE_IN_PROGRESS";
            else if (state.mergeInProgress) inferredCode = "MERGE_IN_PROGRESS";
          } catch {
            // ignore state inference errors
          }
        }
        const effectiveCode = (errorCode || inferredCode) as
          | "REBASE_IN_PROGRESS"
          | "MERGE_IN_PROGRESS"
          | undefined;

        if (effectiveCode === "REBASE_IN_PROGRESS") {
          // Check if there are unresolved conflicts
          let hasConflicts = false;
          try {
            const conflicts = await ipc.github.getConflicts({ appId });
            hasConflicts = conflicts.length > 0;
          } catch {
            // If we can't get conflicts, assume there might be conflicts to be safe
            hasConflicts = true;
          }

          // Show confirmation dialog instead of auto-aborting
          setAbortConfirmation({
            show: true,
            targetBranch: branch,
            operationType: "rebase",
            hasConflicts,
          });
          return;
        }

        if (effectiveCode === "MERGE_IN_PROGRESS") {
          // Check if there are unresolved conflicts
          let hasConflicts = false;
          try {
            const conflicts = await ipc.github.getConflicts({ appId });
            hasConflicts = conflicts.length > 0;
          } catch {
            // If we can't get conflicts, assume there might be conflicts to be safe
            hasConflicts = true;
          }

          // Show confirmation dialog instead of auto-aborting
          setAbortConfirmation({
            show: true,
            targetBranch: branch,
            operationType: "merge",
            hasConflicts,
          });
          return;
        }

        throw initialError;
      }
    } catch (error: any) {
      showError(
        error.message || t("integrations.githubBranch.failedSwitchBranch"),
      );
    } finally {
      setIsSwitching(false);
    }
  };

  const handleConfirmAbortAndSwitch = async () => {
    if (!abortConfirmation) return;

    const { targetBranch, operationType } = abortConfirmation;
    setIsSwitching(true);

    try {
      // Abort the operation - both methods throw on error
      if (operationType === "rebase") {
        await ipc.github.rebaseAbort({ appId });
      } else {
        await ipc.github.mergeAbort({ appId });
      }

      // Now switch to the target branch
      try {
        await ipc.github.switchBranch({ appId, branch: targetBranch });
        showSuccess(
          t("integrations.githubBranch.abortedAndSwitched", {
            type: operationType,
            name: targetBranch,
          }),
        );
        setCurrentBranch(targetBranch);
        onBranchChange?.();
        await loadBranches();
      } catch (switchError: any) {
        showError(
          switchError?.message ||
            t("integrations.githubBranch.failedSwitchAfterAbort", {
              type: operationType,
            }),
        );
      }
    } catch (abortError: any) {
      showError(
        abortError?.message ||
          t("integrations.githubBranch.failedAbortBeforeSwitch", {
            type: operationType,
          }),
      );
    } finally {
      setIsSwitching(false);
      setAbortConfirmation(null);
    }
  };

  const handleConfirmDeleteBranch = async () => {
    if (!branchToDelete) return;

    setIsDeleting(true);
    try {
      await ipc.github.deleteBranch({ appId, branch: branchToDelete });
      showSuccess(
        t("integrations.githubBranch.branchDeleted", { name: branchToDelete }),
      );
      setBranchToDelete(null);
      await loadBranches();
    } catch (error: any) {
      showError(
        error.message || t("integrations.githubBranch.failedDeleteBranch"),
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRenameBranch = async () => {
    if (!branchToRename || !renameBranchName.trim()) return;
    setIsRenaming(true);
    try {
      const trimmedNewName = renameBranchName.trim();
      await ipc.github.renameBranch({
        appId,
        oldBranch: branchToRename,
        newBranch: trimmedNewName,
      });
      showSuccess(
        t("integrations.githubBranch.branchRenamed", {
          oldName: branchToRename,
          newName: trimmedNewName,
        }),
      );
      setBranchToRename(null);
      setRenameBranchName("");
      await loadBranches();
    } catch (error: any) {
      showError(
        error.message || t("integrations.githubBranch.failedRenameBranch"),
      );
    } finally {
      setIsRenaming(false);
    }
  };

  const handleMergeBranch = async () => {
    if (!branchToMerge) return;
    setIsMerging(true);
    setConflicts([]); // Clear conflicts when starting a new merge operation
    try {
      await ipc.github.mergeBranch({ appId, branch: branchToMerge });
      showSuccess(
        t("integrations.githubBranch.branchMerged", {
          source: branchToMerge,
          target: currentBranch,
        }),
      );
      setConflicts([]); // Clear conflicts on successful merge
      setBranchToMerge(null);
      await loadBranches(); // Refresh to see any status changes if we implement them
    } catch (error: any) {
      // Always check for conflicts when merge fails, regardless of error type
      // IPC serialization may not preserve error.name, so we check conflicts directly
      let conflictsDetected: string[] = [];
      try {
        conflictsDetected = await ipc.github.getConflicts({ appId });
      } catch {
        // If conflict check fails, continue with original error handling below
      }

      if (conflictsDetected.length > 0) {
        // Conflicts were detected - show the resolver
        setConflicts(conflictsDetected);
        setBranchToMerge(null);
        showInfo(t("integrations.githubBranch.mergeConflict"));
        return;
      }

      // No conflicts found - show the original error
      // Check if it's a merge conflict error for user messaging
      const errorName = error?.name || "";
      const isConflict =
        errorName === "MergeConflictError" || errorName === "GitConflictError";

      if (isConflict) {
        showError(t("integrations.github.mergeConflictNoFiles"));
      } else {
        showError(
          error.message || t("integrations.githubBranch.failedMergeBranch"),
        );
      }
      // Close the merge modal on any error since user has been notified
      setBranchToMerge(null);
    } finally {
      setIsMerging(false);
    }
  };

  const handleGitPull = async () => {
    setIsPulling(true);
    try {
      await ipc.github.pull({ appId });
      showSuccess(t("integrations.githubBranch.pulledLatest"));
      await loadBranches();
    } catch (error: any) {
      showError(error.message || t("integrations.githubBranch.failedPull"));
    } finally {
      setIsPulling(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Select
          value={currentBranch || ""}
          onValueChange={(v) => v && handleSwitchBranch(v)}
          disabled={
            isSwitching ||
            isDeleting ||
            isRenaming ||
            isMerging ||
            isCreating ||
            isLoading ||
            isPulling
          }
        >
          <SelectTrigger className="w-full" data-testid="branch-select-trigger">
            <SelectValue
              placeholder={t("integrations.githubBranch.selectBranch")}
            />
          </SelectTrigger>
          <SelectContent>
            {branches.map((branch) => (
              <SelectItem key={branch} value={branch} aria-label={branch}>
                <Network className="h-4 w-4 text-gray-500" />
                <span className="font-medium text-sm">
                  {t("integrations.githubBranch.branchLabel")}
                </span>
                <span
                  data-testid="current-branch-display"
                  className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded"
                >
                  {branch}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  className={cn(
                    buttonVariants({ variant: "outline", size: "icon" }),
                  )}
                  aria-label={t("integrations.githubBranch.branchActions")}
                  data-testid="branch-actions-menu-trigger"
                />
              }
            >
              <EllipsisVertical className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>
              {t("integrations.githubBranch.branchActions")}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => setShowCreateDialog(true)}
              data-testid="create-branch-trigger"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("integrations.githubBranch.createNewBranch")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={loadBranches}
              disabled={isLoading}
              data-testid="refresh-branches-button"
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
              />
              {t("integrations.githubBranch.refreshBranches")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleGitPull}
              disabled={isPulling}
              data-testid="git-pull-button"
            >
              <GitPullRequestArrow
                className={`mr-2 h-4 w-4 ${isPulling ? "animate-spin" : ""}`}
              />
              {t("integrations.github.gitPull")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("integrations.githubBranch.createBranchTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("integrations.githubBranch.createBranchDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div>
                <Label htmlFor="branch-name">
                  {t("integrations.githubBranch.branchName")}
                </Label>
                <Input
                  id="branch-name"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="feature/my-new-feature"
                  className="mt-2"
                  data-testid="new-branch-name-input"
                />
              </div>
              <div>
                <Label htmlFor="source-branch">
                  {t("integrations.githubBranch.sourceBranch")}
                </Label>
                <Select
                  value={sourceBranch}
                  onValueChange={(v) => setSourceBranch(v ?? "")}
                >
                  <SelectTrigger
                    className="mt-2"
                    data-testid="source-branch-select-trigger"
                  >
                    <SelectValue
                      placeholder={t(
                        "integrations.githubBranch.sourceBranchPlaceholder",
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HEAD">
                      {t("integrations.github.headCurrent")}
                    </SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
              >
                {t("common:cancel")}
              </Button>
              <Button
                onClick={handleCreateBranch}
                disabled={isCreating || !newBranchName.trim()}
                data-testid="create-branch-submit-button"
              >
                {isCreating
                  ? t("common:creating")
                  : t("integrations.githubBranch.createBranch")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Rename Dialog */}
      <Dialog
        open={!!branchToRename}
        onOpenChange={(open) => !open && setBranchToRename(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("integrations.githubBranch.renameBranch")}
            </DialogTitle>
            <DialogDescription>
              {t("integrations.githubBranch.renameBranchDescription", {
                name: branchToRename,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="rename-branch-name">
              {t("integrations.githubBranch.newName")}
            </Label>
            <Input
              id="rename-branch-name"
              value={renameBranchName}
              onChange={(e) => setRenameBranchName(e.target.value)}
              placeholder={branchToRename || ""}
              className="mt-2"
              data-testid="rename-branch-input"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBranchToRename(null)}>
              {t("common:cancel")}
            </Button>
            <Button
              onClick={handleRenameBranch}
              disabled={isRenaming || !renameBranchName.trim()}
              data-testid="rename-branch-submit-button"
            >
              {isRenaming
                ? t("common:updating")
                : t("integrations.githubBranch.rename")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Dialog */}
      <Dialog
        open={!!branchToMerge}
        onOpenChange={(open) => !open && setBranchToMerge(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("integrations.githubBranch.mergeBranch")}
            </DialogTitle>
            <DialogDescription>
              {t("integrations.githubBranch.mergeBranchConfirmation", {
                source: branchToMerge,
                target: currentBranch,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBranchToMerge(null)}>
              {t("common:cancel")}
            </Button>
            <Button
              onClick={handleMergeBranch}
              disabled={isMerging}
              data-testid="merge-branch-submit-button"
            >
              {isMerging
                ? t("integrations.githubBranch.merging")
                : t("integrations.githubBranch.merge")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!branchToDelete}
        onOpenChange={(open) => !open && setBranchToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("integrations.githubBranch.deleteBranch")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("integrations.githubBranch.deleteBranchConfirmation", {
                name: branchToDelete,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("common:cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeleteBranch}
              disabled={isDeleting}
            >
              {isDeleting
                ? t("common:deleting")
                : t("integrations.githubBranch.deleteBranch")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Abort Merge/Rebase Confirmation Dialog */}
      <AlertDialog
        open={!!abortConfirmation?.show}
        onOpenChange={(open) => {
          if (!open) setAbortConfirmation(null);
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30">
                <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              </span>

              <div className="flex flex-col">
                <span className="text-base font-semibold">
                  {abortConfirmation?.operationType === "merge"
                    ? t("integrations.githubBranch.mergeInProgress")
                    : t("integrations.githubBranch.rebaseInProgress")}
                </span>
                <span className="text-sm text-muted-foreground font-normal">
                  {t("integrations.githubBranch.abortAction")}
                </span>
              </div>
            </AlertDialogTitle>

            <AlertDialogDescription className="mt-4 space-y-4 text-sm">
              <p className="text-foreground">
                {t("integrations.githubBranch.operationInProgress", {
                  type: abortConfirmation?.operationType,
                  targetBranch: abortConfirmation?.targetBranch,
                })}
              </p>

              {abortConfirmation?.hasConflicts && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
                  <p className="font-medium">
                    {t("integrations.githubBranch.unresolvedConflicts")}
                  </p>
                  <p className="mt-1 text-xs">
                    {t("integrations.githubBranch.abortWarning")}
                  </p>
                </div>
              )}

              <p className="text-muted-foreground">
                {t("integrations.githubBranch.abortConfirmation", {
                  type: abortConfirmation?.operationType,
                })}
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="mt-6 gap-2">
            <AlertDialogCancel
              disabled={isSwitching}
              data-testid="abort-confirmation-cancel"
            >
              {t("integrations.githubBranch.keepWorking")}
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={handleConfirmAbortAndSwitch}
              disabled={isSwitching}
              className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
              data-testid="abort-confirmation-proceed"
            >
              {isSwitching ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  {t("integrations.github.aborting")}
                </span>
              ) : (
                t("integrations.githubBranch.abortAndSwitch", {
                  type: abortConfirmation?.operationType,
                })
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Conflict Resolution Buttons */}
      {conflicts.length > 0 && (
        <div className="mt-3 p-3 rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20">
          <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-3">
            {t(
              conflicts.length === 1
                ? "integrations.github.conflictFile"
                : "integrations.github.conflictFiles",
              { count: conflicts.length },
            )}
            : {conflicts.join(", ")}
          </p>
          <div className="flex gap-2">
            <Button
              onClick={resolveWithAI}
              disabled={isCancellingSync || isResolving}
            >
              {isResolving
                ? t("integrations.github.resolving")
                : t("integrations.github.resolveConflictsWithAi")}
            </Button>
            <Button
              variant="outline"
              onClick={handleCancelSync}
              disabled={isCancellingSync || isResolving}
            >
              {isCancellingSync
                ? t("integrations.github.cancelling")
                : t("integrations.github.cancelSync")}
            </Button>
          </div>
        </div>
      )}

      <Card className="transition-all duration-200">
        <CardHeader
          className="p-2 cursor-pointer"
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GitBranch className="w-5 h-5" />
              <div>
                <CardTitle className="text-sm" data-testid="branches-header">
                  {t("integrations.githubBranch.branches")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("integrations.githubBranch.branchesDescription")}
                </CardDescription>
              </div>
            </div>
            {isExpanded ? (
              <ChevronsDownUp className="w-5 h-5 text-gray-500" />
            ) : (
              <ChevronsUpDown className="w-5 h-5 text-gray-500" />
            )}
          </div>
        </CardHeader>
        <div
          className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${
            isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <CardContent className="space-y-4 pt-0">
            {/* List of other branches with delete option? Or just rely on Select? */}
            {branches.length > 1 && (
              <div className="mt-2">
                <div className="space-y-1 max-h-40 overflow-y-auto border rounded-md p-2">
                  {branches.map((branch) => (
                    <div
                      key={branch}
                      className="flex items-center justify-between text-sm py-1 px-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded"
                      data-testid={`branch-item-${branch}`}
                    >
                      <span
                        className={
                          branch === currentBranch
                            ? "font-bold text-blue-600"
                            : ""
                        }
                      >
                        {branch}
                      </span>
                      {branch !== currentBranch && (
                        <DropdownMenu
                          onOpenChange={(open) => {
                            if (open) setIsExpanded(true);
                          }}
                        >
                          <DropdownMenuTrigger
                            className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-6 w-6"
                            data-testid={`branch-actions-${branch}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => setBranchToMerge(branch)}
                              data-testid="merge-branch-menu-item"
                            >
                              <GitMerge className="mr-2 h-4 w-4" />
                              {t("integrations.githubBranch.mergeInto", {
                                branch: currentBranch,
                              })}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setBranchToRename(branch);
                                setRenameBranchName(branch);
                              }}
                              data-testid="rename-branch-menu-item"
                            >
                              <Edit2 className="mr-2 h-4 w-4" />
                              {t("integrations.githubBranch.rename")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => setBranchToDelete(branch)}
                              data-testid="delete-branch-menu-item"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {t("common:delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </div>
      </Card>
    </div>
  );
}
