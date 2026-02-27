import React from "react";
import { CustomTagState } from "./stateTypes";
import {
  DyadCard,
  DyadCardHeader,
  DyadCardContent,
} from "./DyadCardPrimitives";
import { PauseCircle, ChevronRight } from "lucide-react";

interface DyadStepLimitProps {
  node: {
    properties: {
      steps?: string;
      limit?: string;
      state?: CustomTagState;
    };
  };
  children?: React.ReactNode;
}

export function DyadStepLimit({ node, children }: DyadStepLimitProps) {
  const { steps = "50", limit: _limit = "50", state } = node.properties;
  const isFinished = state === "finished";
  const content = typeof children === "string" ? children : "";

  return (
    <DyadCard state={state} accentColor="amber" isExpanded={true}>
      <DyadCardHeader icon={<PauseCircle size={15} />} accentColor="amber">
        <span className="font-medium text-sm text-foreground">
          Paused after {steps} tool calls
        </span>
        {isFinished && (
          <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <span>Send "continue" to resume</span>
            <ChevronRight size={14} />
          </div>
        )}
      </DyadCardHeader>
      <DyadCardContent isExpanded={true}>
        {content && (
          <div className="p-3 text-sm text-muted-foreground">{content}</div>
        )}
      </DyadCardContent>
    </DyadCard>
  );
}
