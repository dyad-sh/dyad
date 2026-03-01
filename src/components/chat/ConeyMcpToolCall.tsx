import React, { useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import {
  ConeyCard,
  ConeyCardHeader,
  ConeyBadge,
  ConeyExpandIcon,
  ConeyCardContent,
} from "./ConeyCardPrimitives";

interface ConeyMcpToolCallProps {
  node?: any;
  children?: React.ReactNode;
}

export const ConeyMcpToolCall: React.FC<ConeyMcpToolCallProps> = ({
  node,
  children,
}) => {
  const serverName: string = node?.properties?.serverName || "";
  const toolName: string = node?.properties?.toolName || "";
  const [expanded, setExpanded] = useState(false);

  const raw = typeof children === "string" ? children : String(children ?? "");

  const prettyJson = useMemo(() => {
    if (!expanded) return "";
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch (e) {
      console.error("Error parsing JSON for coney-mcp-tool-call", e);
      return raw;
    }
  }, [expanded, raw]);

  return (
    <ConeyCard
      accentColor="blue"
      isExpanded={expanded}
      onClick={() => setExpanded((v) => !v)}
    >
      <ConeyCardHeader icon={<Wrench size={15} />} accentColor="blue">
        <ConeyBadge color="blue">Tool Call</ConeyBadge>
        {serverName && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-1 ring-inset ring-blue-200 dark:ring-blue-800">
            {serverName}
          </span>
        )}
        {toolName && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground ring-1 ring-inset ring-border">
            {toolName}
          </span>
        )}
        <div className="ml-auto">
          <ConeyExpandIcon isExpanded={expanded} />
        </div>
      </ConeyCardHeader>
      <ConeyCardContent isExpanded={expanded}>
        <CodeHighlight className="language-json">{prettyJson}</CodeHighlight>
      </ConeyCardContent>
    </ConeyCard>
  );
};
