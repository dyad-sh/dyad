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
import { useCategories } from "@/hooks/useCategories";
import type { ListedApp } from "@/ipc/types/app";
import type { Category } from "@/hooks/useCategories";

interface AssignAppsToCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apps: ListedApp[];
  categories: Category[];
  onAssigned?: () => void;
}

export function AssignAppsToCategoryDialog({
  open,
  onOpenChange,
  apps,
  categories,
  onAssigned,
}: AssignAppsToCategoryDialogProps) {
  const { assignApps, createCategory } = useCategories();
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedCategoryId(null);
      setSearchQuery("");
      setIsCreating(false);
      setNewCategoryName("");
    }
  }, [open]);

  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, searchQuery]);

  const appIds = useMemo(() => apps.map((a) => a.id), [apps]);

  const handleAssignToExisting = async () => {
    if (selectedCategoryId == null || appIds.length === 0) return;
    setIsSubmitting(true);
    try {
      const target = categories.find((c) => c.id === selectedCategoryId);
      await assignApps({ categoryId: selectedCategoryId, appIds });
      showSuccess(
        `Added ${apps.length} app${apps.length === 1 ? "" : "s"} to "${
          target?.name ?? "category"
        }"`,
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
    const trimmed = newCategoryName.trim();
    if (!trimmed) {
      showError("Category name is required");
      return;
    }
    setIsSubmitting(true);
    try {
      await createCategory({ name: trimmed, appIds });
      showSuccess(
        `Added ${apps.length} app${apps.length === 1 ? "" : "s"} to "${trimmed}"`,
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
            Add {apps.length} app{apps.length === 1 ? "" : "s"} to a category
          </DialogTitle>
          <DialogDescription className="text-xs">
            Apps already in another category will be moved.
          </DialogDescription>
        </DialogHeader>

        {isCreating ? (
          <div className="space-y-2">
            <label
              htmlFor="new-category-name-input"
              className="text-xs font-medium text-muted-foreground"
            >
              New category name
            </label>
            <Input
              id="new-category-name-input"
              data-testid="assign-apps-new-category-name"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="e.g. Work"
              autoFocus
              disabled={isSubmitting}
            />
          </div>
        ) : (
          <>
            <Input
              type="text"
              placeholder="Search categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-(--background-lighter)"
              data-testid="assign-apps-search"
            />

            <div
              className="max-h-72 overflow-y-auto rounded-md border border-border bg-(--background-lighter) p-1"
              data-testid="assign-apps-category-list"
            >
              {filteredCategories.length === 0 ? (
                <div className="p-3 text-center text-xs text-muted-foreground">
                  {categories.length === 0
                    ? "No categories yet. Create one below."
                    : "No categories match your search."}
                </div>
              ) : (
                filteredCategories.map((cat) => {
                  const isSelected = selectedCategoryId === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategoryId(cat.id)}
                      className={cn(
                        "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted",
                        isSelected && "bg-muted",
                      )}
                      data-testid={`assign-apps-category-${cat.id}`}
                      aria-pressed={isSelected}
                    >
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{cat.name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {cat.appIds.length} app
                        {cat.appIds.length === 1 ? "" : "s"}
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
              Create new category
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
                  setNewCategoryName("");
                }}
                disabled={isSubmitting}
                size="sm"
              >
                Back
              </Button>
              <Button
                onClick={handleCreateAndAssign}
                disabled={isSubmitting || !newCategoryName.trim()}
                size="sm"
                className="flex items-center gap-1"
                data-testid="assign-apps-create-confirm"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create & add"
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
                Cancel
              </Button>
              <Button
                onClick={handleAssignToExisting}
                disabled={isSubmitting || selectedCategoryId == null}
                size="sm"
                className="flex items-center gap-1"
                data-testid="assign-apps-confirm"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Adding...
                  </>
                ) : (
                  `Add ${apps.length} app${apps.length === 1 ? "" : "s"}`
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
