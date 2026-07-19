import { useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, FolderOpen } from "lucide-react";
import type { MediaFile } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import { MediaFileThumbnail } from "./MediaFileThumbnail";
import { useTranslation } from "react-i18next";

export const MEDIA_LIBRARY_PAGE_SIZE = 48;

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
  const { t } = useTranslation("home");
  const [currentPage, setCurrentPage] = useState(1);
  const filteredFiles = searchQuery
    ? files.filter((f) =>
        f.fileName.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : files;
  const totalPages = Math.max(
    1,
    Math.ceil(filteredFiles.length / MEDIA_LIBRARY_PAGE_SIZE),
  );
  const visiblePage = Math.min(currentPage, totalPages);
  const pageStart = (visiblePage - 1) * MEDIA_LIBRARY_PAGE_SIZE;
  const visibleFiles = filteredFiles.slice(
    pageStart,
    pageStart + MEDIA_LIBRARY_PAGE_SIZE,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  return (
    <div
      data-testid={`media-folder-open-${appId}`}
      className="border rounded-lg p-4 bg-[--background-lightest] col-span-full"
    >
      <div className="flex items-center gap-2 mb-4">
        <button
          data-testid="media-folder-back-button"
          aria-label={t("media.backToFolders")}
          onClick={onClose}
          className="p-1 rounded-md hover:bg-secondary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <FolderOpen className="h-5 w-5 text-amber-500" />
        <h3 className="text-lg font-semibold">{appName}</h3>
        <span className="text-sm text-muted-foreground">
          ({t("media.fileCount", { count: filteredFiles.length })})
        </span>
      </div>
      {filteredFiles.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          {searchQuery ? t("media.noSearchResults") : t("media.noFilesFound")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            {visibleFiles.map((file) => (
              <MediaFileThumbnail
                key={`${file.fileName}:${file.modifiedAtMs}:${file.sizeBytes}`}
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
          {totalPages > 1 && (
            <div
              className="mt-4 flex items-center justify-between gap-3 border-t pt-3"
              data-testid="media-pagination"
            >
              <span className="text-sm text-muted-foreground">
                {t("media.showing")} {pageStart + 1}–
                {Math.min(
                  pageStart + MEDIA_LIBRARY_PAGE_SIZE,
                  filteredFiles.length,
                )}{" "}
                {t("media.of")} {filteredFiles.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t("media.previousPage")}
                  onClick={() =>
                    setCurrentPage((page) => Math.max(1, page - 1))
                  }
                  disabled={visiblePage === 1}
                >
                  <ChevronLeft className="size-4" />
                  {t("media.previous")}
                </Button>
                <span className="min-w-20 text-center text-sm text-muted-foreground">
                  {t("media.pageOf", {
                    page: visiblePage,
                    total: totalPages,
                  })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t("media.nextPage")}
                  onClick={() =>
                    setCurrentPage((page) => Math.min(totalPages, page + 1))
                  }
                  disabled={visiblePage === totalPages}
                >
                  {t("media.next")}
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
