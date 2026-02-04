import React, { useState } from "react";
import { CustomTagState } from "./stateTypes";
import { FolderOpen } from "lucide-react";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadStateIndicator,
  DyadCardContent,
} from "./DyadCardPrimitives";

interface DyadListFilesProps {
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

export function DyadListFiles({ node, children }: DyadListFilesProps) {
  const { directory, recursive, include_hidden, state } = node.properties;
  const isLoading = state === "pending";
  const isRecursive = recursive === "true";
  const isIncludeHidden = include_hidden === "true";
  const content = typeof children === "string" ? children : "";
  const [isExpanded, setIsExpanded] = useState(false);

  const title = directory ? directory : "List Files";

  return (
    <DyadCard
      state={state}
      accentColor="slate"
      isExpanded={isExpanded}
      onClick={() => setIsExpanded(!isExpanded)}
      data-testid="dyad-list-files"
    >
      <DyadCardHeader icon={<FolderOpen size={15} />} accentColor="slate">
        <span className="font-medium text-sm text-foreground truncate">
          {title}
        </span>
        {isRecursive && <DyadBadge color="slate">recursive</DyadBadge>}
        {isIncludeHidden && <DyadBadge color="slate">include hidden</DyadBadge>}
        {isLoading && (
          <DyadStateIndicator state="pending" pendingLabel="Listing..." />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isExpanded} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isExpanded}>
        {content && (
          <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20 rounded-lg">
            {content}
          </div>
        )}
      </DyadCardContent>
    </DyadCard>
  );
}
