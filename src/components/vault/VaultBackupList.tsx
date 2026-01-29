import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CloudDownload,
  CloudUpload,
  Trash2,
  RefreshCw,
  Calendar,
  HardDrive,
  Package,
  WifiOff,
  KeyRound,
  Loader2,
  Plus,
} from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import { showSuccess, showError } from "@/lib/toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLoadApps } from "@/hooks/useLoadApps";

interface VaultBackup {
  id: string;
  projectName: string;
  sizeBytes: number | null;
  sha256: string | null;
  status: "pending" | "uploaded" | "failed";
  createdAt: string;
  appVersion: string | null;
  notes: string | null;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function VaultBackupList() {
  const queryClient = useQueryClient();
  const [deleteBackupId, setDeleteBackupId] = useState<string | null>(null);
  const [_restoreBackupId, setRestoreBackupId] = useState<string | null>(null);
  const [isCreateBackupDialogOpen, setIsCreateBackupDialogOpen] =
    useState(false);
  const [selectedAppId, setSelectedAppId] = useState<string>("");
  const [backupNotes, setBackupNotes] = useState("");
  const { apps } = useLoadApps();

  // Fetch backups
  const {
    data: backups,
    isLoading,
    error,
    refetch,
  } = useQuery<VaultBackup[]>({
    queryKey: ["vault-backups"],
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke<VaultBackup[]>("vault:list-backups");
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (backupId: string) => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke<void>("vault:delete-backup", { backupId });
    },
    onSuccess: () => {
      showSuccess("Backup deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["vault-backups"] });
      setDeleteBackupId(null);
    },
    onError: (error: Error) => {
      showError(error.message || "Failed to delete backup");
      setDeleteBackupId(null);
    },
  });

  // Create backup mutation
  const createBackupMutation = useMutation({
    mutationFn: async ({ appId, notes }: { appId: number; notes?: string }) => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke<void>("vault:create-backup", { appId, notes });
    },
    onSuccess: () => {
      const appName =
        apps.find((a) => a.id === parseInt(selectedAppId))?.name || "app";
      showSuccess(`Backup created for "${appName}"`);
      queryClient.invalidateQueries({ queryKey: ["vault-backups"] });
      setIsCreateBackupDialogOpen(false);
      setSelectedAppId("");
      setBackupNotes("");
    },
    onError: (error: Error) => {
      showError(error.message || "Failed to create backup");
    },
  });

  // Restore mutation
  const restoreMutation = useMutation({
    mutationFn: async ({
      backupId,
      targetPath,
    }: {
      backupId: string;
      targetPath: string;
    }) => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke<void>("vault:restore-backup", {
        backupId,
        targetPath,
      });
    },
    onSuccess: () => {
      showSuccess("Backup restored successfully");
      setRestoreBackupId(null);
    },
    onError: (error: Error) => {
      showError(error.message || "Failed to restore backup");
      setRestoreBackupId(null);
    },
  });

  const handleDelete = (backupId: string) => {
    setDeleteBackupId(backupId);
  };

  const handleRestore = async (backup: VaultBackup) => {
    // For MVP, we'll prompt for a restore location
    // In production, this should use a proper folder picker dialog
    const targetPath = prompt(
      "Enter the target path for restore:",
      `${process.env.HOME || process.env.USERPROFILE}/Desktop/${backup.projectName}-restored`,
    );

    if (targetPath) {
      restoreMutation.mutate({ backupId: backup.id, targetPath });
    }
  };

  const handleCreateBackup = () => {
    if (selectedAppId) {
      createBackupMutation.mutate({
        appId: parseInt(selectedAppId),
        notes: backupNotes || undefined,
      });
    }
  };

  const renderCreateBackupDialog = () => (
    <Dialog
      open={isCreateBackupDialogOpen}
      onOpenChange={setIsCreateBackupDialogOpen}
    >
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Backup</DialogTitle>
          <DialogDescription>
            Select an app to back up to Vault. You can restore this backup
            later.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="app-select">App to backup</Label>
            <Select value={selectedAppId} onValueChange={setSelectedAppId}>
              <SelectTrigger id="app-select">
                <SelectValue placeholder="Select an app..." />
              </SelectTrigger>
              <SelectContent>
                {apps.map((app) => (
                  <SelectItem key={app.id} value={String(app.id)}>
                    {app.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="backup-notes">Notes (optional)</Label>
            <Input
              id="backup-notes"
              placeholder="e.g., Before major refactor..."
              value={backupNotes}
              onChange={(e) => setBackupNotes(e.target.value)}
              disabled={createBackupMutation.isPending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setIsCreateBackupDialogOpen(false)}
            disabled={createBackupMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateBackup}
            disabled={!selectedAppId || createBackupMutation.isPending}
            className="flex items-center gap-2"
          >
            {createBackupMutation.isPending ? (
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
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Loading backups...
      </div>
    );
  }

  if (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const isNetworkError =
      errorMessage.includes("fetch") ||
      errorMessage.includes("network") ||
      errorMessage.includes("Failed to fetch");
    const isAuthError =
      errorMessage.includes("authenticated") ||
      errorMessage.includes("token") ||
      errorMessage.includes("401") ||
      errorMessage.includes("unauthorized");

    if (isNetworkError) {
      return (
        <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-md flex items-start gap-2">
          <WifiOff className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-orange-700 dark:text-orange-300">
              Unable to connect to Vault
            </p>
            <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
              Check your internet connection and try again.
            </p>
            <Button
              onClick={() => refetch()}
              variant="outline"
              size="sm"
              className="mt-2"
            >
              Retry
            </Button>
          </div>
        </div>
      );
    }

    if (isAuthError) {
      return (
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-md flex items-start gap-2">
          <KeyRound className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Authentication required
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              Your session may have expired. Please sign in again.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-md">
        <p className="text-sm text-red-700 dark:text-red-300">
          Failed to load backups: {errorMessage}
        </p>
        <Button
          onClick={() => refetch()}
          variant="outline"
          size="sm"
          className="mt-2"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!backups || backups.length === 0) {
    return (
      <>
        <div className="p-4 text-center text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-md">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No backups yet</p>
          <p className="text-xs mt-1 mb-3">
            Create a backup from an app's menu, or click below to get started
          </p>
          <Button
            onClick={() => setIsCreateBackupDialogOpen(true)}
            size="sm"
            className="flex items-center gap-2 mx-auto"
            data-testid="vault-create-backup-cta"
          >
            <Plus className="h-4 w-4" />
            Create Backup
          </Button>
        </div>
        {renderCreateBackupDialog()}
      </>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Your Backups ({backups.length})
        </h4>
        <Button
          onClick={() => refetch()}
          variant="ghost"
          size="sm"
          className="h-7 px-2"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {backups.map((backup) => (
          <div
            key={backup.id}
            className="flex items-center justify-between p-3 rounded-md bg-muted/50 text-sm gap-2"
          >
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-gray-700 dark:text-gray-300 font-medium truncate">
                {backup.projectName}
              </span>
              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {formatDistanceToNow(new Date(backup.createdAt), {
                    addSuffix: true,
                  })}
                </span>
                <span className="flex items-center gap-1">
                  <HardDrive className="h-3 w-3" />
                  {formatBytes(backup.sizeBytes)}
                </span>
                {backup.appVersion && (
                  <span className="text-gray-400">v{backup.appVersion}</span>
                )}
              </div>
              {backup.status === "pending" && (
                <span className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Upload in progress...
                </span>
              )}
              {backup.status === "failed" && (
                <span className="text-xs text-red-600 dark:text-red-400 mt-1">
                  Upload failed
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground hover:text-primary"
                onClick={() => handleRestore(backup)}
                disabled={
                  backup.status !== "uploaded" || restoreMutation.isPending
                }
                title="Restore backup"
              >
                <CloudDownload className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(backup.id)}
                disabled={deleteMutation.isPending}
                title="Delete backup"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={!!deleteBackupId}
        title="Delete Backup"
        message="Are you sure you want to delete this backup? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={() => {
          if (deleteBackupId) {
            deleteMutation.mutate(deleteBackupId);
          }
        }}
        onCancel={() => setDeleteBackupId(null)}
      />
    </div>
  );
}
