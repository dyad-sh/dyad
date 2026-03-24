import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Database } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";
import {
  ProteaAICard,
  ProteaAICardHeader,
  ProteaAIBadge,
  ProteaAIExpandIcon,
  ProteaAIStateIndicator,
  ProteaAICardContent,
} from "./ProteaAICardPrimitives";

interface ProteaAIExecuteSqlProps {
  children?: ReactNode;
  node?: any;
  description?: string;
}

export const ProteaAIExecuteSql: React.FC<ProteaAIExecuteSqlProps> = ({
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
    <ProteaAICard
      state={state}
      accentColor="teal"
      isExpanded={isContentVisible}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <ProteaAICardHeader icon={<Database size={15} />} accentColor="teal">
        <ProteaAIBadge color="teal">SQL</ProteaAIBadge>
        {queryDescription && (
          <span className="font-medium text-sm text-foreground truncate">
            {queryDescription}
          </span>
        )}
        {inProgress && (
          <ProteaAIStateIndicator state="pending" pendingLabel="Executing..." />
        )}
        {aborted && (
          <ProteaAIStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        <div className="ml-auto">
          <ProteaAIExpandIcon isExpanded={isContentVisible} />
        </div>
      </ProteaAICardHeader>
      <ProteaAICardContent isExpanded={isContentVisible}>
        <div className="text-xs">
          <CodeHighlight className="language-sql">{children}</CodeHighlight>
        </div>
      </ProteaAICardContent>
    </ProteaAICard>
  );
};
