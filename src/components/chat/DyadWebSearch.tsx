import type React from "react";
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Globe, Loader } from "lucide-react";
import { CustomTagState } from "./stateTypes";

interface DyadWebSearchProps {
  children?: ReactNode;
  node?: any;
}

export const DyadWebSearch: React.FC<DyadWebSearchProps> = ({
  children,
  node,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const query =
    node?.properties?.query || (typeof children === "string" ? children : "");
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";

  return (
    <div
      className={`bg-(--background-lightest) dark:bg-zinc-900 hover:bg-(--background-lighter) rounded-lg px-4 py-2 border my-2 cursor-pointer ${
        inProgress ? "border-blue-500" : "border-border"
      }`}
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-blue-600" />
          <div className="text-xs text-blue-600 font-medium">Web Search</div>
          {inProgress && (
            <div className="flex items-center text-blue-600 text-xs">
              <Loader size={14} className="mr-1 animate-spin" />
              <span>Searching...</span>
            </div>
          )}
        </div>
        <div className="p-1 text-gray-500">
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Collapsed preview - show query */}
      <div
        className="text-sm italic text-gray-600 dark:text-gray-300 mt-2 overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isExpanded ? "0px" : "3em",
          opacity: isExpanded ? 0 : 1,
        }}
      >
        {query}
      </div>

      {/* Expanded content */}
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isExpanded ? "none" : "0px",
          opacity: isExpanded ? 1 : 0,
          marginTop: isExpanded ? "0.5rem" : "0",
        }}
      >
        <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2">
          {query && (
            <div>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Query:
              </span>
              <div className="italic mt-0.5">{query}</div>
            </div>
          )}
          {children && (
            <div>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Results:
              </span>
              <div className="mt-0.5">{children}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
