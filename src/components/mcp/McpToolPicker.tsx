/**
 * McpToolPicker
 * --------------------------------------------------------------------------
 * A reusable side-sheet component that lists every tool exposed by every
 * enabled MCP server in the user's hub, grouped by server, with checkboxes
 * for fine-grained allow-list selection.
 *
 * Used by:
 *   - Document Studio  (src/pages/document-editor.tsx)
 *   - Image Studio     (src/pages/ImageStudioPage.tsx)
 *   - Video Studio     (src/pages/VideoStudioPage.tsx)
 *   - Agent Builder    (src/pages/agent-editor.tsx)
 *
 * The picker is presentational + data-only: callers pass the current
 * `selected` set of qualified tool names (`mcp__<server>__<tool>`) and an
 * `onChange` handler. Persistence is the caller's responsibility (document
 * field, agent row, etc.).
 *
 * Catalog is fetched once via `useQuery(["mcp", "tool-catalog"])` and shared
 * by every mounted picker, so opening four pickers across the app does not
 * cost four IPC round-trips.
 */

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plug,
  Search,
} from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";

export interface McpToolCatalogEntry {
  serverId: number;
  serverName: string;
  toolName: string;
  qualifiedName: string;
  description: string;
}

export interface McpToolCatalogResult {
  catalog: McpToolCatalogEntry[];
  serversIncluded: Array<{ id: number; name: string; toolCount: number }>;
  serversFailed: Array<{ id: number; name: string; error: string }>;
  totalTools: number;
}

export interface McpToolPickerProps {
  /** Whether the side-sheet is open. */
  open: boolean;
  /** Open / close handler (typed for shadcn `Sheet`'s onOpenChange). */
  onOpenChange: (open: boolean) => void;
  /** Currently selected qualified tool names. */
  selected: ReadonlySet<string>;
  /** Called whenever the selection changes. */
  onChange: (next: Set<string>) => void;
  /**
   * Optional descriptor used to label the picker, e.g. "document",
   * "image", or "agent". Shown in the header / empty states.
   */
  scopeLabel?: string;
  /**
   * If true the picker is read-only \u2014 useful for previewing an agent's
   * persisted allow-list without giving the viewer permission to change it.
   */
  readOnly?: boolean;
}

async function fetchCatalog(): Promise<McpToolCatalogResult> {
  return IpcClient.getInstance().getMcpToolCatalog();
}

export function useMcpToolCatalog() {
  return useQuery<McpToolCatalogResult, Error>({
    queryKey: ["mcp", "tool-catalog"],
    queryFn: fetchCatalog,
    // Tool catalogs change as servers connect / disconnect, but the data is
    // small and the user can manually refresh. 60s is a friendly default.
    staleTime: 60_000,
  });
}

export function McpToolPicker({
  open,
  onOpenChange,
  selected,
  onChange,
  scopeLabel = "this generation",
  readOnly = false,
}: McpToolPickerProps) {
  const { data, isLoading, isError, error, refetch, isFetching } =
    useMcpToolCatalog();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const grouped = useMemo(() => {
    const map = new Map<
      number,
      {
        serverId: number;
        serverName: string;
        tools: McpToolCatalogEntry[];
      }
    >();
    for (const entry of data?.catalog ?? []) {
      if (!map.has(entry.serverId)) {
        map.set(entry.serverId, {
          serverId: entry.serverId,
          serverName: entry.serverName,
          tools: [],
        });
      }
      map.get(entry.serverId)!.tools.push(entry);
    }
    const list = Array.from(map.values());
    list.sort((a, b) => a.serverName.localeCompare(b.serverName));
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list
      .map((g) => ({
        ...g,
        tools: g.tools.filter(
          (t) =>
            t.toolName.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.qualifiedName.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.tools.length > 0);
  }, [data, search]);

  const toggleTool = (qn: string) => {
    if (readOnly) return;
    const next = new Set(selected);
    if (next.has(qn)) {
      next.delete(qn);
    } else {
      next.add(qn);
    }
    onChange(next);
  };

  const toggleServer = (serverTools: McpToolCatalogEntry[]) => {
    if (readOnly) return;
    const next = new Set(selected);
    const allSelected = serverTools.every((t) => next.has(t.qualifiedName));
    for (const t of serverTools) {
      if (allSelected) next.delete(t.qualifiedName);
      else next.add(t.qualifiedName);
    }
    onChange(next);
  };

  const selectAll = () => {
    if (readOnly) return;
    const next = new Set<string>();
    for (const e of data?.catalog ?? []) next.add(e.qualifiedName);
    onChange(next);
  };

  const clearAll = () => {
    if (readOnly) return;
    onChange(new Set());
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-lg sm:max-w-xl flex flex-col"
        aria-label="MCP Tool Picker"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4" />
            MCP Tools
            {data && (
              <Badge variant="secondary" className="ml-auto">
                {selected.size} / {data.totalTools} selected
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            Pick which Model Context Protocol tools the assistant may call
            for {scopeLabel}. Selections are scoped — they don't change the
            global MCP Hub configuration.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 mt-3">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tools or servers..."
              className="pl-8"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Refresh"
            )}
          </Button>
        </div>

        {!readOnly && data && data.totalTools > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={selectAll}>
              Select all
            </Button>
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto mt-3 -mx-6 px-6">
          {isLoading && (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading MCP tool catalog...
            </div>
          )}

          {isError && (
            <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />
              <div>
                <div className="font-medium">Couldn't load catalog</div>
                <div className="text-muted-foreground">
                  {error?.message ?? "Unknown error"}
                </div>
              </div>
            </div>
          )}

          {data && data.totalTools === 0 && (
            <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
              No MCP tools available yet. Visit the MCP Hub to install and
              enable a server.
            </div>
          )}

          {data &&
            grouped.map((g) => {
              const isExpanded = expanded[g.serverId] ?? true;
              const allSelected = g.tools.every((t) =>
                selected.has(t.qualifiedName),
              );
              const someSelected =
                !allSelected && g.tools.some((t) => selected.has(t.qualifiedName));
              return (
                <Collapsible
                  key={g.serverId}
                  open={isExpanded}
                  onOpenChange={(o) =>
                    setExpanded((prev) => ({ ...prev, [g.serverId]: o }))
                  }
                  className="mb-3 rounded border"
                >
                  <div className="flex items-center gap-2 p-2 bg-muted/30">
                    <Checkbox
                      checked={
                        allSelected ? true : someSelected ? "indeterminate" : false
                      }
                      onCheckedChange={() => toggleServer(g.tools)}
                      disabled={readOnly}
                      aria-label={`Toggle all tools on ${g.serverName}`}
                    />
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex-1 flex items-center gap-2 text-left text-sm font-medium"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        {g.serverName}
                        <Badge variant="outline" className="ml-auto">
                          {g.tools.length} tools
                        </Badge>
                      </button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <div className="divide-y">
                      {g.tools.map((t) => (
                        <label
                          key={t.qualifiedName}
                          className="flex items-start gap-2 p-2 cursor-pointer hover:bg-muted/40"
                        >
                          <Checkbox
                            checked={selected.has(t.qualifiedName)}
                            onCheckedChange={() => toggleTool(t.qualifiedName)}
                            disabled={readOnly}
                            className="mt-0.5"
                            aria-label={`Toggle ${t.toolName}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-mono truncate">
                              {t.toolName}
                            </div>
                            {t.description && (
                              <div className="text-xs text-muted-foreground line-clamp-2">
                                {t.description}
                              </div>
                            )}
                            <div className="text-[10px] text-muted-foreground/70 font-mono mt-0.5">
                              {t.qualifiedName}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}

          {data && data.serversFailed.length > 0 && (
            <div className="mt-3 rounded border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
              <div className="font-medium mb-1 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Skipped {data.serversFailed.length} server
                {data.serversFailed.length === 1 ? "" : "s"}
              </div>
              <ul className="space-y-0.5">
                {data.serversFailed.map((s) => (
                  <li key={s.id}>
                    <span className="font-mono">{s.name}:</span> {s.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <SheetFooter className="mt-3">
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default McpToolPicker;
