import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { McpCatalogEntry } from "@/ipc/shared/remote_mcp_catalog";

export function CatalogCard({
  entry,
  isAdded,
  isAdding,
  onAdd,
}: {
  entry: McpCatalogEntry;
  isAdded: boolean;
  isAdding: boolean;
  onAdd: (entry: McpCatalogEntry) => void;
}) {
  return (
    <Card data-testid="catalog-card" className="border-border">
      <CardHeader className="p-4">
        <CardTitle className="text-base font-medium mb-1 flex items-center gap-2 min-w-0">
          <span className="truncate">{entry.name}</span>
          {entry.oauth !== "none" && (
            <span className="text-xs font-normal text-muted-foreground shrink-0">
              OAuth
            </span>
          )}
        </CardTitle>
        {entry.description && (
          <div className="text-xs text-muted-foreground truncate">
            {entry.description}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground truncate">
            {new URL(entry.url).hostname}
          </span>
          {isAdded ? (
            <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400 shrink-0">
              <Check className="w-3.5 h-3.5" />
              Added
            </span>
          ) : (
            <Button size="sm" onClick={() => onAdd(entry)} disabled={isAdding}>
              {isAdding ? "Adding…" : "Add"}
            </Button>
          )}
        </div>
      </CardHeader>
    </Card>
  );
}
