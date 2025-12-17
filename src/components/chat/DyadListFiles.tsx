import React from "react";
import { CustomTagState } from "./stateTypes";
import { FolderOpen, Loader2 } from "lucide-react";

interface DyadListFilesProps {
  node: {
    properties: {
      directory?: string;
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function DyadListFiles({ node, children }: DyadListFilesProps) {
  const { directory, state } = node.properties;
  const isLoading = state === "pending";
  const content = typeof children === "string" ? children : "";

  return (
    <div className="my-2 border rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
        {isLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <FolderOpen className="size-4 text-muted-foreground" />
        )}
        <span className="font-medium text-sm">
          {directory ? `List Files: ${directory}` : "List Files"}
        </span>
      </div>
      {content && (
        <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20">
          {content}
        </div>
      )}
    </div>
  );
}
