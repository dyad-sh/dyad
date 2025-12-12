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
import { Label } from "@/components/ui/label";
import { showSuccess, showError } from "@/lib/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // New state for features
  const [sourceBranch, setSourceBranch] = useState<string>("");
  const [branchToRename, setBranchToRename] = useState<string | null>(null);
  const [renameBranchName, setRenameBranchName] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [branchToMerge, setBranchToMerge] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);

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
    setIsSwitching(true);
    try {
      const result = await IpcClient.getInstance().switchGithubBranch(
        appId,
        branch,
      );
      if (result.success) {
        showSuccess(`Switched to branch '${branch}'`);
        setCurrentBranch(branch);
        onBranchChange?.();
      } else {
        showError(result.error || "Failed to switch branch");
      }
    } catch (error: any) {
      showError(error.message || "Failed to switch branch");
    } finally {
      setIsSwitching(false);
    }
  };

  const handleDeleteBranch = async (branch: string) => {
    if (branch === currentBranch) {
      showError("Cannot delete current branch");
      return;
    }
    if (!confirm(`Are you sure you want to delete branch '${branch}'?`)) return;

    setIsDeleting(true);
    try {
      const result = await IpcClient.getInstance().deleteGithubBranch(
        appId,
        branch,
      );
      if (result.success) {
        showSuccess(`Branch '${branch}' deleted`);
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
      if (result.success) {
        showSuccess(`Merged '${branchToMerge}' into '${currentBranch}'`);
        setBranchToMerge(null);
        await loadBranches(); // Refresh to see any status changes if we implement them
      } else {
        showError(result.error || "Failed to merge branch");
      }
    } catch (error: any) {
      showError(error.message || "Failed to merge branch");
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-gray-500" />
          <span className="font-medium text-sm">Current Branch:</span>
          <span
            data-testid="current-branch-display"
            className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded"
          >
            {currentBranch || "..."}
          </span>
        </div>
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
      </div>

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
                {branch}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
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

      {/* List of other branches with delete option? Or just rely on Select? */}
      {/* Maybe a "Manage Branches" dialog if list is long, but for now Select is fine. */}
      {branches.length > 1 && (
        <div className="mt-2 mb-2">
          <p className="text-xs text-gray-500 mb-2">Available Branches:</p>
          <div className="space-y-1 max-h-40 overflow-y-auto border rounded-md p-2">
            {branches.map((branch) => (
              <div
                key={branch}
                className="flex items-center justify-between text-sm py-1 px-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded"
                data-testid={`branch-item-${branch}`}
              >
                <span
                  className={
                    branch === currentBranch ? "font-bold text-blue-600" : ""
                  }
                >
                  {branch}
                </span>
                {branch !== currentBranch && (
                  <DropdownMenu>
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
                        onClick={() => handleDeleteBranch(branch)}
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
    </div>
  );
}
