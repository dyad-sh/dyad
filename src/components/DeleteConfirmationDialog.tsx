import React from "react";
import { Trash2, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DeleteConfirmationDialogProps {
  itemName: string;
  itemType?: string;
  onDelete: () => void | Promise<void>;
  trigger?: React.ReactNode;
  isDeleting?: boolean;
}

export function DeleteConfirmationDialog({
  itemName,
  itemType = "item",
  onDelete,
  trigger,
  isDeleting = false,
}: DeleteConfirmationDialogProps) {
  return (
    <AlertDialog>
      {trigger ? (
        <AlertDialogTrigger>{trigger}</AlertDialogTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger render={<span style={{ display: "contents" }} />}>
            <AlertDialogTrigger
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 w-9"
              data-testid="delete-prompt-button"
              disabled={isDeleting}
            >
              <Trash2 className="h-4 w-4" />
            </AlertDialogTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>Delete {itemType.toLowerCase()}</p>
          </TooltipContent>
        </Tooltip>
      )}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {itemType}</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{itemName}"? This action cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete} disabled={isDeleting}>
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
