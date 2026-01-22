import { useState } from "react";
import { IpcClient } from "@/ipc/ipc_client";
import { showSuccess, showError, showInfo } from "@/lib/toast";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export function RestoreSettings() {
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const queryClient = useQueryClient();

  const handleSyncApps = async () => {
    setIsSyncing(true);
    setIsSyncDialogOpen(false);
    try {
      const ipcClient = IpcClient.getInstance();
      const result = await ipcClient.syncAppsFromFolder();

      if (result.imported.length === 0 && result.errors.length === 0) {
        showInfo("No new apps found to sync.");
      } else if (result.imported.length > 0) {
        showSuccess(
          `Successfully synced ${result.imported.length} app${result.imported.length === 1 ? "" : "s"}: ${result.imported.join(", ")}`,
        );
        // Invalidate the apps list query to refresh the UI
        queryClient.invalidateQueries({ queryKey: ["apps"] });
      }

      if (result.errors.length > 0) {
        const errorMessages = result.errors
          .map((e) => `${e.folder}: ${e.error}`)
          .join("; ");
        showError(`Failed to sync some apps: ${errorMessages}`);
      }
    } catch (error) {
      console.error("Error syncing apps:", error);
      showError(
        error instanceof Error ? error.message : "An unknown error occurred",
      );
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <>
      <div className="flex items-start justify-between flex-col sm:flex-row sm:items-center gap-4">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            Sync Apps from Folder
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Import apps from the dyad-apps folder that are not tracked in the
            database. Useful after database resets or migrations.
          </p>
        </div>
        <button
          onClick={() => setIsSyncDialogOpen(true)}
          disabled={isSyncing}
          className="rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isSyncing && <Loader2 className="h-4 w-4 animate-spin" />}
          {isSyncing ? "Syncing..." : "Sync Apps"}
        </button>
      </div>

      <ConfirmationDialog
        isOpen={isSyncDialogOpen}
        title="Sync Apps from Folder"
        message="This will scan your dyad-apps folder and import any apps that exist on disk but are not tracked in the database. Existing apps will not be affected."
        confirmText="Sync Apps"
        cancelText="Cancel"
        confirmButtonClass="bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
        onConfirm={handleSyncApps}
        onCancel={() => setIsSyncDialogOpen(false)}
      />
    </>
  );
}
