import React, { useState, useEffect } from "react";
import { Layers, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { VanillaMarkdownParser } from "./DyadMarkdownParser";
import { CustomTagState } from "./stateTypes";

interface DyadCompactionProps {
  node: {
    properties: {
      title?: string;
      state?: CustomTagState;
    };
  };
  children?: React.ReactNode;
}

export const DyadCompaction: React.FC<DyadCompactionProps> = ({
  children,
  node,
}) => {
  const { title = "Compacting conversation", state } = node.properties;
  const inProgress = state === "pending";
  const [isExpanded, setIsExpanded] = useState(true);

  // Auto-collapse when compaction finishes
  useEffect(() => {
    if (!inProgress && isExpanded) {
      // Small delay so the user can see the final state before collapsing
      const timer = setTimeout(() => setIsExpanded(false), 600);
      return () => clearTimeout(timer);
    }
  }, [inProgress]);

  const content = typeof children === "string" ? children : "";

  return (
    <div
      className={`relative rounded-lg border my-2 overflow-hidden transition-colors duration-300 ${
        inProgress
          ? "border-blue-400/60 dark:border-blue-500/50 bg-blue-50/50 dark:bg-blue-950/30"
          : "border-border bg-(--background-lightest) dark:bg-zinc-900"
      }`}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-blue-50/30 dark:hover:bg-blue-950/20 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        <div className="flex items-center gap-2">
          {inProgress ? (
            <Loader2 className="size-4 animate-spin text-blue-500" />
          ) : (
            <Layers className="size-4 text-blue-500 dark:text-blue-400" />
          )}
          <span
            className={`font-medium text-sm ${
              inProgress
                ? "bg-gradient-to-r from-blue-600 via-blue-400 to-blue-600 dark:from-blue-400 dark:via-blue-300 dark:to-blue-400 bg-[length:200%_100%] animate-[shimmer_2s_ease-in-out_infinite] bg-clip-text text-transparent"
                : "text-gray-700 dark:text-gray-300"
            }`}
          >
            {title}
          </span>
        </div>
        <div className="text-gray-400 dark:text-gray-500">
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Content area with smooth transition */}
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isExpanded ? "400px" : "0px",
          opacity: isExpanded ? 1 : 0,
        }}
      >
        <div className="px-4 pb-3 text-sm text-gray-600 dark:text-gray-300 max-h-[360px] overflow-y-auto">
          {content ? (
            <VanillaMarkdownParser content={content} />
          ) : inProgress ? (
            <span className="text-xs text-gray-400 italic">
              Generating summary...
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
