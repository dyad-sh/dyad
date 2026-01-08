import { useState } from "react";
import { useExtensions } from "@/hooks/useExtensions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IpcClient } from "@/ipc/ipc_client";
import { showError, showSuccess } from "@/lib/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, Package } from "lucide-react";

export function ExtensionsPage() {
  const { extensions, isLoading } = useExtensions();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [extensionToDelete, setExtensionToDelete] = useState<string | null>(
    null,
  );
  const queryClient = useQueryClient();

  const deleteExtensionMutation = useMutation<
    void,
    Error,
    { extensionId: string }
  >({
    mutationFn: async ({ extensionId }) => {
      const ipcClient = IpcClient.getInstance() as any;
      await ipcClient.ipcRenderer.invoke("extension:delete", { extensionId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extensions"] });
      showSuccess("Extension deleted successfully");
      setDeleteDialogOpen(false);
      setExtensionToDelete(null);
    },
    onError: (error) => {
      showError(error.message || "Failed to delete extension");
    },
  });

  const handleDeleteClick = (extensionId: string) => {
    setExtensionToDelete(extensionId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (extensionToDelete) {
      deleteExtensionMutation.mutate({ extensionId: extensionToDelete });
    }
  };

  const extensionToDeleteInfo = extensionToDelete
    ? extensions.find((ext) => ext.id === extensionToDelete)
    : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Extensions
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage your installed extensions
        </p>
      </div>

      {extensions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Package className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              No extensions installed
            </h3>
            <p className="text-gray-500 dark:text-gray-400 text-center max-w-md">
              Extensions will appear here once installed. Install extensions by
              placing them in the extensions directory.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {extensions.map((extension) => (
            <Card key={extension.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg mb-1">
                      {extension.name}
                    </CardTitle>
                    <CardDescription className="text-sm">
                      {extension.description}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-xs">
                      v{extension.version}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {extension.id}
                    </Badge>
                  </div>

                  {extension.ui && (
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {extension.ui.settingsPage && (
                        <div className="mb-1">
                          <span className="font-medium">Settings:</span>{" "}
                          {extension.ui.settingsPage.title}
                        </div>
                      )}
                      {extension.ui.appConnector && (
                        <div>
                          <span className="font-medium">Connector:</span>{" "}
                          {extension.ui.appConnector.title}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={() => handleDeleteClick(extension.id)}
                    disabled={deleteExtensionMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Extension</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold">
                {extensionToDeleteInfo?.name}
              </span>
              ? This action cannot be undone and will permanently remove the
              extension from your system.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setExtensionToDelete(null);
              }}
              disabled={deleteExtensionMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteExtensionMutation.isPending}
            >
              {deleteExtensionMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
