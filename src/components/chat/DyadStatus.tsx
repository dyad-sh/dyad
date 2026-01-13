import React, { useState } from "react";
import { CustomTagState } from "./stateTypes";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";

interface DyadStatusProps {
  node: {
    properties: {
      title?: string;
      state?: CustomTagState;
    };
  };
  children?: React.ReactNode;
}

export function DyadStatus({ node, children }: DyadStatusProps) {
  const { title = "Processing...", state } = node.properties;
  const isInProgress = state === "pending";
  const isAborted = state === "aborted";
  const content = typeof children === "string" ? children : "";
  const [isContentVisible, setIsContentVisible] = useState(false);

  return (
    <div
      className={`bg-(--background-lightest) hover:bg-(--background-lighter) rounded-lg px-4 py-2 border my-2 cursor-pointer ${
        isInProgress
          ? "border-amber-500"
          : isAborted
            ? "border-red-500"
            : "border-border"
      }`}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isInProgress ? (
            <Loader2 className="size-4 animate-spin text-amber-600" />
          ) : isAborted ? (
            <XCircle className="size-4 text-red-600" />
          ) : (
            <CheckCircle2 className="size-4 text-green-600 dark:text-green-500" />
          )}
          <span
            className={`font-medium text-sm ${
              isInProgress
                ? "bg-gradient-to-r from-foreground via-muted-foreground to-foreground bg-[length:200%_100%] animate-[shimmer_2s_ease-in-out_infinite] bg-clip-text text-transparent"
                : "text-gray-700 dark:text-gray-300"
            }`}
          >
            {title}
          </span>
        </div>
        <div className="flex items-center">
          {isContentVisible ? (
            <ChevronsDownUp
              size={20}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            />
          ) : (
            <ChevronsUpDown
              size={20}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            />
          )}
        </div>
      </div>
      {isContentVisible && content && (
        <div
          className="mt-2 p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20 rounded cursor-text"
          onClick={(e) => e.stopPropagation()}
        >
          {content}
        </div>
      )}
    </div>
  );
}
