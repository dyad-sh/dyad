import React, { useState } from "react";
import { CustomTagState } from "./stateTypes";
import { FolderOpen } from "lucide-react";
import {
  ConeyCard,
  ConeyCardHeader,
  ConeyBadge,
  ConeyExpandIcon,
  ConeyStateIndicator,
  ConeyCardContent,
} from "./ConeyCardPrimitives";

interface ConeyListFilesProps {
  node: {
    properties: {
      directory?: string;
      recursive?: string;
      include_hidden?: string;
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function ConeyListFiles({ node, children }: ConeyListFilesProps) {
  const { directory, recursive, include_hidden, state } = node.properties;
  const isLoading = state === "pending";
  const isRecursive = recursive === "true";
  const isIncludeHidden = include_hidden === "true";
  const content = typeof children === "string" ? children : "";
  const [isExpanded, setIsExpanded] = useState(false);

  const title = directory ? directory : "List Files";

  return (
    <ConeyCard
      state={state}
      accentColor="slate"
      isExpanded={isExpanded}
      onClick={() => setIsExpanded(!isExpanded)}
      data-testid="coney-list-files"
    >
      <ConeyCardHeader icon={<FolderOpen size={15} />} accentColor="slate">
        <span className="font-medium text-sm text-foreground truncate">
          {title}
        </span>
        {isRecursive && <ConeyBadge color="slate">recursive</ConeyBadge>}
        {isIncludeHidden && <ConeyBadge color="slate">include hidden</ConeyBadge>}
        {isLoading && (
          <ConeyStateIndicator state="pending" pendingLabel="Listing..." />
        )}
        <div className="ml-auto">
          <ConeyExpandIcon isExpanded={isExpanded} />
        </div>
      </ConeyCardHeader>
      <ConeyCardContent isExpanded={isExpanded}>
        {content && (
          <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20 rounded-lg">
            {content}
          </div>
        )}
      </ConeyCardContent>
    </ConeyCard>
  );
}
