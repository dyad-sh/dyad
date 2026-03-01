import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Database } from "lucide-react";
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

interface ConeyExecuteSqlProps {
  children?: ReactNode;
  node?: any;
  description?: string;
}

export const ConeyExecuteSql: React.FC<ConeyExecuteSqlProps> = ({
  children,
  node,
  description,
}) => {
  const [isContentVisible, setIsContentVisible] = useState(false);
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const aborted = state === "aborted";
  const queryDescription = description || node?.properties?.description;

  return (
    <ConeyCard
      state={state}
      accentColor="teal"
      isExpanded={isContentVisible}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <ConeyCardHeader icon={<Database size={15} />} accentColor="teal">
        <ConeyBadge color="teal">SQL</ConeyBadge>
        {queryDescription && (
          <span className="font-medium text-sm text-foreground truncate">
            {queryDescription}
          </span>
        )}
        {inProgress && (
          <ConeyStateIndicator state="pending" pendingLabel="Executing..." />
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
          <CodeHighlight className="language-sql">{children}</CodeHighlight>
        </div>
      </ConeyCardContent>
    </ConeyCard>
  );
};
