import { useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronsDownUp,
  ChevronsUpDown,
  Edit2,
  EllipsisVertical,
  GitBranch,
  GitMerge,
  GitPullRequestArrow,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useGithubBranchInventory } from "@/github_ops/useGithubBranchInventory";
import { useGithubOps } from "@/github_ops/useGithubOps";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
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
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface BranchManagerProps {
  appId: number;
}

export function GithubBranchManager({ appId }: BranchManagerProps) {
  const { data, isFetching, refetch } = useGithubBranchInventory(appId);
  const { projection, send } = useGithubOps(appId);
  const {
    abortOperation,
    canRequestBranchMutation,
    canRequestBranchSwitch,
    completedOperation,
    conflicts,
    isCancellingSync,
    isCreatingBranch,
    isDeletingBranch,
    isMergingBranch,
    isOperationInFlight,
    isPulling,
    isRenamingBranch,
    isSwitchingBranch,
    switchBlocked,
  } = projection;

  const branches = data?.branches ?? [];
  const currentBranch = data?.currentBranch ?? null;

  const [newBranchName, setNewBranchName] = useState("");
  const [sourceBranch, setSourceBranch] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [branchToDelete, setBranchToDelete] = useState<string | null>(null);
  const [branchToRename, setBranchToRename] = useState<string | null>(null);
  const [renameBranchName, setRenameBranchName] = useState("");
  const [branchToMerge, setBranchToMerge] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (conflicts.length > 0) {
      setBranchToMerge(null);
    }

    switch (completedOperation) {
      case "create-branch":
        setNewBranchName("");
        setSourceBranch("");
        setShowCreateDialog(false);
        break;
      case "rename-branch":
        setBranchToRename(null);
        setRenameBranchName("");
        break;
      case "merge":
        setBranchToMerge(null);
        break;
      case "delete-branch":
        setBranchToDelete(null);
        break;
    }
  }, [completedOperation, conflicts]);

  const handleCreateBranch = () => {
    const name = newBranchName.trim();
    if (!name) return;
    send({
      type: "OP_REQUESTED",
      op: {
        type: "create-branch",
        name,
        from: sourceBranch || undefined,
        thenSwitch: true,
      },
    });
  };

  const handleRenameBranch = () => {
    const newName = renameBranchName.trim();
    if (!branchToRename || !newName) return;
    send({
      type: "OP_REQUESTED",
      op: {
        type: "rename-branch",
        oldBranch: branchToRename,
        newBranch: newName,
      },
    });
  };

  const handleMergeBranch = () => {
    if (!branchToMerge) return;
    send({
      type: "OP_REQUESTED",
      op: { type: "merge", branch: branchToMerge },
    });
  };

  const handleDeleteBranch = () => {
    if (!branchToDelete) return;
    send({
      type: "OP_REQUESTED",
      op: { type: "delete-branch", branch: branchToDelete },
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Select
          value={currentBranch || ""}
          onValueChange={(branch) => {
            if (branch && branch !== currentBranch) {
              send({
                type: "OP_REQUESTED",
                op: { type: "switch", branch },
              });
            }
          }}
          disabled={!canRequestBranchSwitch || isFetching}
        >
          <SelectTrigger
            className="w-full"
            aria-label={
              isSwitchingBranch ? "Switching branches" : "Select branch"
            }
            data-testid="branch-select-trigger"
          >
            <SelectValue placeholder="Select branch" />
          </SelectTrigger>
          <SelectContent>
            {branches.map((branch) => (
              <SelectItem key={branch} value={branch} aria-label={branch}>
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

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  className={cn(
                    buttonVariants({ variant: "outline", size: "icon" }),
                  )}
                  disabled={!canRequestBranchMutation}
                  aria-label="Branch actions"
                  data-testid="branch-actions-menu-trigger"
                />
              }
            >
              <EllipsisVertical className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>Branch actions</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => setShowCreateDialog(true)}
              disabled={!canRequestBranchMutation}
              data-testid="create-branch-trigger"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create new branch
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void refetch()}
              disabled={!canRequestBranchMutation || isFetching}
              data-testid="refresh-branches-button"
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
              />
              Refresh branches
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                send({ type: "OP_REQUESTED", op: { type: "pull" } })
              }
              disabled={!canRequestBranchMutation}
              data-testid="git-pull-button"
            >
              <GitPullRequestArrow
                className={`mr-2 h-4 w-4 ${isPulling ? "animate-spin" : ""}`}
              />
              Git pull
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
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
                  onChange={(event) => setNewBranchName(event.target.value)}
                  placeholder="feature/my-new-feature"
                  className="mt-2"
                  data-testid="new-branch-name-input"
                />
              </div>
              <div>
                <Label htmlFor="source-branch">Source Branch</Label>
                <Select
                  value={sourceBranch}
                  onValueChange={(value) => setSourceBranch(value ?? "")}
                >
                  <SelectTrigger
                    className="mt-2"
                    data-testid="source-branch-select-trigger"
                  >
                    <SelectValue placeholder="Select source (optional, defaults to HEAD)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HEAD">HEAD (Current)</SelectItem>
                    {branches.map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        {branch}
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
                disabled={!canRequestBranchMutation || !newBranchName.trim()}
                data-testid="create-branch-submit-button"
              >
                {isCreatingBranch ? "Creating..." : "Create Branch"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

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
              onChange={(event) => setRenameBranchName(event.target.value)}
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
              disabled={!canRequestBranchMutation || !renameBranchName.trim()}
              data-testid="rename-branch-submit-button"
            >
              {isRenamingBranch ? "Renaming..." : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              disabled={!canRequestBranchMutation}
              data-testid="merge-branch-submit-button"
            >
              {isMergingBranch ? "Merging..." : "Merge"}
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
            <AlertDialogCancel disabled={!canRequestBranchMutation}>
              Cancel
            </AlertDialogCancel>
            <Button
              onClick={handleDeleteBranch}
              disabled={!canRequestBranchMutation}
              variant="destructive"
            >
              {isDeletingBranch ? "Deleting..." : "Delete Branch"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={switchBlocked !== null}
        onOpenChange={(open) => {
          if (!open) send({ type: "BLOCKED_DISMISSED" });
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30">
                <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              </span>
              <span className="flex flex-col">
                <span className="text-base font-semibold">
                  {switchBlocked?.blockingOp === "merge"
                    ? "Merge in Progress"
                    : "Rebase in Progress"}
                </span>
                <span className="text-sm text-muted-foreground font-normal">
                  This action will abort the current operation
                </span>
              </span>
            </AlertDialogTitle>
            <AlertDialogDescription
              render={<div />}
              className="mt-4 space-y-4 text-sm"
            >
              <p className="text-foreground">
                A{" "}
                <span className="font-medium">{switchBlocked?.blockingOp}</span>{" "}
                operation is currently in progress. Switching to{" "}
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {switchBlocked?.target}
                </span>{" "}
                will abort this operation.
              </p>
              {switchBlocked?.hasConflicts && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
                  <p className="font-medium">Unresolved conflicts detected</p>
                  <p className="mt-1 text-xs">
                    Aborting will discard any conflict resolution work you’ve
                    already done.
                  </p>
                </div>
              )}
              <p className="text-muted-foreground">
                Are you sure you want to abort the {switchBlocked?.blockingOp}{" "}
                and switch branches?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6 gap-2">
            <AlertDialogCancel
              disabled={isOperationInFlight}
              data-testid="abort-confirmation-cancel"
            >
              Keep working
            </AlertDialogCancel>
            <Button
              onClick={() => send({ type: "ABORT_AND_SWITCH_CONFIRMED" })}
              disabled={isOperationInFlight}
              className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
              data-testid="abort-confirmation-proceed"
            >
              Abort {switchBlocked?.blockingOp === "merge" ? "Merge" : "Rebase"}{" "}
              &amp; Switch
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {conflicts.length > 0 && (
        <div
          className="mt-3 p-3 rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20"
          data-testid="branch-conflict-status"
        >
          <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-3">
            {conflicts.length} file{conflicts.length > 1 ? "s" : ""} with merge
            conflicts: {conflicts.join(", ")}
          </p>
          <Button
            variant="outline"
            onClick={() =>
              send({ type: "OP_REQUESTED", op: { type: abortOperation } })
            }
            disabled={isOperationInFlight}
          >
            {isCancellingSync ? "Cancelling..." : "Cancel sync"}
          </Button>
        </div>
      )}

      <Card className="transition-all duration-200">
        <CardHeader
          className="p-2 cursor-pointer"
          onClick={() => setIsExpanded((expanded) => !expanded)}
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
                            disabled={!canRequestBranchMutation}
                            data-testid={`branch-actions-${branch}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => setBranchToMerge(branch)}
                              disabled={!canRequestBranchMutation}
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
                              disabled={!canRequestBranchMutation}
                              data-testid="rename-branch-menu-item"
                            >
                              <Edit2 className="mr-2 h-4 w-4" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => setBranchToDelete(branch)}
                              disabled={!canRequestBranchMutation}
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
