import { useState } from "react";
import {
  Image,
  MoreVertical,
  MessageSquarePlus,
  Pencil,
  Trash2,
  MoveRight,
  Expand,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buildDyadMediaUrl } from "@/lib/dyadMediaUrl";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MediaFile } from "@/ipc/types";

export function MediaFileThumbnail({
  file,
  appPath,
  onStartNewChatWithImage,
  onRenameImage,
  onMoveImage,
  onDeleteImage,
  onPreviewImage,
  isBusy,
}: {
  file: MediaFile;
  appPath: string;
  onStartNewChatWithImage: (file: MediaFile) => Promise<void>;
  onRenameImage: (file: MediaFile) => void;
  onMoveImage: (file: MediaFile) => void;
  onDeleteImage: (file: MediaFile) => void;
  onPreviewImage: (file: MediaFile) => void;
  isBusy: boolean;
}) {
  const mediaUrl = buildDyadMediaUrl(appPath, file.fileName);
  const [imgError, setImgError] = useState(false);

  return (
    <div
      data-testid="media-thumbnail"
      data-media-file-name={file.fileName}
      className="w-[120px] border rounded-md overflow-hidden bg-secondary/30"
    >
      <div
        role="button"
        tabIndex={0}
        className="group w-[120px] h-[120px] relative cursor-pointer"
        onClick={() => onPreviewImage(file)}
        onKeyDown={(e) => {
          if (
            e.target === e.currentTarget &&
            (e.key === "Enter" || e.key === " ")
          ) {
            e.preventDefault();
            onPreviewImage(file);
          }
        }}
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
            <DropdownMenuItem
              data-testid="media-move-to-submenu"
              onClick={() => onMoveImage(file)}
              disabled={isBusy}
            >
              <MoveRight className="mr-2 h-4 w-4" />
              Move To
            </DropdownMenuItem>
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

        {imgError ? (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Image className="h-6 w-6" />
          </div>
        ) : (
          <>
            <img
              src={mediaUrl}
              alt={file.fileName}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center pointer-events-none">
              <Expand className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
            </div>
          </>
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
