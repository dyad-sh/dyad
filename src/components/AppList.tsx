import { useNavigate } from "@tanstack/react-router";
import { Folder, PlusCircle, Search, Star } from "lucide-react";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useOpenApp } from "@/hooks/useOpenApp";
import { useAppCollections } from "@/hooks/useAppCollections";
import { useMemo, useState } from "react";
import { AppSearchDialog } from "./AppSearchDialog";
import { AppItem } from "./appItem";
export function AppList({ show }: { show?: boolean }) {
  const navigate = useNavigate();
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const openApp = useOpenApp();
  const { apps, loading, error } = useLoadApps();
  const { collections } = useAppCollections();
  // search dialog state
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);

  const allApps = useMemo(
    () =>
      apps.map((a) => ({
        id: a.id,
        name: a.name,
        createdAt: a.createdAt,
        matchedChatTitle: null,
        matchedChatMessage: null,
      })),
    [apps],
  );

  const favoriteApps = useMemo(
    () => apps.filter((app) => app.isFavorite),
    [apps],
  );

  const visibleCollectionIds = useMemo(
    () => new Set(collections.map((c) => c.id)),
    [collections],
  );

  const nonFavoriteApps = useMemo(
    () =>
      apps.filter(
        (app) =>
          !app.isFavorite &&
          (app.collectionId == null ||
            !visibleCollectionIds.has(app.collectionId)),
      ),
    [apps, visibleCollectionIds],
  );

  const collectionMembers = useMemo(() => {
    const byId = new Map<number, typeof apps>();
    for (const app of apps) {
      if (app.collectionId == null) continue;
      if (!visibleCollectionIds.has(app.collectionId)) continue;
      const list = byId.get(app.collectionId) ?? [];
      list.push(app);
      byId.set(app.collectionId, list);
    }
    return byId;
  }, [apps, visibleCollectionIds]);

  if (!show) {
    return null;
  }

  const handleAppClick = (id: number) => {
    setIsSearchDialogOpen(false);
    openApp(id);
  };

  const handleNewApp = () => {
    navigate({ to: "/" });
    // We'll eventually need a create app workflow
  };

  return (
    <>
      <SidebarGroup
        className="overflow-y-auto h-[calc(100vh-112px)]"
        data-testid="app-list-container"
      >
        <SidebarGroupContent>
          <div className="flex flex-col space-y-3">
            <div className="mx-2 flex items-center gap-2">
              <Button
                onClick={handleNewApp}
                variant="outline"
                className="flex flex-1 items-center justify-start gap-2 py-3"
              >
                <PlusCircle size={16} />
                <span>New App</span>
              </Button>
              <Button
                onClick={() => setIsSearchDialogOpen(!isSearchDialogOpen)}
                variant="outline"
                className="flex shrink-0 items-center justify-center py-3 px-3"
                title="Search Apps"
                aria-label="Search Apps"
                data-testid="search-apps-button"
              >
                <Search size={16} />
              </Button>
            </div>

            {loading ? (
              <div className="py-2 px-4 text-sm text-gray-500">
                Loading apps...
              </div>
            ) : error ? (
              <div className="py-2 px-4 text-sm text-red-500">
                Error loading apps
              </div>
            ) : apps.length === 0 ? (
              <div className="py-2 px-4 text-sm text-gray-500">
                No apps found
              </div>
            ) : (
              <SidebarMenu className="space-y-1" data-testid="app-list">
                <div className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                  Favorite apps
                </div>
                {favoriteApps.length === 0 ? (
                  <div className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-dashed border-sidebar-border px-3 py-3 text-xs text-muted-foreground">
                    <Star size={14} className="shrink-0" />
                    <span>Star an app to pin it here</span>
                  </div>
                ) : (
                  favoriteApps.map((app) => (
                    <AppItem
                      key={app.id}
                      app={app}
                      handleAppClick={handleAppClick}
                      selectedAppId={selectedAppId}
                    />
                  ))
                )}
                {collections.length > 0 && (
                  <div
                    data-testid="sidebar-collections-section"
                    className="mt-2"
                  >
                    <div className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                      Collections
                    </div>
                    <Accordion multiple className="px-1">
                      {collections.map((collection) => {
                        const members =
                          collectionMembers.get(collection.id) ?? [];
                        return (
                          <AccordionItem
                            key={collection.id}
                            value={`collection-${collection.id}`}
                            className="border-b-0"
                            data-testid={`sidebar-collection-${collection.id}`}
                          >
                            <AccordionTrigger className="py-2 px-2 hover:no-underline hover:bg-sidebar-accent/60 rounded-md">
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <Folder
                                  size={14}
                                  className="shrink-0 text-muted-foreground"
                                />
                                <span className="truncate text-sm">
                                  {collection.name}
                                </span>
                                <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                                  {members.length}
                                </span>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="pb-1 pl-3">
                              {members.length === 0 ? (
                                <div className="px-3 py-2 text-xs text-muted-foreground italic">
                                  Empty
                                </div>
                              ) : (
                                members.map((app) => (
                                  <AppItem
                                    key={app.id}
                                    app={app}
                                    handleAppClick={handleAppClick}
                                    selectedAppId={selectedAppId}
                                  />
                                ))
                              )}
                            </AccordionContent>
                          </AccordionItem>
                        );
                      })}
                    </Accordion>
                  </div>
                )}
                <div className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                  Other apps
                </div>
                {nonFavoriteApps.map((app) => (
                  <AppItem
                    key={app.id}
                    app={app}
                    handleAppClick={handleAppClick}
                    selectedAppId={selectedAppId}
                  />
                ))}
              </SidebarMenu>
            )}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
      <AppSearchDialog
        open={isSearchDialogOpen}
        onOpenChange={setIsSearchDialogOpen}
        onSelectApp={handleAppClick}
        allApps={allApps}
      />
    </>
  );
}
