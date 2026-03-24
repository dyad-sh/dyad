import React, { useState } from "react";
import { CustomTagState } from "./stateTypes";
import { FolderOpen } from "lucide-react";
import {
  ProteaAICard,
  ProteaAICardHeader,
  ProteaAIBadge,
  ProteaAIExpandIcon,
  ProteaAIStateIndicator,
  ProteaAICardContent,
} from "./ProteaAICardPrimitives";

interface ProteaAIListFilesProps {
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

export function ProteaAIListFiles({ node, children }: ProteaAIListFilesProps) {
  const { directory, recursive, include_hidden, state } = node.properties;
  const isLoading = state === "pending";
  const isRecursive = recursive === "true";
  const isIncludeHidden = include_hidden === "true";
  const content = typeof children === "string" ? children : "";
  const [isExpanded, setIsExpanded] = useState(false);

  const title = directory ? directory : "List Files";

  return (
    <ProteaAICard
      state={state}
      accentColor="slate"
      isExpanded={isExpanded}
      onClick={() => setIsExpanded(!isExpanded)}
      data-testid="proteaai-list-files"
    >
      <ProteaAICardHeader icon={<FolderOpen size={15} />} accentColor="slate">
        <span className="font-medium text-sm text-foreground truncate">
          {title}
        </span>
        {isRecursive && <ProteaAIBadge color="slate">recursive</ProteaAIBadge>}
        {isIncludeHidden && <ProteaAIBadge color="slate">include hidden</ProteaAIBadge>}
        {isLoading && (
          <ProteaAIStateIndicator state="pending" pendingLabel="Listing..." />
        )}
        <div className="ml-auto">
          <ProteaAIExpandIcon isExpanded={isExpanded} />
        </div>
      </ProteaAICardHeader>
      <ProteaAICardContent isExpanded={isExpanded}>
        {content && (
          <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20 rounded-lg">
            {content}
          </div>
        )}
      </ProteaAICardContent>
    </ProteaAICard>
  );
}
