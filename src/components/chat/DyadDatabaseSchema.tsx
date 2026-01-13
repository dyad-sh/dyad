import React from "react";
import { CustomTagState } from "./stateTypes";
import { Database, Loader2 } from "lucide-react";

interface DyadDatabaseSchemaProps {
  node: {
    properties: {
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function DyadDatabaseSchema({
  node,
  children,
}: DyadDatabaseSchemaProps) {
  const { state } = node.properties;
  const isLoading = state === "pending";
  const content = typeof children === "string" ? children : "";

  return (
    <div className="my-2 border rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
        {isLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <Database className="size-4 text-muted-foreground" />
        )}
        <span className="font-medium text-sm">Database Schema</span>
      </div>
      {content && (
        <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20">
          {content}
        </div>
      )}
    </div>
  );
}
