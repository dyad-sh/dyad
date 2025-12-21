import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IpcClient } from "@/ipc/ipc_client";
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
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GithubConflictResolver } from "@/components/GithubConflictResolver";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface BranchManagerProps {
  appId: number;
  onBranchChange?: () => void;
}

export function GithubBranchManager({
  appId,
  onBranchChange,
}: BranchManagerProps) {
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
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);

  const loadBranches = async () => {
    setIsLoading(true);
    try {
      const result =
        await IpcClient.getInstance().listLocalGithubBranches(appId);
      if (result.success && result.branches) {
        setBranches(result.branches);
        setCurrentBranch(result.current || null);
      } else {
        showError(result.error || "Failed to list branches");
      }
    } catch (error: any) {
      showError(error.message || "Failed to load branches");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBranches();
  }, [appId]);

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    setIsCreating(true);
    try {
      const result = await IpcClient.getInstance().createGithubBranch(
        appId,
        newBranchName,
        sourceBranch || undefined,
      );
      if (result.success) {
        showSuccess(`Branch '${newBranchName}' created`);
        setNewBranchName("");
        setShowCreateDialog(false);
        await loadBranches();
        // Optionally switch to new branch automatically?
        // For now, let user switch manually.
      } else {
        showError(result.error || "Failed to create branch");
      }
    } catch (error: any) {
      showError(error.message || "Failed to create branch");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSwitchBranch = async (branch: string) => {
    if (branch === currentBranch) return;
    const isRebaseInProgress = (message?: string) => {
      if (!message) return false;
      const lower = message.toLowerCase();
      return (
        lower.includes("rebase in progress") ||
        lower.includes("rebase-apply") ||
        lower.includes("rebase --continue") ||
        lower.includes("rebase --abort")
      );
    };
    const isMergeInProgress = (message?: string) => {
      if (!message) return false;
      const lower = message.toLowerCase();
      return (
        lower.includes("merge in progress") ||
        lower.includes("merging is not possible") ||
        lower.includes("you have not concluded your merge") ||
        lower.includes("unmerged files")
      );
    };

    setIsSwitching(true);
    try {
      const switchBranch = async () =>
        IpcClient.getInstance().switchGithubBranch(appId, branch);

      const initialResult = await switchBranch();

      if (initialResult.success) {
        showSuccess(`Switched to branch '${branch}'`);
        setCurrentBranch(branch);
        onBranchChange?.();
        return;
      }

      const errorMessage =
        initialResult.error ||
        "Failed to switch branch due to an unknown error";

      if (isRebaseInProgress(errorMessage)) {
        const abortResult =
          await IpcClient.getInstance().abortGithubRebase(appId);
        if (!abortResult.success) {
          showError(
            abortResult.error ||
              "Failed to abort ongoing rebase before switching branches",
          );
          return;
        }

        const retryResult = await switchBranch();
        if (retryResult.success) {
          showSuccess(
            `Aborted ongoing rebase and switched to branch '${branch}'`,
          );
          setCurrentBranch(branch);
          onBranchChange?.();
          return;
        }

        showError(
          retryResult.error ||
            "Failed to switch branch after aborting rebase. Please try again.",
        );
        return;
      }

      if (isMergeInProgress(errorMessage)) {
        const abortResult =
          await IpcClient.getInstance().abortGithubMerge(appId);
        if (!abortResult.success) {
          showError(
            abortResult.error ||
              "Failed to abort ongoing merge before switching branches",
          );
          return;
        }

        const retryResult = await switchBranch();
        if (retryResult.success) {
          showSuccess(
            `Aborted ongoing merge and switched to branch '${branch}'`,
          );
          setCurrentBranch(branch);
          onBranchChange?.();
          return;
        }

        showError(
          retryResult.error ||
            "Failed to switch branch after aborting merge. Please try again.",
        );
        return;
      }

      showError(errorMessage);
    } catch (error: any) {
      showError(error.message || "Failed to switch branch");
    } finally {
      setIsSwitching(false);
    }
  };

  const handleConfirmDeleteBranch = async () => {
    if (!branchToDelete) return;

    setIsDeleting(true);
    try {
      const result = await IpcClient.getInstance().deleteGithubBranch(
        appId,
        branchToDelete,
      );
      if (result.success) {
        showSuccess(`Branch '${branchToDelete}' deleted`);
        setBranchToDelete(null);
        await loadBranches();
      } else {
        showError(result.error || "Failed to delete branch");
      }
    } catch (error: any) {
      showError(error.message || "Failed to delete branch");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRenameBranch = async () => {
    if (!branchToRename || !renameBranchName.trim()) return;
    setIsRenaming(true);
    try {
      const result = await IpcClient.getInstance().renameGithubBranch(
        appId,
        branchToRename,
        renameBranchName,
      );
      if (result.success) {
        showSuccess(`Renamed '${branchToRename}' to '${renameBranchName}'`);
        setBranchToRename(null);
        setRenameBranchName("");
        await loadBranches();
      } else {
        showError(result.error || "Failed to rename branch");
      }
    } catch (error: any) {
      showError(error.message || "Failed to rename branch");
    } finally {
      setIsRenaming(false);
    }
  };

  const handleMergeBranch = async () => {
    if (!branchToMerge) return;
    setIsMerging(true);
    try {
      const result = await IpcClient.getInstance().mergeGithubBranch(
        appId,
        branchToMerge,
      );
      const msg = (result.error || "").toLowerCase();
      const isConflict =
        result.isConflict ||
        msg.includes("conflict") ||
        msg.includes("merge conflict");
      if (result.success) {
        showSuccess(`Merged '${branchToMerge}' into '${currentBranch}'`);
        setBranchToMerge(null);
        await loadBranches(); // Refresh to see any status changes if we implement them
      } else {
        if (!isConflict) {
          showError(result.error || "Failed to merge branch");
        } else {
          showInfo("Merge conflict detected. Please resolve below.");
        }
        // Show conflicts dialog
        if (isConflict) {
          // Fetch the actual conflicts
          const conflictsResult =
            await IpcClient.getInstance().getGithubMergeConflicts(appId);
          if (
            conflictsResult.success &&
            conflictsResult.conflicts &&
            conflictsResult.conflicts.length > 0
          ) {
            setConflicts(conflictsResult.conflicts);
            return;
          }
        }
      }
    } catch (error: any) {
      showError(error.message || "Failed to merge branch");
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Select
          value={currentBranch || ""}
          onValueChange={handleSwitchBranch}
          disabled={
            isSwitching ||
            isDeleting ||
            isRenaming ||
            isMerging ||
            isCreating ||
            isLoading
          }
        >
          <SelectTrigger className="w-full" data-testid="branch-select-trigger">
            <SelectValue placeholder="Select branch" />
          </SelectTrigger>
          <SelectContent>
            {branches.map((branch) => (
              <SelectItem key={branch} value={branch}>
                <Network className="h-4 w-4 text-gray-500" />
                <span className="font-medium text-sm">Branch:</span>
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

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={loadBranches}
                disabled={isLoading}
                title="Refresh branches"
                data-testid="refresh-branches-button"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh branches</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    title="Create new branch"
                    data-testid="create-branch-trigger"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
              </TooltipTrigger>
              <TooltipContent>Create new branch</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Branch</DialogTitle>
              <DialogDescription>Create a new branch.</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div>
                <Label htmlFor="branch-name">Branch Name</Label>
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
                <Label htmlFor="source-branch">Source Branch</Label>
                <Select value={sourceBranch} onValueChange={setSourceBranch}>
                  <SelectTrigger
                    className="mt-2"
                    data-testid="source-branch-select-trigger"
                  >
                    <SelectValue placeholder="Select source (optional, defaults to HEAD)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HEAD">HEAD (Current)</SelectItem>
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
                Cancel
              </Button>
              <Button
                onClick={handleCreateBranch}
                disabled={isCreating || !newBranchName.trim()}
                data-testid="create-branch-submit-button"
              >
                {isCreating ? "Creating..." : "Create Branch"}
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
            <DialogTitle>Rename Branch</DialogTitle>
            <DialogDescription>
              Enter a new name for branch '{branchToRename}'.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="rename-branch-name">New Name</Label>
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
              Cancel
            </Button>
            <Button
              onClick={handleRenameBranch}
              disabled={isRenaming || !renameBranchName.trim()}
              data-testid="rename-branch-submit-button"
            >
              {isRenaming ? "Renaming..." : "Rename"}
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
            <DialogTitle>Merge Branch</DialogTitle>
            <DialogDescription>
              Are you sure you want to merge '{branchToMerge}' into '
              {currentBranch}'?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBranchToMerge(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleMergeBranch}
              disabled={isMerging}
              data-testid="merge-branch-submit-button"
            >
              {isMerging ? "Merging..." : "Merge"}
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
            <AlertDialogTitle>Delete Branch</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the branch '{branchToDelete}'. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeleteBranch}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Branch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Conflict Resolver */}
      {conflicts.length > 0 && (
        <GithubConflictResolver
          appId={appId}
          conflicts={conflicts}
          onResolve={() => {
            setConflicts([]);
            showSuccess("All conflicts resolved. Please commit your changes.");
          }}
          onCancel={() => setConflicts([])}
        />
      )}

      <Card
        className="mt-2 transition-all duration-200"
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => {
          if (!isBranchMenuOpen) setIsExpanded(false);
        }}
        onFocusCapture={() => setIsExpanded(true)}
        onBlurCapture={(event) => {
          if (isBranchMenuOpen) return;
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setIsExpanded(false);
          }
        }}
      >
        <CardHeader
          className="p-2 cursor-pointer"
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GitBranch className="w-5 h-5" />
              <div>
                <CardTitle className="text-sm" data-testid="branches-header">
                  Branches
                </CardTitle>
                <CardDescription className="text-xs">
                  Manage your branches, merge, delete, and more.
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
                            setIsBranchMenuOpen(open);
                            if (open) setIsExpanded(true);
                          }}
                        >
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              data-testid={`branch-actions-${branch}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => setBranchToMerge(branch)}
                              data-testid="merge-branch-menu-item"
                            >
                              <GitMerge className="mr-2 h-4 w-4" />
                              Merge into {currentBranch}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setBranchToRename(branch);
                                setRenameBranchName(branch);
                              }}
                              data-testid="rename-branch-menu-item"
                            >
                              <Edit2 className="mr-2 h-4 w-4" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => setBranchToDelete(branch)}
                              data-testid="delete-branch-menu-item"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
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
