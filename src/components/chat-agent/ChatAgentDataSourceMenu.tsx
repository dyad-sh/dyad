import { useQuery } from "@tanstack/react-query";
import { Database, Server } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ipc } from "@/ipc/types";
import { cn } from "@/lib/utils";

/**
 * Picks which connected databases the agent may query for this conversation.
 *
 * Deliberately the same shape as the knowledge menu next to it: an icon that
 * lights up when something is selected, a checklist, and a chip in the
 * composer showing the count. Two ways to attach context to a message should
 * not need two mental models.
 *
 * Nothing here ever sees a credential. A selection is a list of opaque ids,
 * and the main process is the only thing that can turn one into a connection.
 */
export function ChatAgentDataSourceMenu({
  disabled,
  selectedDataSourceIds,
  onChange,
}: {
  disabled?: boolean;
  selectedDataSourceIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const sourcesQuery = useQuery({
    queryKey: ["data-sources"],
    queryFn: () => ipc.dataSource.list(),
  });

  // A disabled source is one someone deliberately switched off, so offering it
  // here would be offering a query that cannot run.
  const sources = (sourcesQuery.data ?? []).filter((source) => source.enabled);
  const active = selectedDataSourceIds.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "chat-agent-composer-icon-btn",
          active && "chat-agent-composer-icon-btn--active",
        )}
        aria-label="Use connected data sources"
        title="Use connected data sources"
        data-testid="chat-agent-data-source-menu"
      >
        <Database className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-72 p-1.5">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Server className="size-4 text-cyan-500" />
          Data sources
        </DropdownMenuLabel>
        <p className="px-2 pb-2 text-xs leading-5 text-muted-foreground">
          Selected databases can be queried to answer your questions. Access is
          read-only and limited to what each connection key can already read.
        </p>
        <DropdownMenuSeparator />

        {sources.map((source) => {
          const checked = selectedDataSourceIds.includes(source.id);
          const unreachable = source.status !== "connected";
          return (
            <DropdownMenuCheckboxItem
              key={source.id}
              checked={checked}
              closeOnClick={false}
              onCheckedChange={(nextChecked) => {
                onChange(
                  nextChecked
                    ? [...selectedDataSourceIds, source.id]
                    : selectedDataSourceIds.filter((id) => id !== source.id),
                );
              }}
            >
              <span className="min-w-0">
                <span className="block truncate">{source.name}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {/* Says what is actually known rather than implying a
                      readiness that has not been tested. */}
                  {unreachable
                    ? "Not connected — test it in Data Sources"
                    : source.tableCount > 0
                      ? `${source.tableCount} readable ${source.tableCount === 1 ? "table" : "tables"}`
                      : "Connected, no readable tables yet"}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          );
        })}

        {!sources.length && (
          <div className="px-2 py-3 text-xs leading-5 text-muted-foreground">
            Connect a Supabase database in Data Sources first.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
