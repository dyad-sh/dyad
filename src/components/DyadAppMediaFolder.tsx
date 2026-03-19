import { useMemo, useState } from "react";
import { Folder, Image } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ipc,
  type MediaFile,
  type RenameMediaFileParams,
  type DeleteMediaFileParams,
  type MoveMediaFileParams,
} from "@/ipc/types";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import { useSelectChat } from "@/hooks/useSelectChat";
import { INVALID_FILE_NAME_CHARS } from "@/shared/media_validation";
import {
  getFileNameWithoutExtension,
  getFileExtension,
} from "./media-library/media-folder-utils";
import { MediaFolderOpen } from "./media-library/MediaFolderOpen";
import { ImageLightbox } from "./chat/ImageLightbox";
import { buildDyadMediaUrl } from "@/lib/dyadMediaUrl";
import { AppSearchSelect } from "./AppSearchSelect";

interface DyadAppMediaFolderProps {
  appName: string;
  appId: number;
  appPath: string;
  files: MediaFile[];
  allApps: { id: number; name: string }[];
  onRenameMediaFile: (params: RenameMediaFileParams) => Promise<void>;
  onDeleteMediaFile: (params: DeleteMediaFileParams) => Promise<void>;
  onMoveMediaFile: (params: MoveMediaFileParams) => Promise<void>;
  isMutatingMedia?: boolean;
  searchQuery?: string;
}

export function DyadAppMediaFolder({
  appName,
  appId,
  appPath,
  files,
  allApps,
  onRenameMediaFile,
  onDeleteMediaFile,
  onMoveMediaFile,
  isMutatingMedia = false,
  searchQuery,
}: DyadAppMediaFolderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [renameTargetFile, setRenameTargetFile] = useState<MediaFile | null>(
    null,
  );
  const [renameBaseName, setRenameBaseName] = useState("");
  const [deleteTargetFile, setDeleteTargetFile] = useState<MediaFile | null>(
    null,
  );
  const [moveTargetFile, setMoveTargetFile] = useState<MediaFile | null>(null);
  const [moveTargetAppId, setMoveTargetAppId] = useState<number | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
  const queryClient = useQueryClient();
  const { selectChat } = useSelectChat();

  const moveTargetApps = useMemo(
    () => allApps.filter((app) => app.id !== appId),
    [allApps, appId],
  );

  const isBusy =
    isMutatingMedia || isRenaming || isDeleting || isMoving || isStartingChat;
  const renameError =
    renameBaseName.trim() && INVALID_FILE_NAME_CHARS.test(renameBaseName.trim())
      ? 'Name contains invalid characters (<>:"/\\|?*)'
      : null;

  const handleStartNewChatWithImage = async (file: MediaFile) => {
    setIsStartingChat(true);
    try {
      const chatId = await ipc.chat.createChat(file.appId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      selectChat({
        chatId,
        appId: file.appId,
        prefillInput: `@media:${encodeURIComponent(file.fileName)} `,
      });
    } catch (error) {
      showError(error);
    } finally {
      setIsStartingChat(false);
    }
  };

  const openRenameDialog = (file: MediaFile) => {
    setRenameTargetFile(file);
    setRenameBaseName(getFileNameWithoutExtension(file.fileName));
  };

  const handleRenameImage = async () => {
    if (!renameTargetFile) return;
    const trimmedBaseName = renameBaseName.trim();
    if (!trimmedBaseName) return;
    if (renameError) return;

    setIsRenaming(true);
    try {
      await onRenameMediaFile({
        appId: renameTargetFile.appId,
        fileName: renameTargetFile.fileName,
        newBaseName: trimmedBaseName,
      });
      setRenameTargetFile(null);
      setRenameBaseName("");
    } catch {
      // Error toast is handled in the mutation hook.
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDeleteImage = async () => {
    if (!deleteTargetFile) return;

    setIsDeleting(true);
    try {
      await onDeleteMediaFile({
        appId: deleteTargetFile.appId,
        fileName: deleteTargetFile.fileName,
      });
      setDeleteTargetFile(null);
    } catch {
      // Error toast is handled in the mutation hook.
    } finally {
      setIsDeleting(false);
    }
  };

  const handleMoveImage = async () => {
    if (!moveTargetFile || moveTargetAppId === null) return;

    setIsMoving(true);
    try {
      await onMoveMediaFile({
        sourceAppId: moveTargetFile.appId,
        fileName: moveTargetFile.fileName,
        targetAppId: moveTargetAppId,
      });
      setMoveTargetFile(null);
      setMoveTargetAppId(null);
    } catch {
      // Error toast is handled in the mutation hook.
    } finally {
      setIsMoving(false);
    }
  };

  if (isOpen) {
    return (
      <>
        <MediaFolderOpen
          appName={appName}
          appId={appId}
          appPath={appPath}
          files={files}
          onClose={() => setIsOpen(false)}
          onStartNewChatWithImage={handleStartNewChatWithImage}
          onRenameImage={openRenameDialog}
          onMoveImage={(file) => setMoveTargetFile(file)}
          onDeleteImage={(file) => setDeleteTargetFile(file)}
          onPreviewImage={(file) => setPreviewFile(file)}
          isBusy={isBusy}
          searchQuery={searchQuery}
        />

        <Dialog
          open={renameTargetFile !== null}
          onOpenChange={(open) => {
            if (!open) {
              setRenameTargetFile(null);
              setRenameBaseName("");
            }
          }}
        >
          <DialogContent data-testid="media-rename-dialog">
            <DialogHeader>
              <DialogTitle>Rename Image</DialogTitle>
              <DialogDescription>
                Rename the image without changing its extension.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <p className="text-sm text-muted-foreground">
                Current file: {renameTargetFile?.fileName}
              </p>
              <div className="flex items-center gap-2">
                <Input
                  data-testid="media-rename-input"
                  value={renameBaseName}
                  onChange={(event) => setRenameBaseName(event.target.value)}
                  placeholder="New image name"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleRenameImage();
                    }
                  }}
                />
                <span className="text-sm text-muted-foreground">
                  {renameTargetFile
                    ? getFileExtension(renameTargetFile.fileName)
                    : ""}
                </span>
              </div>
              {renameError && (
                <p className="text-sm text-destructive">{renameError}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setRenameTargetFile(null);
                  setRenameBaseName("");
                }}
                disabled={isBusy}
              >
                Cancel
              </Button>
              <Button
                data-testid="media-rename-confirm-button"
                onClick={() => {
                  void handleRenameImage();
                }}
                disabled={
                  isBusy ||
                  !renameTargetFile ||
                  !renameBaseName.trim() ||
                  !!renameError ||
                  renameBaseName.trim() ===
                    getFileNameWithoutExtension(renameTargetFile.fileName)
                }
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={deleteTargetFile !== null}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteTargetFile(null);
            }
          }}
        >
          <AlertDialogContent data-testid="media-delete-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Image</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete{" "}
                <strong>{deleteTargetFile?.fileName}</strong>? This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isBusy}>Cancel</AlertDialogCancel>
              <Button
                data-testid="media-delete-confirm-button"
                variant="destructive"
                onClick={() => {
                  void handleDeleteImage();
                }}
                disabled={isBusy}
              >
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog
          open={moveTargetFile !== null}
          onOpenChange={(open) => {
            if (!open) {
              setMoveTargetFile(null);
              setMoveTargetAppId(null);
            }
          }}
        >
          <DialogContent data-testid="media-move-dialog">
            <DialogHeader>
              <DialogTitle>Move Image</DialogTitle>
              <DialogDescription>
                Move <strong>{moveTargetFile?.fileName}</strong> to another app.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <AppSearchSelect
                apps={moveTargetApps}
                selectedAppId={moveTargetAppId}
                onSelect={setMoveTargetAppId}
                disabled={isBusy}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setMoveTargetFile(null);
                  setMoveTargetAppId(null);
                }}
                disabled={isBusy}
              >
                Cancel
              </Button>
              <Button
                data-testid="media-move-confirm-button"
                onClick={() => {
                  void handleMoveImage();
                }}
                disabled={isBusy || moveTargetAppId === null}
              >
                Move
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {previewFile && (
          <ImageLightbox
            imageUrl={buildDyadMediaUrl(appPath, previewFile.fileName)}
            alt={previewFile.fileName}
            filePath={`${appPath}/.dyad/media/${previewFile.fileName}`}
            onClose={() => setPreviewFile(null)}
          />
        )}
      </>
    );
  }

  return (
    <div
      data-testid={`media-folder-${appId}`}
      className={cn(
        "border rounded-lg p-4 bg-[--background-lightest] relative cursor-pointer",
        "hover:border-primary/30 transition-colors",
      )}
      role="button"
      tabIndex={0}
      onClick={() => setIsOpen(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setIsOpen(true);
        }
      }}
    >
      <Badge
        variant="outline"
        className={cn(
          "absolute top-3 right-3 gap-1",
          "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800",
        )}
      >
        <Image className="h-3 w-3" />
        Media
      </Badge>
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 flex items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-900/20">
          <Folder className="h-8 w-8 text-amber-500" fill="currentColor" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold truncate">{appName}</h3>
          <p className="text-sm text-muted-foreground">
            {files.length} media file{files.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
