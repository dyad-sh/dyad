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
import { showError, showSuccess } from "@/lib/toast";
import { useCategories } from "@/hooks/useCategories";
import type { ListedApp } from "@/ipc/types/app";
import type { Category } from "@/hooks/useCategories";

interface AddAppsToCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: Category;
  allApps: ListedApp[];
  categories: Category[];
}

export function AddAppsToCategoryDialog({
  open,
  onOpenChange,
  category,
  allApps,
  categories,
}: AddAppsToCategoryDialogProps) {
  const { assignApps } = useCategories();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setSearchQuery("");
    }
  }, [open]);

  const categoryNameByAppId = useMemo(() => {
    const map = new Map<number, string>();
    for (const cat of categories) {
      if (cat.id === category.id) continue;
      for (const appId of cat.appIds) {
        map.set(appId, cat.name);
      }
    }
    return map;
  }, [categories, category.id]);

  const availableApps = useMemo(() => {
    const memberSet = new Set(category.appIds);
    const q = searchQuery.trim().toLowerCase();
    return allApps
      .filter((a) => !memberSet.has(a.id))
      .filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [allApps, category.appIds, searchQuery]);

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
        categoryId: category.id,
        appIds: Array.from(selected),
      });
      showSuccess(
        `Added ${selected.size} app${selected.size === 1 ? "" : "s"} to "${category.name}"`,
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
          <DialogTitle>Add apps to "{category.name}"</DialogTitle>
          <DialogDescription className="text-xs">
            Select apps to add. Apps already in another category will be moved.
          </DialogDescription>
        </DialogHeader>

        <input
          type="text"
          placeholder="Search apps..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-md border border-border bg-(--background-lighter) px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          data-testid="add-apps-dialog-search"
        />

        <div
          className="max-h-72 overflow-y-auto rounded-md border border-border bg-(--background-lighter) p-1"
          data-testid="add-apps-dialog-list"
        >
          {availableApps.length === 0 ? (
            <div className="p-3 text-center text-xs text-muted-foreground">
              {allApps.length === category.appIds.length
                ? "All apps are already in this category."
                : "No apps match your search."}
            </div>
          ) : (
            availableApps.map((app) => {
              const inOther = categoryNameByAppId.get(app.id);
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
                      in "{inOther}"
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
            Cancel
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
                Adding...
              </>
            ) : (
              `Add ${selected.size} app${selected.size === 1 ? "" : "s"}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
