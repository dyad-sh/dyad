import { useMemo, useState } from "react";
import {
  Folder,
  FolderOpen,
  ArrowLeft,
  Image,
  MoreVertical,
  MessageSquarePlus,
  Pencil,
  Trash2,
  MoveRight,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useMediaDataUri } from "@/hooks/useMediaDataUri";
import { buttonVariants, Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

interface MoveTargetApp {
  id: number;
  name: string;
}

interface DyadAppMediaFolderProps {
  appName: string;
  appId: number;
  files: MediaFile[];
  allApps: MoveTargetApp[];
  onRenameMediaFile: (params: RenameMediaFileParams) => Promise<void>;
  onDeleteMediaFile: (params: DeleteMediaFileParams) => Promise<void>;
  onMoveMediaFile: (params: MoveMediaFileParams) => Promise<void>;
  isMutatingMedia?: boolean;
  normalizedCollapsedHeight?: number;
  searchQuery?: string;
}

export function DyadAppMediaFolder({
  appName,
  appId,
  files,
  allApps,
  onRenameMediaFile,
  onDeleteMediaFile,
  onMoveMediaFile,
  isMutatingMedia = false,
  normalizedCollapsedHeight,
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
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
  const queryClient = useQueryClient();
  const { selectChat } = useSelectChat();

  const moveTargets = useMemo(
    () => allApps.filter((app) => app.id !== appId),
    [allApps, appId],
  );

  const isBusy = isMutatingMedia || isRenaming || isDeleting || isStartingChat;

  const handleStartNewChatWithImage = async (file: MediaFile) => {
    setIsStartingChat(true);
    try {
      const chatId = await ipc.chat.createChat(file.appId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      selectChat({
        chatId,
        appId: file.appId,
        prefillInput: `@media:${appName}/${file.fileName} `,
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

  if (isOpen) {
    return (
      <>
        <MediaFolderOpen
          appName={appName}
          appId={appId}
          files={files}
          moveTargets={moveTargets}
          onClose={() => setIsOpen(false)}
          onStartNewChatWithImage={handleStartNewChatWithImage}
          onRenameImage={openRenameDialog}
          onMoveImage={(file, targetAppId) =>
            onMoveMediaFile({
              sourceAppId: file.appId,
              fileName: file.fileName,
              targetAppId,
            }).catch(() => {
              // Error toast is handled in the mutation hook.
            })
          }
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
          open={previewFile !== null}
          onOpenChange={(open) => {
            if (!open) setPreviewFile(null);
          }}
        >
          <DialogContent className="max-w-3xl p-0 overflow-hidden bg-black/95 border-none">
            <DialogHeader className="absolute top-2 right-2 z-10">
              <DialogTitle className="sr-only">
                {previewFile?.fileName}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Preview of {previewFile?.fileName}
              </DialogDescription>
              <button
                onClick={() => setPreviewFile(null)}
                className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </DialogHeader>
            {previewFile && (
              <ImagePreview
                appId={previewFile.appId}
                fileName={previewFile.fileName}
              />
            )}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div
      data-testid={`media-folder-${appId}`}
      data-library-grid-height-item="true"
      className={cn(
        "border rounded-lg p-4 bg-(--background-lightest) relative cursor-pointer",
        "hover:border-primary/30 transition-colors",
      )}
      style={
        normalizedCollapsedHeight
          ? { minHeight: `${normalizedCollapsedHeight}px` }
          : undefined
      }
      onClick={() => setIsOpen(true)}
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

function MediaFolderOpen({
  appName,
  appId,
  files,
  moveTargets,
  onClose,
  onStartNewChatWithImage,
  onRenameImage,
  onMoveImage,
  onDeleteImage,
  onPreviewImage,
  isBusy,
  searchQuery,
}: {
  appName: string;
  appId: number;
  files: MediaFile[];
  moveTargets: MoveTargetApp[];
  onClose: () => void;
  onStartNewChatWithImage: (file: MediaFile) => Promise<void>;
  onRenameImage: (file: MediaFile) => void;
  onMoveImage: (file: MediaFile, targetAppId: number) => Promise<void>;
  onDeleteImage: (file: MediaFile) => void;
  onPreviewImage: (file: MediaFile) => void;
  isBusy: boolean;
  searchQuery?: string;
}) {
  const filteredFiles = searchQuery
    ? files.filter((f) =>
        f.fileName.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : files;

  return (
    <div
      data-testid={`media-folder-open-${appId}`}
      className="border rounded-lg p-4 bg-(--background-lightest) col-span-full"
    >
      <div className="flex items-center gap-2 mb-4">
        <button
          data-testid="media-folder-back-button"
          onClick={onClose}
          className="p-1 rounded-md hover:bg-secondary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <FolderOpen className="h-5 w-5 text-amber-500" />
        <h3 className="text-lg font-semibold">{appName}</h3>
        <span className="text-sm text-muted-foreground">
          ({filteredFiles.length} file{filteredFiles.length !== 1 ? "s" : ""})
        </span>
      </div>
      {filteredFiles.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          No media files found.
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {filteredFiles.map((file) => (
            <MediaFileThumbnail
              key={file.fileName}
              file={file}
              moveTargets={moveTargets}
              onStartNewChatWithImage={onStartNewChatWithImage}
              onRenameImage={onRenameImage}
              onMoveImage={onMoveImage}
              onDeleteImage={onDeleteImage}
              onPreviewImage={onPreviewImage}
              isBusy={isBusy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MediaFileThumbnail({
  file,
  moveTargets,
  onStartNewChatWithImage,
  onRenameImage,
  onMoveImage,
  onDeleteImage,
  onPreviewImage,
  isBusy,
}: {
  file: MediaFile;
  moveTargets: MoveTargetApp[];
  onStartNewChatWithImage: (file: MediaFile) => Promise<void>;
  onRenameImage: (file: MediaFile) => void;
  onMoveImage: (file: MediaFile, targetAppId: number) => Promise<void>;
  onDeleteImage: (file: MediaFile) => void;
  onPreviewImage: (file: MediaFile) => void;
  isBusy: boolean;
}) {
  const dataUri = useMediaDataUri(file.appId, file.fileName);

  return (
    <div
      data-testid="media-thumbnail"
      data-media-file-name={file.fileName}
      className="w-[120px] border rounded-md overflow-hidden bg-secondary/30"
    >
      <div
        className="w-[120px] h-[120px] relative cursor-pointer"
        onClick={() => onPreviewImage(file)}
      >
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            data-testid="media-file-actions-trigger"
            aria-label={`Media actions for ${file.fileName}`}
            className={cn(
              buttonVariants({
                variant: "secondary",
                size: "icon",
              }),
              "absolute right-1 top-1 size-7",
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-52"
            onClick={(event) => event.stopPropagation()}
          >
            <DropdownMenuItem
              data-testid="media-start-chat-with-image"
              onClick={() => {
                void onStartNewChatWithImage(file);
              }}
              disabled={isBusy}
            >
              <MessageSquarePlus className="mr-2 h-4 w-4" />
              Start New Chat With Image
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="media-rename-image"
              onClick={() => onRenameImage(file)}
              disabled={isBusy}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Rename Image
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="media-move-to-submenu">
                <MoveRight className="mr-2 h-4 w-4" />
                Move To
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                {moveTargets.length === 0 ? (
                  <DropdownMenuItem disabled>No other apps</DropdownMenuItem>
                ) : (
                  moveTargets.map((targetApp) => (
                    <DropdownMenuItem
                      key={targetApp.id}
                      data-testid={`media-move-target-${targetApp.id}`}
                      onClick={() => {
                        void onMoveImage(file, targetApp.id).catch(() => {
                          // Error toast is handled in the mutation hook.
                        });
                      }}
                      disabled={isBusy}
                    >
                      {targetApp.name}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              data-testid="media-delete-image"
              variant="destructive"
              onClick={() => onDeleteImage(file)}
              disabled={isBusy}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Image
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {dataUri ? (
          <img
            src={dataUri}
            alt={file.fileName}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Image className="h-6 w-6 animate-pulse" />
          </div>
        )}
      </div>
      <div className="p-1.5">
        <p
          className="text-xs truncate text-muted-foreground"
          title={file.fileName}
        >
          {file.fileName}
        </p>
      </div>
    </div>
  );
}

function ImagePreview({
  appId,
  fileName,
}: {
  appId: number;
  fileName: string;
}) {
  const dataUri = useMediaDataUri(appId, fileName);

  if (!dataUri) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-muted-foreground">
        <Image className="h-10 w-10 animate-pulse" />
      </div>
    );
  }

  return (
    <img
      src={dataUri}
      alt={fileName}
      className="w-full max-h-[80vh] object-contain"
    />
  );
}

function getFileNameWithoutExtension(fileName: string): string {
  const extension = getFileExtension(fileName);
  if (!extension) return fileName;
  return fileName.slice(0, fileName.length - extension.length);
}

function getFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex <= 0) return "";
  return fileName.slice(lastDotIndex);
}
