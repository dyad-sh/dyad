import React, { useState } from "react";
import { CustomTagState } from "./stateTypes";
import {
  ConeyCard,
  ConeyCardHeader,
  ConeyExpandIcon,
  ConeyFinishedIcon,
  ConeyCardContent,
} from "./ConeyCardPrimitives";
import { CircleX, Loader2 } from "lucide-react";

interface ConeyStatusProps {
  node: {
    properties: {
      title?: string;
      state?: CustomTagState;
    };
  };
  children?: React.ReactNode;
}

export function ConeyStatus({ node, children }: ConeyStatusProps) {
  const { title = "Processing...", state } = node.properties;
  const isInProgress = state === "pending";
  const isAborted = state === "aborted";
  const isFinished = state === "finished";
  const content = typeof children === "string" ? children : "";
  const [isContentVisible, setIsContentVisible] = useState(false);

  // Pick accent color based on state
  const accentColor = isAborted ? "red" : isInProgress ? "amber" : "green";

  // Pick the left icon based on state
  const icon = isInProgress ? (
    <Loader2 size={15} className="animate-spin" />
  ) : isAborted ? (
    <CircleX size={15} />
  ) : (
    <ConeyFinishedIcon />
  );

  return (
    <ConeyCard
      state={state}
      accentColor={accentColor}
      isExpanded={isContentVisible}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <ConeyCardHeader icon={icon} accentColor={accentColor}>
        <span
          className={`font-medium text-sm ${
            isInProgress
              ? "bg-gradient-to-r from-foreground via-muted-foreground to-foreground bg-[length:200%_100%] animate-[shimmer_2s_ease-in-out_infinite] bg-clip-text text-transparent"
              : isFinished
                ? "text-foreground"
                : "text-muted-foreground"
          }`}
        >
          {title}
        </span>
        <div className="ml-auto">
          <ConeyExpandIcon isExpanded={isContentVisible} />
        </div>
      </ConeyCardHeader>
      <ConeyCardContent isExpanded={isContentVisible}>
        {content && (
          <div
            className="p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20 rounded-lg cursor-text"
            onClick={(e) => e.stopPropagation()}
          >
            {content}
          </div>
        )}
      </ConeyCardContent>
    </ConeyCard>
  );
}
