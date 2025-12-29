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

type LogsVariant = "read-logs" | "results";

interface DyadLogsProps {
  children?: ReactNode;
  node?: any;
  variant: LogsVariant;
  // For "read-logs" variant
  type?: string;
  level?: string;
  // For "results" variant
  count?: string;
}

export const DyadLogs: React.FC<DyadLogsProps> = ({
  children,
  node,
  variant,
  type,
  level,
  count,
}) => {
  const [isContentVisible, setIsContentVisible] = useState(false);

  // State handling (only for read-logs variant)
  const state = node?.properties?.state as CustomTagState;
  const inProgress = variant === "read-logs" && state === "pending";
  const aborted = variant === "read-logs" && state === "aborted";

  // Build description based on variant
  let description = "";
  if (variant === "read-logs") {
    const logType = type || node?.properties?.type || "all";
    const logLevel = level || node?.properties?.level || "all";
    const filters: string[] = [];
    if (logType !== "all") filters.push(`type: ${logType}`);
    if (logLevel !== "all") filters.push(`level: ${logLevel}`);
    description = filters.length > 0 ? ` (${filters.join(", ")})` : "";
  } else {
    const logCount = count || node?.properties?.count || "";
    description = logCount ? ` (${logCount} logs)` : "";
  }

  // Dynamic border styling
  const borderClass = inProgress
    ? "border-(--primary)"
    : aborted
      ? "border-red-500"
      : "border-(--primary)/30";

  return (
    <div
      className={`bg-(--background-lightest) hover:bg-(--background-lighter) rounded-lg px-4 py-2 border my-2 cursor-pointer ${borderClass}`}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-(--primary)" />
          <span className="text-gray-700 dark:text-gray-300 font-medium text-sm">
            {variant === "results" && (
              <span className="font-bold mr-2 outline-2 outline-(--primary)/20 bg-(--primary)/10 text-(--primary) rounded-md px-1">
                LOGS
              </span>
            )}
            {variant === "read-logs"
              ? `Reading console logs${description}`
              : `Console logs Results${description}`}
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
        <div className={`text-xs${variant === "results" ? " mt-2" : ""}`}>
          <CodeHighlight className="language-log">{children}</CodeHighlight>
        </div>
      )}
    </div>
  );
};
