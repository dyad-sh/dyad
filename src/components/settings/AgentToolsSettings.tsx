import React, { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  useAgentTools,
  type AgentToolName,
  type AgentTool,
} from "@/hooks/useAgentTools";
import { Loader2, ChevronRight } from "lucide-react";
import type { AgentToolConsent } from "@/ipc/ipc_types";

export function AgentToolsSettings() {
  const { tools, isLoading, setConsent } = useAgentTools();
  const [showAutoApproved, setShowAutoApproved] = useState(false);

  const handleConsentChange = (
    toolName: AgentToolName,
    consent: AgentToolConsent,
  ) => {
    setConsent({ toolName, consent });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const autoApprovedTools =
    tools?.filter((t: AgentTool) => t.isAllowedByDefault) || [];
  const requiresApprovalTools =
    tools?.filter((t: AgentTool) => !t.isAllowedByDefault) || [];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Configure permissions for Agent built-in tools.
      </p>

      {/* Requires approval tools */}
      <div className="space-y-2">
        {requiresApprovalTools.map((tool: AgentTool) => (
          <ToolConsentRow
            key={tool.name}
            name={tool.name}
            description={tool.description}
            consent={tool.consent}
            onConsentChange={(consent) =>
              handleConsentChange(tool.name as AgentToolName, consent)
            }
          />
        ))}
      </div>

      {/* Auto-approved tools (collapsed by default) */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setShowAutoApproved(!showAutoApproved)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight
            className={`size-4 transition-transform ${showAutoApproved ? "rotate-90" : ""}`}
          />
          <span>Default allowed tools ({autoApprovedTools.length})</span>
        </button>
        {showAutoApproved && (
          <div className="space-y-2 pl-6">
            {autoApprovedTools.map((tool: AgentTool) => (
              <ToolConsentRow
                key={tool.name}
                name={tool.name}
                description={tool.description}
                consent={tool.consent}
                onConsentChange={(consent) =>
                  handleConsentChange(tool.name as AgentToolName, consent)
                }
              />
            ))}
          </div>
        )}
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
  consent: AgentToolConsent;
  onConsentChange: (consent: AgentToolConsent) => void;
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
          onValueChange={(v) => onConsentChange(v as AgentToolConsent)}
        >
          <SelectTrigger className="w-[140px] h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ask">Ask</SelectItem>
            <SelectItem value="always">Always allow</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
