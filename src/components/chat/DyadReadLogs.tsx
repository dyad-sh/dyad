import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  FileText,
  Loader,
  CircleX,
} from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";

interface DyadReadLogsProps {
  children?: ReactNode;
  node?: any;
  type?: string;
  level?: string;
}

export const DyadReadLogs: React.FC<DyadReadLogsProps> = ({
  children,
  node,
  type,
  level,
}) => {
  const [isContentVisible, setIsContentVisible] = useState(false);
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const aborted = state === "aborted";

  // Extract filters from node properties or props
  const logType = type || node?.properties?.type || "all";
  const logLevel = level || node?.properties?.level || "all";

  // Build filter description
  const filters: string[] = [];
  if (logType !== "all") filters.push(`type: ${logType}`);
  if (logLevel !== "all") filters.push(`level: ${logLevel}`);

  const filterDescription =
    filters.length > 0 ? ` (${filters.join(", ")})` : "";

  return (
    <div
      className={`bg-(--background-lightest) hover:bg-(--background-lighter) rounded-lg px-4 py-2 border my-2 cursor-pointer ${
        inProgress
          ? "border-(--primary)"
          : aborted
            ? "border-red-500"
            : "border-(--primary)/30"
      }`}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-(--primary)" />
          <span className="text-gray-700 dark:text-gray-300 font-medium text-sm">
            Reading console logs{filterDescription}
          </span>
          {inProgress && (
            <div className="flex items-center text-(--primary) text-xs">
              <Loader size={14} className="mr-1 animate-spin" />
              <span>Reading...</span>
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
        <div className="text-xs">
          <CodeHighlight className="language-log">{children}</CodeHighlight>
        </div>
      )}
    </div>
  );
};
