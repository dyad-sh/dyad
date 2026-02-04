import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Database } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadStateIndicator,
  DyadCardContent,
} from "./DyadCardPrimitives";

interface DyadExecuteSqlProps {
  children?: ReactNode;
  node?: any;
  description?: string;
}

export const DyadExecuteSql: React.FC<DyadExecuteSqlProps> = ({
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
    <DyadCard
      state={state}
      accentColor="teal"
      isExpanded={isContentVisible}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <DyadCardHeader icon={<Database size={15} />} accentColor="teal">
        <DyadBadge color="teal">SQL</DyadBadge>
        {queryDescription && (
          <span className="font-medium text-sm text-foreground truncate">
            {queryDescription}
          </span>
        )}
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel="Executing..." />
        )}
        {aborted && (
          <DyadStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isContentVisible} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isContentVisible}>
        <div className="text-xs">
          <CodeHighlight className="language-sql">{children}</CodeHighlight>
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
