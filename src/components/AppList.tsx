import { useNavigate } from "@tanstack/react-router";
import { ListChecks, ListX, PlusCircle, Search } from "lucide-react";
import { useAtom, useSetAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useMemo, useState } from "react";
import { AppSearchDialog } from "./AppSearchDialog";
import { useAddAppToFavorite } from "@/hooks/useAddAppToFavorite";
import { AppItem } from "./appItem";
import { IpcClient } from "@/ipc/ipc_client";
import { showError, showSuccess } from "@/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
export function AppList({ show }: { show?: boolean }) {
  const navigate = useNavigate();
  const [selectedAppId, setSelectedAppId] = useAtom(selectedAppIdAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const { apps, loading, error } = useLoadApps();
  const { toggleFavorite, isLoading: isFavoriteLoading } =
    useAddAppToFavorite();
  // search dialog state
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);
  // bulk mode state
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBulkConfirmDialogOpen, setIsBulkConfirmDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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
    // toggle selected ids in bulk mode
    if (bulkMode) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    // non-bulk: navigate to app details
    setSelectedAppId(id);
    setSelectedChatId(null);
    setIsSearchDialogOpen(false);
    navigate({ to: "/", search: { appId: id } });
  };

  const handleNewApp = () => {
    navigate({ to: "/" });
    // We'll eventually need a create app workflow
  };

  const handleToggleFavorite = (appId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(appId);
  };

  return (
    <>
      <SidebarGroup
        className="overflow-y-auto h-[calc(100vh-112px)]"
        data-testid="app-list-container"
      >
        <SidebarGroupLabel>Your Apps</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex flex-col space-y-2">
            <Button
              onClick={handleNewApp}
              variant="outline"
              className="flex items-center justify-start gap-2 mx-2 py-2"
            >
              <PlusCircle size={16} />
              <span>New App</span>
            </Button>
            <Button
              onClick={() => setIsSearchDialogOpen(!isSearchDialogOpen)}
              variant="outline"
              className="flex items-center justify-start gap-2 mx-2 py-3"
              data-testid="search-apps-button"
            >
              <Search size={16} />
              <span>Search Apps</span>
            </Button>
            <Button
              onClick={() => {
                // toggle bulk mode, clear selected ids
                setBulkMode((v) => !v);
                setSelectedIds(new Set());
              }}
              variant="outline"
              className="flex items-center justify-start gap-2 mx-2 py-2"
            >
              {bulkMode ? <ListX /> : <ListChecks />}
              <span>{bulkMode ? "Exit Bulk Mode" : "Bulk Mode"}</span>
            </Button>

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
                <SidebarGroupLabel>Favorite apps</SidebarGroupLabel>
                {favoriteApps.map((app) => (
                  <AppItem
                    key={app.id}
                    app={app}
                    handleAppClick={handleAppClick}
                    selectedAppId={selectedAppId}
                    handleToggleFavorite={handleToggleFavorite}
                    isFavoriteLoading={isFavoriteLoading}
                    bulkMode={bulkMode}
                    checked={selectedIds.has(app.id)}
                    onToggleSelect={() => handleAppClick(app.id)}
                  />
                ))}
                <SidebarGroupLabel>Other apps</SidebarGroupLabel>
                {nonFavoriteApps.map((app) => (
                  <AppItem
                    key={app.id}
                    app={app}
                    handleAppClick={handleAppClick}
                    selectedAppId={selectedAppId}
                    handleToggleFavorite={handleToggleFavorite}
                    isFavoriteLoading={isFavoriteLoading}
                    bulkMode={bulkMode}
                    checked={selectedIds.has(app.id)}
                    onToggleSelect={() => handleAppClick(app.id)}
                  />
                ))}
              </SidebarMenu>
            )}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
      {bulkMode && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-0 right-0 flex justify-end px-4 z-50 pointer-events-auto">
          <Button
            variant="destructive"
            onClick={() => {
              setIsBulkConfirmDialogOpen(true);
            }}
          >{`Bulk Delete(${selectedIds.size})`}</Button>
        </div>
      )}
      <Dialog
        open={isBulkConfirmDialogOpen}
        onOpenChange={setIsBulkConfirmDialogOpen}
      >
        <DialogContent className="max-w-sm p-4">
          <DialogHeader className="pb-2">
            <DialogTitle>{`Delete ${selectedIds.size} apps?`}</DialogTitle>
            <DialogDescription className="text-xs">
              This action is irreversible. All app files and chat history will
              be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setIsBulkConfirmDialogOpen(false)}
              disabled={isDeleting}
              size="sm"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setIsDeleting(true);
                try {
                  const ipc = IpcClient.getInstance();
                  const ids = Array.from(selectedIds);
                  const results = await Promise.allSettled(
                    ids.map((id) => ipc.deleteApp(id)),
                  );
                  const failedIds = results.flatMap((r, i) =>
                    r.status === "rejected" ? [ids[i]] : [],
                  );
                  if (failedIds.length > 0) {
                    showError(
                      `Failed to delete ${failedIds.length} of ${ids.length} app(s).`,
                    );
                    setSelectedIds(new Set(failedIds));
                  } else {
                    setSelectedIds(new Set());
                    showSuccess(`Deleted ${ids.length} app(s).`);
                  }
                  setIsBulkConfirmDialogOpen(false);
                } catch (e) {
                  showError(e);
                } finally {
                  setIsDeleting(false);
                }
              }}
              disabled={isDeleting}
              className="flex items-center gap-1"
              size="sm"
            >
              {isDeleting ? (
                <>
                  <svg
                    className="animate-spin h-3 w-3 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Deleting...
                </>
              ) : (
                "Delete Apps"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AppSearchDialog
        open={isSearchDialogOpen}
        onOpenChange={setIsSearchDialogOpen}
        onSelectApp={handleAppClick}
        allApps={allApps}
      />
    </>
  );
}
