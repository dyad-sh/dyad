import React, { useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CodeHighlight } from "./CodeHighlight";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadCardContent,
} from "./DyadCardPrimitives";

interface DyadMcpToolCallProps {
  node?: any;
  children?: React.ReactNode;
}

export const DyadMcpToolCall: React.FC<DyadMcpToolCallProps> = ({
  node,
  children,
}) => {
  const { t } = useTranslation("chat");
  const serverName: string = node?.properties?.serverName || "";
  const toolName: string = node?.properties?.toolName || "";
  const autoApprovedReason: string = node?.properties?.autoApprovedReason || "";
  const [expanded, setExpanded] = useState(false);

  const raw = typeof children === "string" ? children : String(children ?? "");

  const prettyJson = useMemo(() => {
    if (!expanded) return "";
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch (e) {
      console.error("Error parsing JSON for dyad-mcp-tool-call", e);
      return raw;
    }
  }, [expanded, raw]);

  return (
    <DyadCard
      accentColor="blue"
      isExpanded={expanded}
      onClick={() => setExpanded((v) => !v)}
    >
      <DyadCardHeader icon={<Wrench size={15} />} accentColor="blue">
        <DyadBadge color="blue">Tool Call</DyadBadge>
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
        {autoApprovedReason && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 ring-1 ring-inset ring-green-200 dark:ring-green-800 flex-shrink-0">
            {t("autoApproved")}
          </span>
        )}
        <div className="ml-auto flex-shrink-0">
          <DyadExpandIcon isExpanded={expanded} />
        </div>
      </DyadCardHeader>
      {autoApprovedReason && (
        <div className="px-3 pb-2 -mt-1 text-xs text-green-700 dark:text-green-300 whitespace-pre-wrap break-words">
          {autoApprovedReason}
        </div>
      )}
      <DyadCardContent isExpanded={expanded}>
        <CodeHighlight className="language-json">{prettyJson}</CodeHighlight>
      </DyadCardContent>
    </DyadCard>
  );
};
