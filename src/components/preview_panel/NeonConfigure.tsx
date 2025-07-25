import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Database, GitBranch, Trash2 } from "lucide-react";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useDeleteNeonBranch } from "@/hooks/useDeleteNeonBranch";
import { IpcClient } from "@/ipc/ipc_client";
import type { GetNeonProjectResponse, NeonBranch } from "@/ipc/ipc_types";
import { NeonDisconnectButton } from "@/components/NeonDisconnectButton";
import { NeonBranchGraph } from "./NeonBranchGraph";
import { toast } from "sonner";

const getBranchTypeColor = (type: NeonBranch["type"]) => {
  switch (type) {
    case "production":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
    case "development":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
    case "snapshot":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    case "preview":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
  }
};

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleString();
};

export const NeonConfigure = () => {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { app } = useLoadApp(selectedAppId);
  const { deleteNeonBranch } = useDeleteNeonBranch();
  const [deletingBranchId, setDeletingBranchId] = useState<string | null>(null);

  // Query to get Neon project information
  const {
    data: neonProject,
    isLoading,
    error,
  } = useQuery<GetNeonProjectResponse, Error>({
    queryKey: ["neon-project", selectedAppId],
    queryFn: async () => {
      if (!selectedAppId) throw new Error("No app selected");
      const ipcClient = IpcClient.getInstance();
      return await ipcClient.getNeonProject({ appId: selectedAppId });
    },
    enabled: !!selectedAppId && !!app?.neonProjectId,
    meta: { showErrorToast: true },
  });

  // Don't show component if app doesn't have Neon project
  if (!app?.neonProjectId) {
    return null;
  }

  // Show loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database size={20} />
            Neon Database
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="text-sm text-muted-foreground">
              Loading Neon project information...
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database size={20} />
            Neon Database
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="text-sm text-red-500">
              Error loading Neon project: {error.message}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!neonProject) {
    return null;
  }

  const handleDeleteBranch = async (branch: NeonBranch) => {
    if (!selectedAppId) return;

    try {
      setDeletingBranchId(branch.branchId);
      await deleteNeonBranch({
        appId: selectedAppId,
        branchId: branch.branchId,
        branchName: branch.branchName,
      });
      toast.success(`Successfully deleted branch "${branch.branchName}"`);
    } catch (error) {
      // Error is already handled by the hook
      console.error("Failed to delete branch:", error);
    } finally {
      setDeletingBranchId(null);
    }
  };

  const canDeleteBranch = (branch: NeonBranch) => {
    // Don't allow deletion of production, development, or preview branches
    return branch.type === "snapshot";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <Database size={20} />
            Neon Database
          </div>
          <NeonDisconnectButton />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Project Information */}
        <div className="space-y-2">
          <div className="text-sm font-medium">Project Information</div>
          <div className="bg-muted/50 p-3 rounded-md space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Project Name:</span>
              <span className="font-medium">{neonProject.projectName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Project ID:</span>
              <span className="font-mono text-xs">{neonProject.projectId}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Organization:</span>
              <span className="font-mono text-xs">{neonProject.orgId}</span>
            </div>
          </div>
        </div>

        {/* Branch Hierarchy Graph */}
        <NeonBranchGraph branches={neonProject.branches} />

        {/* Branches */}
        <div className="space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <GitBranch size={16} />
            Branches ({neonProject.branches.length})
          </div>
          <div className="space-y-2">
            {neonProject.branches.map((branch) => (
              <div
                key={branch.branchId}
                className="flex items-center justify-between p-3 border rounded-md"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">
                      {branch.branchName}
                    </span>
                    <Badge
                      variant="secondary"
                      className={getBranchTypeColor(branch.type)}
                    >
                      {branch.type}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    ID: {branch.branchId}
                  </div>
                  {branch.parentBranchName && (
                    <div className="text-xs text-muted-foreground">
                      Parent: {branch.parentBranchName.slice(0, 20)}...
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Updated: {formatDate(branch.lastUpdated)}
                  </div>
                </div>
                {canDeleteBranch(branch) && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={deletingBranchId === branch.branchId}
                        className="ml-2 text-destructive hover:text-destructive"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Neon Branch</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete the branch "
                          {branch.branchName}"?
                          <br />
                          <br />
                          <strong className="text-red-600">
                            This action is permanent and cannot be undone.
                          </strong>
                          <br />
                          All data in this branch will be permanently lost.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDeleteBranch(branch)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          disabled={deletingBranchId === branch.branchId}
                        >
                          {deletingBranchId === branch.branchId
                            ? "Deleting..."
                            : "Delete Branch"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Disconnect Button */}
        <div className="pt-4 border-t"></div>
      </CardContent>
    </Card>
  );
};
