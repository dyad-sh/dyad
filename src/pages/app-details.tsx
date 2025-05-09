import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import { appBasePathAtom, appsListAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  MoreVertical,
  MessageCircle,
  Pencil,
  Folder,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GitHubConnector } from "@/components/GitHubConnector";
import { SupabaseConnector } from "@/components/SupabaseConnector";
import { showError } from "@/lib/toast";

export default function AppDetailsPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({ from: "/app-details" as const });
  const [appsList] = useAtom(appsListAtom);
  const { refreshApps } = useLoadApps();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [isRenameConfirmDialogOpen, setIsRenameConfirmDialogOpen] =
    useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [isRenameFolderDialogOpen, setIsRenameFolderDialogOpen] =
    useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
  const appBasePath = useAtomValue(appBasePathAtom);

  // Get the appId from search params and find the corresponding app
  const appId = search.appId ? Number(search.appId) : null;
  const selectedApp = appId ? appsList.find((app) => app.id === appId) : null;

  const handleDeleteApp = async () => {
    if (!appId) return;

    try {
      setIsDeleting(true);
      await IpcClient.getInstance().deleteApp(appId);
      setIsDeleteDialogOpen(false);
      await refreshApps();
      navigate({ to: "/", search: {} });
    } catch (error) {
      showError(error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenRenameDialog = () => {
    if (selectedApp) {
      setNewAppName(selectedApp.name);
      setIsRenameDialogOpen(true);
    }
  };

  const handleOpenRenameFolderDialog = () => {
    if (selectedApp) {
      setNewFolderName(selectedApp.path.split("/").pop() || selectedApp.path);
      setIsRenameFolderDialogOpen(true);
    }
  };

  const handleRenameApp = async (renameFolder: boolean) => {
    if (!appId || !selectedApp || !newAppName.trim()) return;

    try {
      setIsRenaming(true);

      // Determine the new path based on user's choice
      const appPath = renameFolder ? newAppName : selectedApp.path;

      await IpcClient.getInstance().renameApp({
        appId,
        appName: newAppName,
        appPath,
      });

      setIsRenameDialogOpen(false);
      setIsRenameConfirmDialogOpen(false);
      await refreshApps();
    } catch (error) {
      console.error("Failed to rename app:", error);
      alert(
        `Error renaming app: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setIsRenaming(false);
    }
  };

  const handleRenameFolderOnly = async () => {
    if (!appId || !selectedApp || !newFolderName.trim()) return;

    try {
      setIsRenamingFolder(true);

      await IpcClient.getInstance().renameApp({
        appId,
        appName: selectedApp.name, // Keep the app name the same
        appPath: newFolderName, // Change only the folder path
      });

      setIsRenameFolderDialogOpen(false);
      await refreshApps();
    } catch (error) {
      console.error("Failed to rename folder:", error);
      alert(
        `Error renaming folder: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setIsRenamingFolder(false);
    }
  };

  if (!selectedApp) {
    return (
      <div className="relative min-h-screen p-8">
        <Button
          onClick={() => router.history.back()}
          variant="outline"
          size="sm"
          className="absolute top-4 left-4 flex items-center gap-1 bg-(--background-lightest) py-5"
        >
          <ArrowLeft className="h-3 w-4" />
          Back
        </Button>
        <div className="flex flex-col items-center justify-center h-full">
          <h2 className="text-xl font-bold">App not found</h2>
        </div>
      </div>
    );
  }

  const fullAppPath = appBasePath.replace("$APP_BASE_PATH", selectedApp.path);

  return (
    <div className="relative min-h-screen p-4 w-full">
      <Button
        onClick={() => router.history.back()}
        variant="outline"
        size="sm"
        className="absolute top-4 left-4 flex items-center gap-1 bg-(--background-lightest) py-2"
      >
        <ArrowLeft className="h-3 w-4" />
        Back
      </Button>

      <div className="w-full max-w-2xl mx-auto mt-10 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm relative">
        <div className="flex items-center mb-3">
          <h2 className="text-2xl font-bold">{selectedApp.name}</h2>
          <Button
            variant="ghost"
            size="sm"
            className="ml-1 p-0.5 h-auto"
            onClick={handleOpenRenameDialog}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Overflow Menu in top right */}
        <div className="absolute top-2 right-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-2" align="end">
              <div className="flex flex-col space-y-0.5">
                <Button
                  onClick={handleOpenRenameFolderDialog}
                  variant="ghost"
                  size="sm"
                  className="h-8 justify-start text-xs"
                >
                  Rename folder
                </Button>
                <Button
                  onClick={() => setIsDeleteDialogOpen(true)}
                  variant="ghost"
                  size="sm"
                  className="h-8 justify-start text-xs"
                >
                  Delete
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          <div>
            <span className="block text-gray-500 dark:text-gray-400 mb-0.5 text-xs">
              Created
            </span>
            <span>{new Date().toLocaleString()}</span>
          </div>
          <div>
            <span className="block text-gray-500 dark:text-gray-400 mb-0.5 text-xs">
              Last Updated
            </span>
            <span>{new Date().toLocaleString()}</span>
          </div>
          <div className="col-span-2">
            <span className="block text-gray-500 dark:text-gray-400 mb-0.5 text-xs">
              Path
            </span>
            <div className="flex items-center gap-1">
              <span className="text-sm break-all">{fullAppPath}</span>
              <Button
                variant="ghost"
                size="sm"
                className="p-0.5 h-auto cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                onClick={() => {
                  IpcClient.getInstance().showItemInFolder(fullAppPath);
                }}
                title="Show in folder"
              >
                <Folder className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Button
            onClick={() => {
              if (!appId) {
                console.error("No app id found");
                return;
              }
              navigate({ to: "/chat" });
            }}
            className="cursor-pointer w-full py-5 flex justify-center items-center gap-2"
            size="lg"
          >
            Open in Chat
            <MessageCircle className="h-4 w-4" />
          </Button>
          <GitHubConnector appId={appId} folderName={selectedApp.path} />
          {appId && <SupabaseConnector appId={appId} />}
        </div>

        {/* Rename Dialog */}
        <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
          <DialogContent className="max-w-sm p-4">
            <DialogHeader className="pb-2">
              <DialogTitle>Rename App</DialogTitle>
            </DialogHeader>
            <Input
              value={newAppName}
              onChange={(e) => setNewAppName(e.target.value)}
              placeholder="Enter new app name"
              className="my-2"
              autoFocus
            />
            <DialogFooter className="pt-2">
              <Button
                variant="outline"
                onClick={() => setIsRenameDialogOpen(false)}
                disabled={isRenaming}
                size="sm"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setIsRenameDialogOpen(false);
                  setIsRenameConfirmDialogOpen(true);
                }}
                disabled={isRenaming || !newAppName.trim()}
                size="sm"
              >
                Continue
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Rename Folder Dialog */}
        <Dialog
          open={isRenameFolderDialogOpen}
          onOpenChange={setIsRenameFolderDialogOpen}
        >
          <DialogContent className="max-w-sm p-4">
            <DialogHeader className="pb-2">
              <DialogTitle>Rename app folder</DialogTitle>
              <DialogDescription className="text-xs">
                This will change only the folder name, not the app name.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Enter new folder name"
              className="my-2"
              autoFocus
            />
            <DialogFooter className="pt-2">
              <Button
                variant="outline"
                onClick={() => setIsRenameFolderDialogOpen(false)}
                disabled={isRenamingFolder}
                size="sm"
              >
                Cancel
              </Button>
              <Button
                onClick={handleRenameFolderOnly}
                disabled={isRenamingFolder || !newFolderName.trim()}
                size="sm"
              >
                {isRenamingFolder ? (
                  <>
                    <svg
                      className="animate-spin h-3 w-3 mr-1"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Renaming...
                  </>
                ) : (
                  "Rename Folder"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Rename Confirmation Dialog */}
        <Dialog
          open={isRenameConfirmDialogOpen}
          onOpenChange={setIsRenameConfirmDialogOpen}
        >
          <DialogContent className="max-w-sm p-4">
            <DialogHeader className="pb-2">
              <DialogTitle className="text-base">
                How would you like to rename "{selectedApp.name}"?
              </DialogTitle>
              <DialogDescription className="text-xs">
                Choose an option:
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 my-2">
              <Button
                variant="outline"
                className="w-full justify-start p-2 h-auto relative text-sm"
                onClick={() => handleRenameApp(true)}
                disabled={isRenaming}
              >
                <div className="absolute top-1 right-1">
                  <span className="bg-blue-100 text-blue-800 text-xs font-medium px-1.5 py-0.5 rounded dark:bg-blue-900 dark:text-blue-300 text-[10px]">
                    Recommended
                  </span>
                </div>
                <div className="text-left">
                  <p className="font-medium text-xs">Rename app and folder</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Renames the folder to match the new app name.
                  </p>
                </div>
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start p-2 h-auto text-sm"
                onClick={() => handleRenameApp(false)}
                disabled={isRenaming}
              >
                <div className="text-left">
                  <p className="font-medium text-xs">Rename app only</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    The folder name will remain the same.
                  </p>
                </div>
              </Button>
            </div>
            <DialogFooter className="pt-2">
              <Button
                variant="outline"
                onClick={() => setIsRenameConfirmDialogOpen(false)}
                disabled={isRenaming}
                size="sm"
              >
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent className="max-w-sm p-4">
            <DialogHeader className="pb-2">
              <DialogTitle>Delete "{selectedApp.name}"?</DialogTitle>
              <DialogDescription className="text-xs">
                This action is irreversible. All app files and chat history will
                be permanently deleted.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setIsDeleteDialogOpen(false)}
                disabled={isDeleting}
                size="sm"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteApp}
                disabled={isDeleting}
                className="flex items-center gap-1"
                size="sm"
              >
                {isDeleting ? (
                  <>
                    <svg
                      className="animate-spin h-3 w-3 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Deleting...
                  </>
                ) : (
                  "Delete App"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
