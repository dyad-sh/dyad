import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CloudUpload, Loader2 } from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import { showSuccess, showError } from "@/lib/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

interface VaultBackupButtonProps {
  appId: number;
  appName: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}

export function VaultBackupButton({
  appId,
  appName,
  variant = "outline",
  size = "sm",
}: VaultBackupButtonProps) {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [notes, setNotes] = useState("");

  const backupMutation = useMutation({
    mutationFn: async ({ appId, notes }: { appId: number; notes?: string }) => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke<void>("vault:create-backup", { appId, notes });
    },
    onSuccess: () => {
      showSuccess(`Backup created for "${appName}"`);
      queryClient.invalidateQueries({ queryKey: ["vault-backups"] });
      setIsDialogOpen(false);
      setNotes("");
    },
    onError: (error: Error) => {
      showError(error.message || "Failed to create backup");
    },
  });

  const handleBackup = () => {
    backupMutation.mutate({ appId, notes: notes || undefined });
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setIsDialogOpen(true)}
        className="flex items-center gap-2"
      >
        <CloudUpload className="h-4 w-4" />
        Backup to Vault
      </Button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Backup to Vault</DialogTitle>
            <DialogDescription>
              Create a cloud backup of "{appName}" to Vault. You can restore
              this backup later.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                placeholder="e.g., Before major refactor..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={backupMutation.isPending}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={backupMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleBackup}
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
    </>
  );
}
