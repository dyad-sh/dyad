import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Bot } from "lucide-react";
import { useAgentTools, type AgentToolName, type Consent } from "@/hooks/useAgentTools";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function AgentToolsPicker() {
  const [isOpen, setIsOpen] = useState(false);
  const { tools, consents, isLoading, setConsent } = useAgentTools();

  const handleConsentChange = (toolName: AgentToolName, consent: Consent) => {
    setConsent({ toolName, consent });
  };

  const readTools = tools?.filter((t) => t.category === "read") || [];
  const writeTools = tools?.filter((t) => t.category === "write") || [];

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="has-[>svg]:px-2"
                size="sm"
                data-testid="agent-tools-button"
              >
                <Bot className="size-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Agent v2 Tools</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        className="w-120 max-h-[80vh] overflow-y-auto"
        align="start"
      >
        <div className="space-y-4">
          <div>
            <h3 className="font-medium">Agent v2 Tools</h3>
            <p className="text-sm text-muted-foreground">
              Configure permissions for Agent v2 built-in tools.
            </p>
          </div>

          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            <div className="space-y-3">
              {/* Read-only tools */}
              <div className="border rounded-md p-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-sm">Read-Only Tools</div>
                  <Badge variant="secondary">Safe</Badge>
                </div>
                <div className="space-y-1">
                  {readTools.map((tool) => (
                    <div
                      key={tool.name}
                      className="flex items-center justify-between gap-2 rounded border p-2"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-sm truncate">
                          {tool.name}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {tool.description}
                        </div>
                      </div>
                      <Select
                        value={consents?.[tool.name] || "always"}
                        onValueChange={(v) =>
                          handleConsentChange(tool.name, v as Consent)
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
                </div>
              </div>

              {/* Write tools */}
              <div className="border rounded-md p-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-sm">Write Tools</div>
                  <Badge variant="outline">Requires Permission</Badge>
                </div>
                <div className="space-y-1">
                  {writeTools.map((tool) => (
                    <div
                      key={tool.name}
                      className="flex items-center justify-between gap-2 rounded border p-2"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-sm truncate">
                          {tool.name}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {tool.description}
                        </div>
                      </div>
                      <Select
                        value={consents?.[tool.name] || "ask"}
                        onValueChange={(v) =>
                          handleConsentChange(tool.name, v as Consent)
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
                </div>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

