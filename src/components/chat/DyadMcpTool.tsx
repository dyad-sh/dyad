import React, { useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadCardContent,
  DyadStateIndicator,
} from "./DyadCardPrimitives";
import { CustomTagState } from "./stateTypes";

interface DyadMcpToolProps {
  serverName: string;
  toolName: string;
  /** Raw JSON string of the tool input. */
  callContent: string;
  /** Raw result string, or undefined while the call is still pending. */
  resultContent?: string;
  state: CustomTagState;
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * Single card combining an MCP tool call with its result. The call and
 * result arrive as two separate streamed blocks (paired by call-id in
 * DyadMarkdownParser); this renders them as one unit with a spinner while
 * the result is outstanding.
 */
export const DyadMcpTool: React.FC<DyadMcpToolProps> = ({
  serverName,
  toolName,
  callContent,
  resultContent,
  state,
}) => {
  const [expanded, setExpanded] = useState(false);

  const prettyInput = useMemo(
    () => (expanded ? prettyJson(callContent) : ""),
    [expanded, callContent],
  );
  const prettyResult = useMemo(
    () =>
      expanded && resultContent !== undefined ? prettyJson(resultContent) : "",
    [expanded, resultContent],
  );

  return (
    <DyadCard
      accentColor="blue"
      state={state}
      isExpanded={expanded}
      onClick={() => setExpanded((v) => !v)}
    >
      <DyadCardHeader icon={<Wrench size={15} />} accentColor="blue">
        <DyadBadge color="blue">Tool</DyadBadge>
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
        <div className="ml-auto flex items-center gap-2">
          <DyadStateIndicator
            state={state}
            pendingLabel="Running"
            abortedLabel="No result"
          />
          <DyadExpandIcon isExpanded={expanded} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={expanded}>
        <div className="text-[11px] font-semibold text-muted-foreground mb-1">
          Input
        </div>
        <CodeHighlight className="language-json">{prettyInput}</CodeHighlight>
        <div className="text-[11px] font-semibold text-muted-foreground mt-3 mb-1">
          Result
        </div>
        {resultContent !== undefined ? (
          <CodeHighlight className="language-json">
            {prettyResult}
          </CodeHighlight>
        ) : (
          <div className="text-xs text-muted-foreground italic">
            {state === "aborted" ? "No result." : "Running…"}
          </div>
        )}
      </DyadCardContent>
    </DyadCard>
  );
};
