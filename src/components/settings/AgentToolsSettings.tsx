import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  useAgentTools,
  type AgentToolName,
  type Consent,
} from "@/hooks/useAgentTools";
import { Loader2 } from "lucide-react";

export function AgentToolsSettings() {
  const { tools, consents, isLoading, setConsent } = useAgentTools();

  const handleConsentChange = (toolName: AgentToolName, consent: Consent) => {
    setConsent({ toolName, consent });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const readTools = tools?.filter((t) => t.category === "read") || [];
  const writeTools = tools?.filter((t) => t.category === "write") || [];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Configure permissions for Agent v2 built-in tools. Read-only tools are
        safe to always allow. Write tools modify your codebase and require more
        careful consideration.
      </p>

      {/* Read-only tools */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Read-Only Tools</h3>
          <Badge variant="secondary" className="text-xs">
            Safe
          </Badge>
        </div>
        <div className="space-y-2">
          {readTools.map((tool) => (
            <ToolConsentRow
              key={tool.name}
              name={tool.name}
              description={tool.description}
              consent={consents?.[tool.name] || "always"}
              onConsentChange={(consent) =>
                handleConsentChange(tool.name, consent)
              }
            />
          ))}
        </div>
      </div>

      {/* Write tools */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Write Tools</h3>
          <Badge variant="outline" className="text-xs">
            Modifies Codebase
          </Badge>
        </div>
        <div className="space-y-2">
          {writeTools.map((tool) => (
            <ToolConsentRow
              key={tool.name}
              name={tool.name}
              description={tool.description}
              consent={consents?.[tool.name] || "ask"}
              onConsentChange={(consent) =>
                handleConsentChange(tool.name, consent)
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolConsentRow({
  name,
  description,
  consent,
  onConsentChange,
}: {
  name: string;
  description: string;
  consent: Consent;
  onConsentChange: (consent: Consent) => void;
}) {
  return (
    <div className="border rounded p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm">{name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {description}
          </div>
        </div>
        <Select
          value={consent}
          onValueChange={(v) => onConsentChange(v as Consent)}
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
    </div>
  );
}
