import type React from "react";
import { useState, type ReactNode } from "react";
import { FileCode } from "lucide-react";
import { CustomTagState } from "./stateTypes";
import {
  ConeyCard,
  ConeyCardHeader,
  ConeyBadge,
  ConeyExpandIcon,
  ConeyStateIndicator,
  ConeyCardContent,
} from "./ConeyCardPrimitives";

interface ConeyCodeSearchProps {
  children?: ReactNode;
  node?: { properties?: { query?: string; state?: CustomTagState } };
}

export const ConeyCodeSearch: React.FC<ConeyCodeSearchProps> = ({
  children,
  node,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const query =
    node?.properties?.query || (typeof children === "string" ? children : "");
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";

  return (
    <ConeyCard
      state={state}
      accentColor="indigo"
      onClick={() => setIsExpanded(!isExpanded)}
      isExpanded={isExpanded}
    >
      <ConeyCardHeader icon={<FileCode size={15} />} accentColor="indigo">
        <ConeyBadge color="indigo">Code Search</ConeyBadge>
        {!isExpanded && query && (
          <span className="text-sm text-muted-foreground italic truncate">
            {query}
          </span>
        )}
        {inProgress && (
          <ConeyStateIndicator state="pending" pendingLabel="Searching..." />
        )}
        <div className="ml-auto">
          <ConeyExpandIcon isExpanded={isExpanded} />
        </div>
      </ConeyCardHeader>
      <ConeyCardContent isExpanded={isExpanded}>
        <div className="text-sm text-muted-foreground space-y-2">
          {query && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Query:
              </span>
              <div className="italic mt-0.5 text-foreground">{query}</div>
            </div>
          )}
          {children && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Results:
              </span>
              <div className="mt-0.5 whitespace-pre-wrap font-mono text-xs text-foreground">
                {children}
              </div>
            </div>
          )}
        </div>
      </ConeyCardContent>
    </ConeyCard>
  );
};
