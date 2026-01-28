import React, { useState } from "react";
import { FileText, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { VanillaMarkdownParser } from "./DyadMarkdownParser";
import { CustomTagState } from "./stateTypes";

interface DyadWritePlanProps {
  node: {
    properties: {
      title: string;
      summary?: string;
      complete?: string;
      state?: CustomTagState;
    };
  };
  children?: React.ReactNode;
}

export const DyadWritePlan: React.FC<DyadWritePlanProps> = ({
  node,
  children,
}) => {
  const { title, summary, complete, state } = node.properties;
  const content = typeof children === "string" ? children : "";
  const [isExpanded, setIsExpanded] = useState(true);
  // Consider in progress if state is pending OR complete is explicitly "false"
  const isInProgress = state === "pending" || complete === "false";

  return (
    <div
      className={`my-4 border rounded-lg overflow-hidden ${
        isInProgress
          ? "border-blue-400 dark:border-blue-600"
          : "border-blue-200 dark:border-blue-800"
      } bg-blue-50/50 dark:bg-blue-900/10`}
    >
      <div
        className="px-4 py-3 border-b border-blue-200 dark:border-blue-800 cursor-pointer hover:bg-blue-100/50 dark:hover:bg-blue-900/20 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText
              className={`text-blue-500 ${isInProgress ? "animate-pulse" : ""}`}
              size={20}
            />
            <span className="font-semibold text-blue-900 dark:text-blue-100">
              {title}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isInProgress && (
              <span className="text-xs text-blue-600 dark:text-blue-400 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 rounded-full">
                Writing...
              </span>
            )}
            {isExpanded ? (
              <ChevronsDownUp
                size={20}
                className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
              />
            ) : (
              <ChevronsUpDown
                size={20}
                className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
              />
            )}
          </div>
        </div>
        {summary && (
          <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
            {summary}
          </p>
        )}
      </div>
      {isExpanded && content && (
        <div className="p-4">
          <div className="prose dark:prose-invert prose-sm max-w-none prose-headings:text-blue-900 dark:prose-headings:text-blue-100 prose-a:text-blue-600 dark:prose-a:text-blue-400">
            <VanillaMarkdownParser content={content} />
          </div>
        </div>
      )}
    </div>
  );
};
