import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, FileText } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";

interface DyadLogsResultsProps {
  children?: ReactNode;
  node?: any;
  count?: string;
}

export const DyadLogsResults: React.FC<DyadLogsResultsProps> = ({
  children,
  node,
  count,
}) => {
  const [isContentVisible, setIsContentVisible] = useState(false);

  // Extract count from node properties or props
  const logCount = count || node?.properties?.count || "";

  const countDescription = logCount ? ` (${logCount} logs)` : "";

  return (
    <div
      className="bg-(--background-lightest) hover:bg-(--background-lighter) rounded-lg px-4 py-2 border border-(--primary)/30 my-2 cursor-pointer"
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-(--primary)" />
          <span className="text-gray-700 dark:text-gray-300 font-medium text-sm">
            <span className="font-bold mr-2 outline-2 outline-(--primary)/20 bg-(--primary)/10 text-(--primary) rounded-md px-1">
              LOGS
            </span>
            Console logs Results{countDescription}
          </span>
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
        <div className="text-xs mt-2">
          <CodeHighlight className="language-log">{children}</CodeHighlight>
        </div>
      )}
    </div>
  );
};
