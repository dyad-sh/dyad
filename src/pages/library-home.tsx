import { useState, useMemo } from "react";
import { usePrompts } from "@/hooks/usePrompts";
import { useCustomThemes } from "@/hooks/useCustomThemes";
import { useAppMediaFiles } from "@/hooks/useAppMediaFiles";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useAddPromptDeepLink } from "@/hooks/useAddPromptDeepLink";
import { BookOpen, Loader2 } from "lucide-react";
import { CreateOrEditPromptDialog } from "@/components/CreatePromptDialog";
import { CustomThemeDialog } from "@/components/CustomThemeDialog";
import { NewLibraryItemMenu } from "@/components/NewLibraryItemMenu";
import { LibraryCard, type LibraryItem } from "@/components/LibraryCard";
import { LibrarySearchBar } from "@/components/LibrarySearchBar";
import {
  LibraryFilterTabs,
  type FilterType,
} from "@/components/LibraryFilterTabs";
import { DyadAppMediaFolder } from "@/components/DyadAppMediaFolder";
import { ImageGeneratorDialog } from "@/components/ImageGeneratorDialog";
import { ImageGenerationProgressButton } from "@/components/ImageGenerationProgressButton";
import { filterMediaAppsByQuery } from "@/lib/mediaUtils";
// ---------------------------------------------------------------------------
// Main Library Homepage
// ---------------------------------------------------------------------------

export default function LibraryHomePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>(() => {
    const params = new URLSearchParams(window.location.search);
    const filter = params.get("filter");
    if (filter === "themes" || filter === "prompts" || filter === "media")
      return filter;
    return "all";
  });

  const {
    prompts,
    isLoading: promptsLoading,
    createPrompt,
    updatePrompt,
    deletePrompt,
  } = usePrompts();
  const { customThemes, isLoading: themesLoading } = useCustomThemes();
  const {
    mediaApps,
    isLoading: mediaLoading,
    renameMediaFile,
    deleteMediaFile,
    moveMediaFile,
    isMutatingMedia,
  } = useAppMediaFiles();
  const { apps: allApps } = useLoadApps();
  const [createThemeDialogOpen, setCreateThemeDialogOpen] = useState(false);
  const [imageGeneratorOpen, setImageGeneratorOpen] = useState(false);

  // Deep link support
  const {
    prefillData,
    dialogOpen: promptDialogOpen,
    handleDialogClose: handlePromptDialogClose,
    setDialogOpen: setPromptDialogOpen,
  } = useAddPromptDeepLink();

  const isLoading = promptsLoading || themesLoading || mediaLoading;

  const filteredItems = useMemo(() => {
    if (activeFilter === "media") return [];

    let items: LibraryItem[] = [];

    if (activeFilter === "all" || activeFilter === "themes") {
      items.push(
        ...customThemes.map((t) => ({ type: "theme" as const, data: t })),
      );
    }
    if (activeFilter === "all" || activeFilter === "prompts") {
      items.push(...prompts.map((p) => ({ type: "prompt" as const, data: p })));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((item) => {
        if (item.type === "theme") {
          return (
            item.data.name.toLowerCase().includes(q) ||
            (item.data.description?.toLowerCase().includes(q) ?? false) ||
            item.data.prompt.toLowerCase().includes(q)
          );
        }
        return (
          item.data.title.toLowerCase().includes(q) ||
          (item.data.description?.toLowerCase().includes(q) ?? false) ||
          item.data.content.toLowerCase().includes(q)
        );
      });
    }

    // Sort by updatedAt descending
    items.sort((a, b) => {
      const dateA =
        a.data.updatedAt instanceof Date
          ? a.data.updatedAt
          : new Date(a.data.updatedAt);
      const dateB =
        b.data.updatedAt instanceof Date
          ? b.data.updatedAt
          : new Date(b.data.updatedAt);
      return dateB.getTime() - dateA.getTime();
    });

    return items;
  }, [customThemes, prompts, activeFilter, searchQuery]);

  const filteredMediaApps = useMemo(() => {
    if (activeFilter === "themes" || activeFilter === "prompts") return [];

    return filterMediaAppsByQuery(mediaApps, searchQuery);
  }, [mediaApps, activeFilter, searchQuery]);

  const hasNoResults =
    filteredItems.length === 0 && filteredMediaApps.length === 0;

  return (
    <div className="min-h-screen w-full">
      <div className="px-8 py-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold">
              <BookOpen className="inline-block h-8 w-8 mr-2" />
              Library
            </h1>
            <div className="flex items-center gap-2">
              <ImageGenerationProgressButton />
              <NewLibraryItemMenu
                onNewPrompt={() => setPromptDialogOpen(true)}
                onNewTheme={() => setCreateThemeDialogOpen(true)}
                onNewImage={() => setImageGeneratorOpen(true)}
              />
            </div>
          </div>

          {/* Dialogs (controlled externally) */}
          <CreateOrEditPromptDialog
            mode="create"
            onCreatePrompt={createPrompt}
            prefillData={prefillData}
            isOpen={promptDialogOpen}
            onOpenChange={handlePromptDialogClose}
            trigger={<span />}
          />

          {/* Search Bar */}
          <LibrarySearchBar value={searchQuery} onChange={setSearchQuery} />

          {/* Filter Tabs */}
          <LibraryFilterTabs active={activeFilter} onChange={setActiveFilter} />

          {/* Grid */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : hasNoResults ? (
            <div className="text-muted-foreground text-center py-12">
              {searchQuery
                ? "No results found."
                : activeFilter === "media"
                  ? "No media files yet."
                  : activeFilter === "themes"
                    ? "No themes yet."
                    : activeFilter === "prompts"
                      ? "No prompts yet."
                      : "No items in your library yet."}
            </div>
          ) : (
            <div
              data-testid="library-grid"
              className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4"
            >
              {filteredItems.map((item) => (
                <LibraryCard
                  key={`${item.type}-${item.data.id}`}
                  item={item}
                  onUpdatePrompt={updatePrompt}
                  onDeletePrompt={deletePrompt}
                />
              ))}
              {filteredMediaApps.map((app) => (
                <DyadAppMediaFolder
                  key={`media-${app.appId}`}
                  appId={app.appId}
                  appPath={app.appPath}
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

        <CustomThemeDialog
          open={createThemeDialogOpen}
          onOpenChange={setCreateThemeDialogOpen}
        />

        <ImageGeneratorDialog
          open={imageGeneratorOpen}
          onOpenChange={setImageGeneratorOpen}
        />
      </div>
    </div>
  );
}
