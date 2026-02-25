import { useState } from "react";
import { Folder, FolderOpen, ArrowLeft, Image } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useMediaDataUri } from "@/hooks/useMediaDataUri";
import type { MediaFile } from "@/ipc/types";

interface DyadAppMediaFolderProps {
  appName: string;
  appId: number;
  files: MediaFile[];
  searchQuery?: string;
}

export function DyadAppMediaFolder({
  appName,
  appId,
  files,
  searchQuery,
}: DyadAppMediaFolderProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (isOpen) {
    return (
      <MediaFolderOpen
        appName={appName}
        files={files}
        onClose={() => setIsOpen(false)}
        searchQuery={searchQuery}
      />
    );
  }

  return (
    <div
      data-testid={`media-folder-${appId}`}
      className={cn(
        "border rounded-lg p-4 bg-(--background-lightest) relative cursor-pointer",
        "hover:border-primary/30 transition-colors",
      )}
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
  files,
  onClose,
  searchQuery,
}: {
  appName: string;
  files: MediaFile[];
  onClose: () => void;
  searchQuery?: string;
}) {
  const filteredFiles = searchQuery
    ? files.filter((f) =>
        f.fileName.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : files;

  return (
    <div className="border rounded-lg p-4 bg-(--background-lightest) col-span-full">
      <div className="flex items-center gap-2 mb-4">
        <button
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
            <MediaFileThumbnail key={file.fileName} file={file} />
          ))}
        </div>
      )}
    </div>
  );
}

function MediaFileThumbnail({ file }: { file: MediaFile }) {
  const dataUri = useMediaDataUri(file.appId, file.fileName);

  return (
    <div className="w-[120px] border rounded-md overflow-hidden bg-secondary/30">
      <div className="w-[120px] h-[120px]">
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
