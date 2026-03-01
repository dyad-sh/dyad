import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import { FileText } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";
import {
  ConeyCard,
  ConeyCardHeader,
  ConeyBadge,
  ConeyExpandIcon,
  ConeyStateIndicator,
  ConeyCardContent,
} from "./ConeyCardPrimitives";

interface ConeyLogsProps {
  children?: ReactNode;
  node?: any;
}

export const ConeyLogs: React.FC<ConeyLogsProps> = ({ children, node }) => {
  const [isContentVisible, setIsContentVisible] = useState(false);

  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const aborted = state === "aborted";

  const logCount = node?.properties?.count || "";
  const hasResults = !!logCount;

  const logType = node?.properties?.type || "all";
  const logLevel = node?.properties?.level || "all";
  const filters: string[] = [];
  if (logType !== "all") filters.push(`type: ${logType}`);
  if (logLevel !== "all") filters.push(`level: ${logLevel}`);
  const filterDesc = filters.length > 0 ? ` (${filters.join(", ")})` : "";

  const displayText = `Reading ${hasResults ? `${logCount} ` : ""}logs${filterDesc}`;

  return (
    <ConeyCard
      state={state}
      accentColor="slate"
      isExpanded={isContentVisible}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <ConeyCardHeader icon={<FileText size={15} />} accentColor="slate">
        <ConeyBadge color="slate">LOGS</ConeyBadge>
        <span className="font-medium text-sm text-foreground truncate">
          {displayText}
        </span>
        {inProgress && (
          <ConeyStateIndicator state="pending" pendingLabel="Reading..." />
        )}
        {aborted && (
          <ConeyStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        <div className="ml-auto">
          <ConeyExpandIcon isExpanded={isContentVisible} />
        </div>
      </ConeyCardHeader>
      <ConeyCardContent isExpanded={isContentVisible}>
        <div className="text-xs">
          <CodeHighlight className="language-log">{children}</CodeHighlight>
        </div>
      </ConeyCardContent>
    </ConeyCard>
  );
};
