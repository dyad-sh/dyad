import React, { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Wrench } from "lucide-react";
import { useMcp } from "@/hooks/useMcp";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function McpToolsPicker() {
  const [isOpen, setIsOpen] = useState(false);
  const { servers, toolsByServer, consentsMap, setToolConsent } = useMcp();

  // Removed activation toggling – consent governs execution time behavior

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-8 px-2"
        data-testid="mcp-tools-button"
        title="Tools"
      >
        <Wrench className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        className="w-120 max-h-[80vh] overflow-y-auto"
        align="start"
      >
        <div className="space-y-4">
          <div>
            <h3 className="font-medium">Tools (MCP)</h3>
            <p className="text-sm text-muted-foreground">
              Enable tools from your configured MCP servers.
            </p>
          </div>
          {servers.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No MCP servers configured. Configure them in Settings → Tools
              (MCP).
            </div>
          ) : (
            <div className="space-y-3">
              {servers.map((s) => (
                <div key={s.id} className="border rounded-md p-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm truncate">{s.name}</div>
                    {s.enabled ? (
                      <Badge variant="secondary">Enabled</Badge>
                    ) : (
                      <Badge variant="outline">Disabled</Badge>
                    )}
                  </div>
                  <div className="mt-2 space-y-1">
                    {(toolsByServer[s.id] || []).map((t) => (
                      <div
                        key={t.name}
                        className="flex items-center justify-between gap-2 rounded border p-2"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-sm truncate">
                            {t.name}
                          </div>
                          {t.description && (
                            <div className="text-xs text-muted-foreground truncate">
                              {t.description}
                            </div>
                          )}
                        </div>
                        <Select
                          value={
                            consentsMap[`${s.id}:${t.name}`] ||
                            t.consent ||
                            "ask"
                          }
                          onValueChange={(v) =>
                            setToolConsent(s.id, t.name, v as any)
                          }
                        >
                          <SelectTrigger className="w-[140px] h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ask">Ask</SelectItem>
                            <SelectItem value="always">Always allow</SelectItem>
                            <SelectItem value="denied">Deny</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                    {(toolsByServer[s.id] || []).length === 0 && (
                      <div className="text-xs text-muted-foreground">
                        No tools discovered.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
