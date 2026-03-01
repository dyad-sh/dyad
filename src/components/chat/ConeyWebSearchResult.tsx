import React, { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { VanillaMarkdownParser } from "./ConeyMarkdownParser";
import { CustomTagState } from "./stateTypes";
import {
  ConeyCard,
  ConeyCardHeader,
  ConeyBadge,
  ConeyExpandIcon,
  ConeyStateIndicator,
  ConeyCardContent,
} from "./ConeyCardPrimitives";

interface ConeyWebSearchResultProps {
  node?: any;
  children?: React.ReactNode;
}

export const ConeyWebSearchResult: React.FC<ConeyWebSearchResultProps> = ({
  children,
  node,
}) => {
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const [isExpanded, setIsExpanded] = useState(inProgress);

  useEffect(() => {
    if (!inProgress && isExpanded) {
      setIsExpanded(false);
    }
  }, [inProgress]);

  return (
    <ConeyCard
      state={state}
      accentColor="blue"
      onClick={() => setIsExpanded(!isExpanded)}
      isExpanded={isExpanded}
    >
      <ConeyCardHeader icon={<Globe size={15} />} accentColor="blue">
        <ConeyBadge color="blue">Web Search Result</ConeyBadge>
        {inProgress && (
          <ConeyStateIndicator state="pending" pendingLabel="Loading..." />
        )}
        <div className="ml-auto">
          <ConeyExpandIcon isExpanded={isExpanded} />
        </div>
      </ConeyCardHeader>
      <ConeyCardContent isExpanded={isExpanded}>
        <div className="text-sm text-muted-foreground">
          {typeof children === "string" ? (
            <VanillaMarkdownParser content={children} />
          ) : (
            children
          )}
        </div>
      </ConeyCardContent>
    </ConeyCard>
  );
};
