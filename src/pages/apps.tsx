import { useMemo, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, CheckSquare, Loader2, Search, Trash2 } from "lucide-react";
import { useAtom } from "jotai";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useOpenApp } from "@/hooks/useOpenApp";
import { AppShowcaseCard } from "@/components/AppShowcaseCard";
import { useAppThumbnails } from "@/hooks/useAppThumbnails";
import { sortAppsForShowcase } from "@/lib/sortApps";
import { ipc } from "@/ipc/types";
import { selectedAppIdAtom, currentAppAtom } from "@/atoms/appAtoms";
import { showError } from "@/lib/toast";

export default function AppsPage() {
  const router = useRouter();
  const navigate = useNavigate();
  const { apps, loading, refreshApps } = useLoadApps();
  const openApp = useOpenApp();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedAppIds, setSelectedAppIds] = useState<Set<number>>(new Set());
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedAppId, setSelectedAppId] = useAtom(selectedAppIdAtom);
  const [currentApp, setCurrentApp] = useAtom(currentAppAtom);

  const filteredApps = useMemo(() => {
    const sorted = sortAppsForShowcase(apps);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((app) => app.name.toLowerCase().includes(q));
  }, [apps, searchQuery]);

  // Fetch thumbnails for ALL apps once and filter client-side so typing in
  // the search box doesn't trigger a burst of IPC + filesystem reads. This
  // also lets the underlying query cache be shared with the featured
  // showcase on the home page.
  const allAppIds = useMemo(() => apps.map((a) => a.id), [apps]);
  const thumbnailByAppId = useAppThumbnails(allAppIds);

  const selectedApps = useMemo(
    () => apps.filter((a) => selectedAppIds.has(a.id)),
    [apps, selectedAppIds],
  );
  const visibleFilteredIds = useMemo(
    () => filteredApps.map((a) => a.id),
    [filteredApps],
  );
  const allVisibleSelected =
    visibleFilteredIds.length > 0 &&
    visibleFilteredIds.every((id) => selectedAppIds.has(id));

  const handleGoBack = () => {
    if (router.history.length > 1) {
      router.history.back();
    } else {
      navigate({ to: "/" });
    }
  };

  const handleEnterSelectionMode = () => {
    setIsSelectionMode(true);
  };

  const handleExitSelectionMode = () => {
    setIsSelectionMode(false);
    setSelectedAppIds(new Set());
  };

  const handleToggleSelect = (appId: number) => {
    setSelectedAppIds((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) {
        next.delete(appId);
      } else {
        next.add(appId);
      }
      return next;
    });
  };

  const handleToggleSelectAllVisible = () => {
    setSelectedAppIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleFilteredIds) next.delete(id);
      } else {
        for (const id of visibleFilteredIds) next.add(id);
      }
      return next;
    });
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedAppIds.size === 0) return;
    const idsToDelete = [...selectedAppIds];
    setIsDeleting(true);
    try {
      const { results } = await ipc.app.deleteApps({ appIds: idsToDelete });

      const failed = results.filter((r) => !r.success);
      const succeededIds = new Set(
        results.filter((r) => r.success).map((r) => r.appId),
      );

      // Reset the active app atoms if the currently-active app was deleted,
      // so app-details and the sidebar don't render against a stale id.
      if (selectedAppId != null && succeededIds.has(selectedAppId)) {
        setSelectedAppId(null);
      }
      if (currentApp && succeededIds.has(currentApp.id)) {
        setCurrentApp(null);
      }

      if (failed.length > 0) {
        const failedNames = failed
          .map((r) => apps.find((a) => a.id === r.appId)?.name ?? `#${r.appId}`)
          .join(", ");
        showError(
          `Failed to delete ${failed.length} app${failed.length === 1 ? "" : "s"}: ${failedNames}`,
        );
        // Keep only the failed ids selected so the user can retry.
        setSelectedAppIds(new Set(failed.map((r) => r.appId)));
        setIsBulkDeleteDialogOpen(false);
      } else {
        setSelectedAppIds(new Set());
        setIsBulkDeleteDialogOpen(false);
        setIsSelectionMode(false);
      }
      await refreshApps();
    } catch (error) {
      showError(error);
      setIsBulkDeleteDialogOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen w-full px-8 py-4">
      <div className="max-w-6xl mx-auto pb-12">
        <Button
          onClick={handleGoBack}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 mb-4 bg-(--background-lightest) py-5"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>

        <header className="mb-6 flex items-end justify-between gap-3">
          <h1 className="text-3xl font-bold">Apps</h1>
          {!isSelectionMode && apps.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleEnterSelectionMode}
              data-testid="apps-gallery-select-button"
              className="flex items-center gap-2"
            >
              <CheckSquare className="h-4 w-4" />
              Select
            </Button>
          )}
        </header>

        <div className="mb-4">
          <div
            className={cn(
              "relative flex items-center border border-border rounded-2xl bg-(--background-lighter) transition-colors duration-200",
              "hover:border-primary/30",
              "focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/20",
            )}
          >
            <Search className="absolute left-4 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search apps..."
              aria-label="Search apps"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent py-3 pl-11 pr-4 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {isSelectionMode && (
          <div
            data-testid="apps-gallery-selection-toolbar"
            className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-border bg-(--background-lighter) px-3 py-2"
          >
            <div className="text-sm text-muted-foreground">
              <span data-testid="apps-gallery-selection-count">
                {selectedAppIds.size}
              </span>{" "}
              selected
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleSelectAllVisible}
                disabled={visibleFilteredIds.length === 0}
                data-testid="apps-gallery-select-all-button"
              >
                {allVisibleSelected ? "Clear visible" : "Select all visible"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExitSelectionMode}
                data-testid="apps-gallery-cancel-select-button"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setIsBulkDeleteDialogOpen(true)}
                disabled={selectedAppIds.size === 0}
                data-testid="apps-gallery-bulk-delete-button"
                className="flex items-center gap-1"
              >
                <Trash2 className="h-4 w-4" />
                Delete ({selectedAppIds.size})
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-muted-foreground text-center py-12">
            Loading apps...
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-muted-foreground text-center">
              {searchQuery
                ? "No apps match your search."
                : "You haven't created any apps yet."}
            </p>
            {!searchQuery && (
              <Button onClick={() => navigate({ to: "/" })} size="sm">
                Create your first app
              </Button>
            )}
          </div>
        ) : (
          <div
            data-testid="apps-grid"
            className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4"
          >
            {filteredApps.map((app) => (
              <AppShowcaseCard
                key={app.id}
                app={app}
                thumbnailUrl={thumbnailByAppId.get(app.id) ?? null}
                onClick={openApp}
                isSelectionMode={isSelectionMode}
                isSelected={selectedAppIds.has(app.id)}
                onToggleSelect={handleToggleSelect}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={isBulkDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!isDeleting) setIsBulkDeleteDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-sm p-4">
          <DialogHeader className="pb-2">
            <DialogTitle>
              Delete {selectedAppIds.size} app
              {selectedAppIds.size === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription className="text-xs">
              This action is irreversible. All app files and chat history for
              these apps will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          {selectedApps.length > 0 && (
            <ul
              data-testid="apps-gallery-bulk-delete-list"
              className="max-h-40 overflow-y-auto rounded border border-border bg-(--background-lighter) px-3 py-2 text-xs text-foreground"
            >
              {selectedApps.map((app) => (
                <li key={app.id} className="truncate py-0.5">
                  {app.name}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setIsBulkDeleteDialogOpen(false)}
              disabled={isDeleting}
              size="sm"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmBulkDelete}
              disabled={isDeleting || selectedAppIds.size === 0}
              size="sm"
              className="flex items-center gap-1"
              data-testid="apps-gallery-bulk-delete-confirm-button"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  Delete {selectedAppIds.size} app
                  {selectedAppIds.size === 1 ? "" : "s"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
