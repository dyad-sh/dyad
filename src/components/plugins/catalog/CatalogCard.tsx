import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  isPinnedPackageSpec,
  type McpCatalogEntry,
} from "@/ipc/types/mcp_catalog";

// The schema already validates url, but parse defensively so one bad
// entry can't throw during render and take down the whole section.
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// What the entry connects to: the hostname for http entries, the
// pinned package for stdio ones. The schema guarantees a pinned spec
// exists; fall back to the command just in case.
function sourceOf(entry: McpCatalogEntry): string {
  if (entry.transport === "stdio") {
    return entry.args.find(isPinnedPackageSpec) ?? entry.command;
  }
  return hostnameOf(entry.url);
}

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
          {entry.transport === "http" && entry.oauth != null && (
            <span className="text-xs font-normal text-muted-foreground shrink-0">
              OAuth
            </span>
          )}
          {entry.transport === "stdio" && (
            <span className="text-xs font-normal text-muted-foreground shrink-0">
              Local
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
            {sourceOf(entry)}
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
