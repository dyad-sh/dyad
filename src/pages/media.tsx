import { useState } from "react";
import { useAppMediaFiles } from "@/hooks/useAppMediaFiles";
import { useLoadApps } from "@/hooks/useLoadApps";
import { Image, ImagePlus } from "lucide-react";
import { DyadAppMediaFolder } from "@/components/DyadAppMediaFolder";
import { LibrarySearchBar } from "@/components/LibrarySearchBar";
import { Button } from "@/components/ui/button";
import { ImageGeneratorDialog } from "@/components/ImageGeneratorDialog";

export default function MediaPage() {
  const {
    mediaApps,
    isLoading,
    renameMediaFile,
    deleteMediaFile,
    moveMediaFile,
    isMutatingMedia,
  } = useAppMediaFiles();
  const { apps: allApps } = useLoadApps();
  const [searchQuery, setSearchQuery] = useState("");
  const [imageGeneratorOpen, setImageGeneratorOpen] = useState(false);

  const filteredMediaApps = searchQuery.trim()
    ? mediaApps.filter(
        (app) =>
          app.appName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          app.files.some((f) =>
            f.fileName.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
      )
    : mediaApps;

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="flex items-center text-2xl font-bold sm:text-3xl">
            <Image className="mr-2 h-7 w-7 sm:h-8 sm:w-8" />
            Media
          </h1>
          <Button onClick={() => setImageGeneratorOpen(true)}>
            <ImagePlus className="mr-2 h-4 w-4" />
            Generate Image
          </Button>
        </div>

        <LibrarySearchBar value={searchQuery} onChange={setSearchQuery} />

        {isLoading ? (
          <div>Loading...</div>
        ) : filteredMediaApps.length === 0 ? (
          <div className="text-muted-foreground text-center py-12">
            {searchQuery
              ? "No results found."
              : "No media files yet. Media files from your apps will appear here."}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
            {filteredMediaApps.map((app) => (
              <DyadAppMediaFolder
                key={`media-${app.appId}`}
                appId={app.appId}
                appName={app.appName}
                files={app.files}
                allApps={allApps}
                onRenameMediaFile={renameMediaFile}
                onDeleteMediaFile={deleteMediaFile}
                onMoveMediaFile={moveMediaFile}
                isMutatingMedia={isMutatingMedia}
                searchQuery={searchQuery}
              />
            ))}
          </div>
        )}
      </div>

      <ImageGeneratorDialog
        open={imageGeneratorOpen}
        onOpenChange={setImageGeneratorOpen}
      />
    </div>
  );
}
