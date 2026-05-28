import { Folder, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AppCollection } from "@/hooks/useAppCollections";

interface CollectionFolderCardProps {
  collection: AppCollection;
  onOpen: (collection: AppCollection) => void;
  onRename: (collection: AppCollection) => void;
  onDelete: (collection: AppCollection) => void;
}

export function CollectionFolderCard({
  collection,
  onOpen,
  onRename,
  onDelete,
}: CollectionFolderCardProps) {
  const count = collection.appIds.length;
  return (
    <div
      data-testid={`collection-folder-${collection.id}`}
      className={cn(
        "border rounded-lg p-4 bg-(--background-lightest) relative cursor-pointer",
        "hover:border-primary/30 transition-colors",
      )}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(collection)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(collection);
        }
      }}
    >
      <div
        className="absolute top-2 right-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Collection ${collection.name} actions`}
            data-testid={`collection-folder-${collection.id}-menu`}
          >
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onRename(collection)}>
              <Pencil className="mr-2 h-4 w-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(collection)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-3 pr-8">
        <div className="w-14 h-14 flex items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-900/20">
          <Folder className="h-8 w-8 text-amber-500" fill="currentColor" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold truncate">{collection.name}</h3>
          <p className="text-sm text-muted-foreground">
            {count} app{count !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
