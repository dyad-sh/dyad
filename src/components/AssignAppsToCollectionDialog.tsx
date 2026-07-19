import { useEffect, useMemo, useState } from "react";
import { Folder, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { showError, showSuccess } from "@/lib/toast";
import { useAppCollections } from "@/hooks/useAppCollections";
import type { ListedApp } from "@/ipc/types/app";
import type { AppCollection } from "@/hooks/useAppCollections";
import { useTranslation } from "react-i18next";

interface AssignAppsToCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apps: ListedApp[];
  collections: AppCollection[];
  onAssigned?: () => void;
}

export function AssignAppsToCollectionDialog({
  open,
  onOpenChange,
  apps,
  collections,
  onAssigned,
}: AssignAppsToCollectionDialogProps) {
  const { t } = useTranslation(["home", "common"]);
  const { assignApps, createCollection } = useAppCollections();
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    number | null
  >(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedCollectionId(null);
      setSearchQuery("");
      setIsCreating(false);
      setNewCollectionName("");
    }
  }, [open]);

  const filteredCollections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter((c) => c.name.toLowerCase().includes(q));
  }, [collections, searchQuery]);

  const appIds = useMemo(() => apps.map((a) => a.id), [apps]);

  const handleAssignToExisting = async () => {
    if (selectedCollectionId == null || appIds.length === 0) return;
    setIsSubmitting(true);
    try {
      const target = collections.find((c) => c.id === selectedCollectionId);
      await assignApps({ collectionId: selectedCollectionId, appIds });
      showSuccess(
        t("collections.appsAdded", {
          count: apps.length,
          collectionName: target?.name ?? t("collections.defaultName"),
        }),
      );
      onAssigned?.();
      onOpenChange(false);
    } catch (error) {
      showError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateAndAssign = async () => {
    const trimmed = newCollectionName.trim();
    if (!trimmed) {
      showError(t("collections.nameRequired"));
      return;
    }
    setIsSubmitting(true);
    try {
      await createCollection({ name: trimmed, appIds });
      showSuccess(
        t("collections.appsAdded", {
          count: apps.length,
          collectionName: trimmed,
        }),
      );
      onAssigned?.();
      onOpenChange(false);
    } catch (error) {
      showError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isSubmitting) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md p-4">
        <DialogHeader className="pb-2">
          <DialogTitle>
            {t("collections.addAppsToCollectionTitle", { count: apps.length })}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("collections.addAppsDescription")}
          </DialogDescription>
        </DialogHeader>

        {isCreating ? (
          <div className="space-y-2">
            <label
              htmlFor="new-collection-name-input"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("collections.newName")}
            </label>
            <Input
              id="new-collection-name-input"
              data-testid="assign-apps-new-collection-name"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              placeholder={t("collections.namePlaceholder")}
              autoFocus
              disabled={isSubmitting}
            />
          </div>
        ) : (
          <>
            <Input
              type="text"
              placeholder={t("collections.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-(--background-lighter)"
              data-testid="assign-apps-search"
            />

            <div
              className="max-h-72 overflow-y-auto rounded-md border border-border bg-(--background-lighter) p-1"
              data-testid="assign-apps-collection-list"
            >
              {filteredCollections.length === 0 ? (
                <div className="p-3 text-center text-xs text-muted-foreground">
                  {collections.length === 0
                    ? t("collections.noCollectionsCreateOne")
                    : t("collections.noCollectionsMatchSearch")}
                </div>
              ) : (
                filteredCollections.map((col) => {
                  const isSelected = selectedCollectionId === col.id;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => setSelectedCollectionId(col.id)}
                      className={cn(
                        "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted",
                        isSelected && "bg-muted",
                      )}
                      data-testid={`assign-apps-collection-${col.id}`}
                      aria-pressed={isSelected}
                    >
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{col.name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {t("collections.appCount", {
                          count: col.appIds.length,
                        })}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              data-testid="assign-apps-create-new-toggle"
            >
              <Plus className="h-3 w-3" />
              {t("collections.createNew")}
            </button>
          </>
        )}

        <DialogFooter className="flex justify-end gap-2 pt-2">
          {isCreating ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setIsCreating(false);
                  setNewCollectionName("");
                }}
                disabled={isSubmitting}
                size="sm"
              >
                {t("common:back")}
              </Button>
              <Button
                onClick={handleCreateAndAssign}
                disabled={isSubmitting || !newCollectionName.trim()}
                size="sm"
                className="flex items-center gap-1"
                data-testid="assign-apps-create-confirm"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t("common:creating")}
                  </>
                ) : (
                  t("collections.createAndAdd")
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
                size="sm"
              >
                {t("common:cancel")}
              </Button>
              <Button
                onClick={handleAssignToExisting}
                disabled={isSubmitting || selectedCollectionId == null}
                size="sm"
                className="flex items-center gap-1"
                data-testid="assign-apps-confirm"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t("common:adding")}
                  </>
                ) : (
                  t("collections.addAppsCount", { count: apps.length })
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
