import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { showError, showSuccess } from "@/lib/toast";
import { useAppCollections } from "@/hooks/useAppCollections";
import type { AppCollection } from "@/hooks/useAppCollections";

interface DeleteCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: AppCollection | null;
  onDeleted?: () => void;
}

export function DeleteCollectionDialog({
  open,
  onOpenChange,
  collection,
  onDeleted,
}: DeleteCollectionDialogProps) {
  const { deleteCollection } = useAppCollections();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    if (!collection) return;
    setIsDeleting(true);
    try {
      await deleteCollection(collection.id);
      showSuccess(`Collection "${collection.name}" deleted`);
      onOpenChange(false);
      onDeleted?.();
    } catch (error) {
      showError(error);
    } finally {
      setIsDeleting(false);
    }
  };

  const count = collection?.appIds.length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isDeleting) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-sm p-4">
        <DialogHeader className="pb-2">
          <DialogTitle>
            Delete collection {collection ? `"${collection.name}"` : ""}?
          </DialogTitle>
          <DialogDescription className="text-xs">
            {count > 0
              ? `The ${count} app${count === 1 ? "" : "s"} in this collection won't be deleted — they'll just be uncollected.`
              : "This collection will be removed."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
            size="sm"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isDeleting || !collection}
            size="sm"
            className="flex items-center gap-1"
            data-testid="collection-delete-confirm-button"
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Delete
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
