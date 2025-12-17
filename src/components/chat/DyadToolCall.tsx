import React from "react";
import { Wrench, AlertCircle, CheckCircle } from "lucide-react";

interface DyadToolCallProps {
  node: {
    properties: {
      toolName: string;
      isResult?: boolean;
      isError?: boolean;
    };
  };
  children: React.ReactNode;
}

export function DyadToolCall({ node, children }: DyadToolCallProps) {
  const { toolName, isResult, isError } = node.properties;
  const content = typeof children === "string" ? children : "";

  const Icon = isError ? AlertCircle : isResult ? CheckCircle : Wrench;
  const iconColor = isError
    ? "text-destructive"
    : isResult
      ? "text-green-500"
      : "text-muted-foreground";

  const title = isError
    ? `Tool Error: ${toolName}`
    : isResult
      ? `Tool Result: ${toolName}`
      : `Tool Call: ${toolName}`;

  return (
    <div className="my-2 border rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
        <Icon className={`size-4 ${iconColor}`} />
        <span className="font-medium text-sm">{title}</span>
      </div>
      {content && (
        <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20">
          {content}
        </div>
      )}
    </div>
  );
}
