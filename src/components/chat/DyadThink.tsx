import React, { useState, useEffect } from "react";
import { Brain } from "lucide-react";
import { VanillaMarkdownParser } from "./DyadMarkdownParser";
import { CustomTagState } from "./stateTypes";
import { DyadTokenSavings } from "./DyadTokenSavings";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadStateIndicator,
  DyadCardContent,
} from "./DyadCardPrimitives";

interface DyadThinkProps {
  node?: any;
  children?: React.ReactNode;
}

export const DyadThink: React.FC<DyadThinkProps> = ({ children, node }) => {
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const [isExpanded, setIsExpanded] = useState(inProgress);

  // Check if content matches token savings format
  const tokenSavingsMatch =
    typeof children === "string"
      ? children.match(
          /^dyad-token-savings\?original-tokens=([0-9.]+)&smart-context-tokens=([0-9.]+)$/,
        )
      : null;

  // Collapse when transitioning from in-progress to not-in-progress
  useEffect(() => {
    if (!inProgress && isExpanded) {
      setIsExpanded(false);
    }
  }, [inProgress]);

  // If it's token savings format, render DyadTokenSavings component
  if (tokenSavingsMatch) {
    const originalTokens = parseFloat(tokenSavingsMatch[1]);
    const smartContextTokens = parseFloat(tokenSavingsMatch[2]);
    return (
      <DyadTokenSavings
        originalTokens={originalTokens}
        smartContextTokens={smartContextTokens}
      />
    );
  }

  return (
    <DyadCard
      state={state}
      accentColor="purple"
      isExpanded={isExpanded}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <DyadCardHeader icon={<Brain size={15} />} accentColor="purple">
        <DyadBadge color="purple">Thinking</DyadBadge>
        {inProgress && <DyadStateIndicator state="pending" />}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isExpanded} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isExpanded}>
        <div className="text-sm text-muted-foreground">
          {typeof children === "string" ? (
            <VanillaMarkdownParser content={children} />
          ) : (
            children
          )}
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
