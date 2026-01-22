import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Search,
  Loader,
  CircleX,
} from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";

interface DyadGrepProps {
  children?: ReactNode;
  node?: {
    properties?: {
      state?: CustomTagState;
      query?: string;
      include?: string;
      exclude?: string;
      "case-sensitive"?: string;
      count?: string;
    };
  };
}

export const DyadGrep: React.FC<DyadGrepProps> = ({ children, node }) => {
  const [isContentVisible, setIsContentVisible] = useState(false);

  // State handling
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const aborted = state === "aborted";

  // Get properties from node
  const query = node?.properties?.query || "";
  const includePattern = node?.properties?.include || "";
  const excludePattern = node?.properties?.exclude || "";
  const caseSensitive = node?.properties?.["case-sensitive"] === "true";
  const count = node?.properties?.count || "";
  const hasResults = count !== "" && count !== "0";

  // Build description
  let description = `"${query}"`;
  if (includePattern) {
    description += ` in ${includePattern}`;
  }
  if (excludePattern) {
    description += ` excluding ${excludePattern}`;
  }
  if (caseSensitive) {
    description += " (case-sensitive)";
  }

  // Build result summary
  const resultSummary = count
    ? `${count} match${count === "1" ? "" : "es"}`
    : "";

  // Dynamic border styling
  const borderClass = inProgress
    ? "border-(--primary)"
    : aborted
      ? "border-red-500"
      : "border-(--primary)/30";

  return (
    <div
      data-testid="dyad-grep"
      className={`bg-(--background-lightest) hover:bg-(--background-lighter) rounded-lg px-4 py-2 border my-2 cursor-pointer ${borderClass}`}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-(--primary)" />
          <span className="text-gray-700 dark:text-gray-300 font-medium text-sm">
            <span className="font-bold mr-2 outline-2 outline-(--primary)/20 bg-(--primary)/10 text-(--primary) rounded-md px-1">
              GREP
            </span>
            {description}
            {resultSummary && (
              <span className="ml-2 text-gray-500">({resultSummary})</span>
            )}
          </span>
          {inProgress && (
            <div className="flex items-center text-(--primary) text-xs">
              <Loader size={14} className="mr-1 animate-spin" />
              <span>Searching...</span>
            </div>
          )}
          {aborted && (
            <div className="flex items-center text-red-600 text-xs">
              <CircleX size={14} className="mr-1" />
              <span>Did not finish</span>
            </div>
          )}
        </div>
        <div className="flex items-center">
          {isContentVisible ? (
            <ChevronsDownUp
              size={20}
              className="text-(--primary)/70 hover:text-(--primary)"
            />
          ) : (
            <ChevronsUpDown
              size={20}
              className="text-(--primary)/70 hover:text-(--primary)"
            />
          )}
        </div>
      </div>
      {isContentVisible && (
        <div className={`text-xs${hasResults ? " mt-2" : ""}`}>
          <CodeHighlight className="language-log">{children}</CodeHighlight>
        </div>
      )}
    </div>
  );
};
