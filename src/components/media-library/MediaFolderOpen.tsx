import { ArrowLeft, FolderOpen } from "lucide-react";
import type { MediaFile } from "@/ipc/types";
import { MediaFileThumbnail } from "./MediaFileThumbnail";

export function MediaFolderOpen({
  appName,
  appId,
  appPath,
  files,
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
  appPath: string;
  files: MediaFile[];
  onClose: () => void;
  onStartNewChatWithImage: (file: MediaFile) => Promise<void>;
  onRenameImage: (file: MediaFile) => void;
  onMoveImage: (file: MediaFile) => void;
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
      className="border rounded-lg p-4 bg-[--background-lightest] col-span-full"
    >
      <div className="flex items-center gap-2 mb-4">
        <button
          data-testid="media-folder-back-button"
          aria-label="Back to folders"
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
          {searchQuery
            ? "No files match your search."
            : "No media files found."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {filteredFiles.map((file) => (
            <MediaFileThumbnail
              key={file.fileName}
              file={file}
              appPath={appPath}
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
