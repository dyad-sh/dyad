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
        `Added ${apps.length} app${apps.length === 1 ? "" : "s"} to "${
          target?.name ?? "collection"
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
    const trimmed = newCollectionName.trim();
    if (!trimmed) {
      showError("Collection name is required");
      return;
    }
    setIsSubmitting(true);
    try {
      await createCollection({ name: trimmed, appIds });
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
            Add {apps.length} app{apps.length === 1 ? "" : "s"} to a collection
          </DialogTitle>
          <DialogDescription className="text-xs">
            Apps already in another collection will be moved.
          </DialogDescription>
        </DialogHeader>

        {isCreating ? (
          <div className="space-y-2">
            <label
              htmlFor="new-collection-name-input"
              className="text-xs font-medium text-muted-foreground"
            >
              New collection name
            </label>
            <Input
              id="new-collection-name-input"
              data-testid="assign-apps-new-collection-name"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              placeholder="e.g. Work"
              autoFocus
              disabled={isSubmitting}
            />
          </div>
        ) : (
          <>
            <Input
              type="text"
              placeholder="Search collections..."
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
                    ? "No collections yet. Create one below."
                    : "No collections match your search."}
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
                        {col.appIds.length} app
                        {col.appIds.length === 1 ? "" : "s"}
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
              Create new collection
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
                Back
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
                disabled={isSubmitting || selectedCollectionId == null}
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
