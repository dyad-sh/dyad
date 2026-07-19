import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { showError, showSuccess } from "@/lib/toast";
import { useAppCollections } from "@/hooks/useAppCollections";
import { buildCollectionNameByAppId } from "@/lib/appCollections";
import type { ListedApp } from "@/ipc/types/app";
import type { AppCollection } from "@/hooks/useAppCollections";
import { useTranslation } from "react-i18next";

interface AddAppsToCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: AppCollection;
  allApps: ListedApp[];
  collections: AppCollection[];
}

export function AddAppsToCollectionDialog({
  open,
  onOpenChange,
  collection,
  allApps,
  collections,
}: AddAppsToCollectionDialogProps) {
  const { t } = useTranslation(["home", "common"]);
  const { assignApps } = useAppCollections();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setSearchQuery("");
    }
  }, [open]);

  const collectionNameByAppId = useMemo(
    () => buildCollectionNameByAppId(collections, collection.id),
    [collections, collection.id],
  );

  const availableApps = useMemo(() => {
    const memberSet = new Set(collection.appIds);
    const q = searchQuery.trim().toLowerCase();
    return allApps
      .filter((a) => !memberSet.has(a.id))
      .filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [allApps, collection.appIds, searchQuery]);

  const toggleApp = (appId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selected.size === 0) return;
    setIsSubmitting(true);
    try {
      await assignApps({
        collectionId: collection.id,
        appIds: Array.from(selected),
      });
      showSuccess(
        t("collections.appsAdded", {
          count: selected.size,
          collectionName: collection.name,
        }),
      );
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
            {t("collections.addAppsTitle", { collectionName: collection.name })}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("collections.addAppsDescription")}
          </DialogDescription>
        </DialogHeader>

        <Input
          type="text"
          placeholder={t("common:searchAppsPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-(--background-lighter)"
          data-testid="add-apps-dialog-search"
        />

        <div
          className="max-h-72 overflow-y-auto rounded-md border border-border bg-(--background-lighter) p-1"
          data-testid="add-apps-dialog-list"
        >
          {availableApps.length === 0 ? (
            <div className="p-3 text-center text-xs text-muted-foreground">
              {allApps.length === collection.appIds.length
                ? t("collections.allAppsInCollection")
                : t("collections.noAppsMatchSearch")}
            </div>
          ) : (
            availableApps.map((app) => {
              const inOther = collectionNameByAppId.get(app.id);
              const checked = selected.has(app.id);
              return (
                <label
                  key={app.id}
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5 cursor-pointer hover:bg-muted"
                  data-testid={`add-apps-dialog-item-${app.id}`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleApp(app.id)}
                  />
                  <span className="flex-1 truncate text-sm">{app.name}</span>
                  {inOther && (
                    <span className="text-[10px] text-muted-foreground italic shrink-0">
                      {t("collections.inCollection", {
                        collectionName: inOther,
                      })}
                    </span>
                  )}
                </label>
              );
            })
          )}
        </div>

        <DialogFooter className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            size="sm"
          >
            {t("common:cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isSubmitting || selected.size === 0}
            size="sm"
            className="flex items-center gap-1"
            data-testid="add-apps-dialog-confirm"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("common:adding")}
              </>
            ) : (
              t("collections.addAppsCount", { count: selected.size })
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
