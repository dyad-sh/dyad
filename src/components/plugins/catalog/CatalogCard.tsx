import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  looksLikePackageSpec,
  type McpCatalogEntry,
} from "@/ipc/types/mcp_catalog";
import { catalogEntryCanConnect } from "./catalogCardStatus";

// The schema already validates url, but parse defensively so one bad
// entry can't throw during render and take down the whole section.
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// What the entry connects to: the hostname for http entries, the package
// for stdio ones, falling back to the command if no arg looks like one.
function sourceOf(entry: McpCatalogEntry): string {
  if (entry.transport === "stdio") {
    return entry.args.find(looksLikePackageSpec) ?? entry.command;
  }
  return hostnameOf(entry.url);
}

// What an already-added entry is doing. "Added" on its own says only
// that a row exists, which reads as finished while an OAuth connect is
// still running or has failed.
export type CatalogCardStatus =
  | "not-added"
  | "added"
  | "connecting"
  | "needs-connect";

export function CatalogCard({
  entry,
  status,
  isAdding,
  onAdd,
}: {
  entry: McpCatalogEntry;
  status: CatalogCardStatus;
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
          {status === "not-added" ? (
            <Button size="sm" onClick={() => onAdd(entry)} disabled={isAdding}>
              {isAdding ? "Adding…" : "Add"}
            </Button>
          ) : (
            // A live region only where the label can still change, so a
            // catalog of settled entries isn't a wall of them. The icons
            // repeat the label, so they stay out of the accessible name.
            <span
              role={catalogEntryCanConnect(entry) ? "status" : undefined}
              className={`flex items-center gap-1 text-xs font-medium shrink-0 ${
                status === "connecting"
                  ? "text-muted-foreground"
                  : status === "needs-connect"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-green-600 dark:text-green-400"
              }`}
            >
              {status === "connecting" && (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              )}
              {status === "added" && (
                <Check className="w-3.5 h-3.5" aria-hidden />
              )}
              {status === "connecting"
                ? "Connecting…"
                : status === "needs-connect"
                  ? "Not connected"
                  : "Added"}
            </span>
          )}
        </div>
      </CardHeader>
    </Card>
  );
}
