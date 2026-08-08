import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CheckSquare,
  Cloud,
  LayoutGrid,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
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
import { RestoreFromCloudDialog } from "@/components/RestoreFromCloudDialog";
import { ParticleBackground } from "@/components/home/ParticleBackground";
import { useAppThumbnails } from "@/hooks/useAppThumbnails";
import { sortAppsForShowcase } from "@/lib/sortApps";
import { ipc } from "@/ipc/types";
import { selectedAppIdAtom, currentAppAtom } from "@/atoms/appAtoms";
import { showError } from "@/lib/toast";

const RECENT_HIGHLIGHT_COUNT = 6;

export default function AppsPage() {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const { apps, loading, refreshApps } = useLoadApps();
  const openApp = useOpenApp();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedAppIds, setSelectedAppIds] = useState<Set<number>>(new Set());
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRestoreOpen, setIsRestoreOpen] = useState(false);
  const [selectedAppId, setSelectedAppId] = useAtom(selectedAppIdAtom);
  const [currentApp, setCurrentApp] = useAtom(currentAppAtom);

  const sortedApps = useMemo(() => sortAppsForShowcase(apps), [apps]);

  const filteredApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedApps;
    return sortedApps.filter((app) => app.name.toLowerCase().includes(q));
  }, [sortedApps, searchQuery]);

  const recentHighlights = useMemo(
    () => sortedApps.slice(0, RECENT_HIGHLIGHT_COUNT),
    [sortedApps],
  );

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

  const showRecentRow =
    !searchQuery.trim() && recentHighlights.length > 0 && !isSelectionMode;

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
    <div
      className="home-jarvis relative flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="my-apps-gallery"
    >
      <ParticleBackground className="z-0" />

      <div
        className="relative z-10 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
        data-reset-scroll-on-route
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-6 sm:px-10 sm:py-8">
          <header className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-cyan-400/80">
                <LayoutGrid className="size-4" />
                <span className="font-jarvis-ui text-xs tracking-[0.2em] uppercase">
                  {t("myAppsGallery.eyebrow")}
                </span>
              </div>
              <h1 className="font-jarvis-display text-3xl font-semibold tracking-wide text-[#e8f8fa] sm:text-4xl">
                {t("myAppsGallery.title")}
              </h1>
              <p className="max-w-lg text-sm text-cyan-100/50">
                {t("myAppsGallery.subtitle")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ to: "/coder/studio" })}
                className="border-cyan-500/20 bg-cyan-500/5 text-cyan-100/90 hover:bg-cyan-500/10"
              >
                <Plus className="mr-1.5 size-4" />
                {t("myAppsGallery.newProject")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsRestoreOpen(true)}
                className="border-cyan-500/20 bg-cyan-500/5 text-cyan-100/90 hover:bg-cyan-500/10"
                data-testid="restore-from-cloud-button"
              >
                <Cloud className="mr-1.5 size-4" />
                Restore from cloud
              </Button>
              {!isSelectionMode && apps.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEnterSelectionMode}
                  data-testid="apps-gallery-select-button"
                  className="border-white/10 bg-white/5"
                >
                  <CheckSquare className="mr-1.5 size-4" />
                  {t("myAppsGallery.select")}
                </Button>
              )}
            </div>
          </header>

          <div className="mb-6">
            <div
              className={cn(
                "relative flex items-center rounded-2xl border border-cyan-500/15 bg-[#0a0a12]/60 backdrop-blur-md",
                "transition-colors duration-200",
                "hover:border-cyan-500/25",
                "focus-within:border-cyan-400/40 focus-within:ring-1 focus-within:ring-cyan-400/20",
              )}
            >
              <Search className="absolute left-4 size-4 text-cyan-400/50" />
              <input
                type="text"
                placeholder={t("myAppsGallery.searchPlaceholder")}
                aria-label={t("myAppsGallery.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent py-3.5 pl-11 pr-4 text-sm text-[#e8f8fa] outline-none placeholder:text-cyan-100/30"
              />
            </div>
          </div>

          {isSelectionMode && (
            <div
              data-testid="apps-gallery-selection-toolbar"
              className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-500/15 bg-[#0a0a12]/70 px-3 py-2.5 backdrop-blur-md"
            >
              <div className="text-sm text-cyan-100/60">
                <span data-testid="apps-gallery-selection-count">
                  {selectedAppIds.size}
                </span>{" "}
                {t("myAppsGallery.selected")}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleSelectAllVisible}
                  disabled={visibleFilteredIds.length === 0}
                  data-testid="apps-gallery-select-all-button"
                  className="border-white/10 bg-white/5"
                >
                  {allVisibleSelected
                    ? t("myAppsGallery.clearVisible")
                    : t("myAppsGallery.selectAllVisible")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExitSelectionMode}
                  data-testid="apps-gallery-cancel-select-button"
                  className="border-white/10 bg-white/5"
                >
                  {t("myAppsGallery.cancel")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setIsBulkDeleteDialogOpen(true)}
                  disabled={selectedAppIds.size === 0}
                  data-testid="apps-gallery-bulk-delete-button"
                  className="flex items-center gap-1"
                >
                  <Trash2 className="size-4" />
                  {t("myAppsGallery.deleteCount", {
                    count: selectedAppIds.size,
                  })}
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-cyan-100/50">
              <Loader2 className="size-8 animate-spin text-cyan-400/60" />
              <p>{t("myAppsGallery.loading")}</p>
            </div>
          ) : filteredApps.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-cyan-500/20 bg-[#0a0a12]/50 py-20 px-6 text-center backdrop-blur-sm">
              <Sparkles className="size-10 text-cyan-400/40" />
              <p className="max-w-sm text-cyan-100/55">
                {searchQuery
                  ? t("myAppsGallery.noSearchResults")
                  : t("myAppsGallery.empty")}
              </p>
              {!searchQuery && (
                <Button
                  onClick={() => navigate({ to: "/coder/studio" })}
                  size="sm"
                  className="bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30"
                >
                  {t("myAppsGallery.createFirst")}
                </Button>
              )}
            </div>
          ) : (
            <>
              {showRecentRow && (
                <section className="mb-10" data-testid="featured-app-showcase">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="font-jarvis-ui text-sm font-medium tracking-widest text-cyan-300/70 uppercase">
                      {t("myAppsGallery.recent")}
                    </h2>
                    <span className="text-xs text-cyan-100/40">
                      {t("myAppsGallery.appCount", { count: apps.length })}
                    </span>
                  </div>
                  <div className="relative">
                    <div
                      tabIndex={0}
                      role="region"
                      aria-label={t("myAppsGallery.recent")}
                      className="apps-gallery-recent-scroll flex gap-4 overflow-x-auto pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 rounded-xl"
                    >
                      {recentHighlights.map((app) => (
                        <div key={app.id} className="w-64 shrink-0 sm:w-72">
                          <AppShowcaseCard
                            app={app}
                            thumbnailUrl={thumbnailByAppId.get(app.id) ?? null}
                            onClick={openApp}
                          />
                        </div>
                      ))}
                    </div>
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[#0a0a0f] to-transparent"
                    />
                  </div>
                </section>
              )}

              <section>
                <h2 className="mb-4 font-jarvis-ui text-sm font-medium tracking-widest text-cyan-300/70 uppercase">
                  {searchQuery
                    ? t("myAppsGallery.searchResults")
                    : t("myAppsGallery.allProjects")}
                </h2>
                <div
                  data-testid="apps-grid"
                  className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5"
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
              </section>
            </>
          )}

          <Dialog
            open={isBulkDeleteDialogOpen}
            onOpenChange={(open) => {
              if (!isDeleting) setIsBulkDeleteDialogOpen(open);
            }}
          >
            <DialogContent className="max-w-sm p-4">
              <DialogHeader className="pb-2">
                <DialogTitle>
                  {t("myAppsGallery.deleteConfirmTitle", {
                    count: selectedAppIds.size,
                  })}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {t("myAppsGallery.deleteConfirmDescription")}
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
                  {t("myAppsGallery.cancel")}
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
                      <Loader2 className="size-3 animate-spin" />
                      {t("myAppsGallery.deleting")}
                    </>
                  ) : (
                    <>
                      {t("myAppsGallery.deleteCount", {
                        count: selectedAppIds.size,
                      })}
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <RestoreFromCloudDialog
            open={isRestoreOpen}
            onOpenChange={setIsRestoreOpen}
          />
        </div>
      </div>
    </div>
  );
}
