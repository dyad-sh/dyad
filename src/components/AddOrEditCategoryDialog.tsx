import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { showError, showSuccess } from "@/lib/toast";
import { useCategories } from "@/hooks/useCategories";
import { cn } from "@/lib/utils";
import type { ListedApp } from "@/ipc/types/app";
import type { Category } from "@/hooks/useCategories";

interface AddOrEditCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, dialog is in edit mode for that category. */
  category?: Category | null;
  allApps: ListedApp[];
  categories: Category[];
}

export function AddOrEditCategoryDialog({
  open,
  onOpenChange,
  category,
  allApps,
  categories,
}: AddOrEditCategoryDialogProps) {
  const isEdit = !!category;
  const { createCategory, updateCategory } = useCategories();

  const [name, setName] = useState("");
  const [selectedAppIds, setSelectedAppIds] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setName(category?.name ?? "");
      setSelectedAppIds(new Set(category?.appIds ?? []));
      setPickerOpen(false);
    }
  }, [open, category]);

  const categoryNameByAppId = useMemo(() => {
    const map = new Map<number, string>();
    for (const cat of categories) {
      if (isEdit && cat.id === category!.id) continue;
      for (const appId of cat.appIds) {
        map.set(appId, cat.name);
      }
    }
    return map;
  }, [categories, category, isEdit]);

  const selectedApps = useMemo(
    () => allApps.filter((a) => selectedAppIds.has(a.id)),
    [allApps, selectedAppIds],
  );
  const pickableApps = useMemo(
    () => allApps.filter((a) => !selectedAppIds.has(a.id)),
    [allApps, selectedAppIds],
  );

  const toggleApp = (appId: number, checked: boolean) => {
    setSelectedAppIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(appId);
      else next.delete(appId);
      return next;
    });
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      showError("Category name is required");
      return;
    }
    setIsSubmitting(true);
    try {
      const finalAppIds = Array.from(selectedAppIds);
      if (isEdit && category) {
        await updateCategory({
          id: category.id,
          name: trimmed,
          appIds: finalAppIds,
        });
        showSuccess(`Category "${trimmed}" updated`);
      } else {
        await createCategory({ name: trimmed, appIds: finalAppIds });
        showSuccess(`Category "${trimmed}" created`);
      }
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
          <DialogTitle>{isEdit ? "Edit category" : "Add category"}</DialogTitle>
          <DialogDescription className="text-xs">
            {isEdit
              ? "Rename this category or change which apps belong to it."
              : "Group related apps together."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label
              htmlFor="category-name-input"
              className="text-xs font-medium text-muted-foreground"
            >
              Name
            </label>
            <Input
              id="category-name-input"
              data-testid="category-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Work"
              autoFocus
              disabled={isSubmitting}
            />
          </div>

          <div>
            <span className="text-xs font-medium text-muted-foreground block mb-1">
              Apps in this category
            </span>

            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <div
                className="min-h-[80px] max-h-48 overflow-y-auto rounded-md border border-border bg-(--background-lighter) p-2"
                data-testid="category-selected-apps"
              >
                <ul className="flex flex-wrap gap-1.5 items-center">
                  {selectedApps.length === 0 && (
                    <li className="text-xs text-muted-foreground">
                      No apps yet.
                    </li>
                  )}
                  {selectedApps.map((app) => {
                    const inOther = categoryNameByAppId.get(app.id);
                    return (
                      <li
                        key={app.id}
                        className="inline-flex items-center gap-1 rounded-full bg-(--background-lightest) border border-border px-2 py-0.5 text-xs"
                      >
                        <span className="truncate max-w-[160px]">
                          {app.name}
                        </span>
                        {inOther && (
                          <span
                            className="text-[10px] text-muted-foreground italic"
                            title={`Currently in "${inOther}" — saving will move it.`}
                          >
                            (move)
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleApp(app.id, false)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${app.name}`}
                          data-testid={`category-remove-app-${app.id}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    );
                  })}
                  <li className="inline-flex">
                    <PopoverTrigger
                      className={cn(
                        "inline-flex items-center justify-center h-6 w-6 rounded-full border bg-(--background-lightest) text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-50",
                        selectedApps.length === 0
                          ? "border-border"
                          : "border-dashed border-border",
                      )}
                      disabled={isSubmitting || pickableApps.length === 0}
                      data-testid="category-add-apps-picker-trigger"
                      aria-label="Add apps"
                    >
                      <Plus className="h-3 w-3" />
                    </PopoverTrigger>
                  </li>
                </ul>
              </div>
              <PopoverContent className="w-72 p-0" align="end">
                <div className="max-h-64 overflow-y-auto p-1">
                  {pickableApps.length === 0 ? (
                    <div className="text-xs text-muted-foreground p-3 text-center">
                      All apps already added.
                    </div>
                  ) : (
                    pickableApps.map((app) => {
                      const inOther = categoryNameByAppId.get(app.id);
                      return (
                        <button
                          key={app.id}
                          type="button"
                          onClick={() => toggleApp(app.id, true)}
                          className="w-full flex items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                          data-testid={`category-picker-app-${app.id}`}
                        >
                          <span className="flex-1 min-w-0 truncate">
                            {app.name}
                          </span>
                          {inOther && (
                            <span className="text-[10px] text-muted-foreground italic shrink-0">
                              in "{inOther}"
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
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
            onClick={handleSubmit}
            disabled={isSubmitting || !name.trim()}
            size="sm"
            className="flex items-center gap-1"
            data-testid="category-submit-button"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving...
              </>
            ) : isEdit ? (
              "Save"
            ) : (
              "Create"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
