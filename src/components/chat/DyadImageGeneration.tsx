import type React from "react";
import { useState, type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { CustomTagState } from "./stateTypes";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadStateIndicator,
  DyadCardContent,
} from "./DyadCardPrimitives";

interface DyadImageGenerationProps {
  children?: ReactNode;
  node?: any;
}

export const DyadImageGeneration: React.FC<DyadImageGenerationProps> = ({
  children,
  node,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const prompt = node?.properties?.prompt || "";
  const imagePath = node?.properties?.path || "";
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const aborted = state === "aborted";

  return (
    <DyadCard
      state={state}
      accentColor="violet"
      isExpanded={isExpanded}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <DyadCardHeader icon={<ImageIcon size={15} />} accentColor="violet">
        <DyadBadge color="violet">Image Generation</DyadBadge>
        {!isExpanded && prompt && (
          <span className="text-sm text-muted-foreground italic truncate">
            {prompt}
          </span>
        )}
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel="Generating..." />
        )}
        {aborted && (
          <DyadStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isExpanded} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isExpanded}>
        <div className="text-sm text-muted-foreground space-y-2">
          {prompt && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Prompt:
              </span>
              <div className="italic mt-0.5 text-foreground">{prompt}</div>
            </div>
          )}
          {imagePath && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Saved to:
              </span>
              <div className="mt-0.5 font-mono text-xs text-foreground">
                {imagePath}
              </div>
            </div>
          )}
          {children && <div className="mt-0.5 text-foreground">{children}</div>}
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
