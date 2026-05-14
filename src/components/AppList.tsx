import { useNavigate } from "@tanstack/react-router";
import { PlusCircle, Search, Star } from "lucide-react";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useOpenApp } from "@/hooks/useOpenApp";
import { useMemo, useState } from "react";
import { AppSearchDialog } from "./AppSearchDialog";
import { AppItem } from "./appItem";
export function AppList({ show }: { show?: boolean }) {
  const navigate = useNavigate();
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const openApp = useOpenApp();
  const { apps, loading, error } = useLoadApps();
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

  const nonFavoriteApps = useMemo(
    () => apps.filter((app) => !app.isFavorite),
    [apps],
  );

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
