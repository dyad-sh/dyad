import React, { useState } from "react";
import { CustomTagState } from "./stateTypes";
import { ChevronRight, FolderOpen, Loader2 } from "lucide-react";

interface DyadListFilesProps {
  node: {
    properties: {
      directory?: string;
      recursive?: string;
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function DyadListFiles({ node, children }: DyadListFilesProps) {
  const { directory, recursive, state } = node.properties;
  const isLoading = state === "pending";
  const isRecursive = recursive === "true";
  const content = typeof children === "string" ? children : "";
  const [isExpanded, setIsExpanded] = useState(false);

  const getTitle = () => {
    const parts: string[] = ["List Files"];
    if (directory) {
      parts[0] = `List Files: ${directory}`;
    }
    if (isRecursive) {
      parts.push("(recursive)");
    }
    return parts.join(" ");
  };

  return (
    <div
      data-testid="dyad-list-files"
      className="my-2 border rounded-md overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-3 py-2 bg-muted/50 w-full text-left hover:bg-muted/70 transition-colors"
      >
        <ChevronRight
          className={`size-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
        />
        {isLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <FolderOpen className="size-4 text-muted-foreground" />
        )}
        <span className="font-medium text-sm">{getTitle()}</span>
      </button>
      {isExpanded && content && (
        <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20 border-t">
          {content}
        </div>
      )}
    </div>
  );
}
