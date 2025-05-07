import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Database,
  Loader,
  CircleX,
} from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";

interface DyadExecuteSqlProps {
  children?: ReactNode;
  node?: any;
  description?: string;
}

export const DyadExecuteSql: React.FC<DyadExecuteSqlProps> = ({
  children,
  node,
  description,
}) => {
  const [isContentVisible, setIsContentVisible] = useState(false);
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const aborted = state === "aborted";
  const queryDescription = description || node?.properties?.description;

  return (
    <div
      className={`bg-(--background-lightest) hover:bg-(--background-lighter) rounded-lg px-4 py-2 border my-2 cursor-pointer ${
        inProgress
          ? "border-amber-500"
          : aborted
            ? "border-red-500"
            : "border-border"
      }`}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database size={16} />
          <span className="text-gray-700 dark:text-gray-300 font-medium text-sm">
            <span className="font-bold mr-2 outline-2 outline-gray-200 dark:outline-gray-700 bg-gray-100 dark:bg-gray-800 rounded-md px-1">
              SQL
            </span>
            {queryDescription}
          </span>
          {inProgress && (
            <div className="flex items-center text-amber-600 text-xs">
              <Loader size={14} className="mr-1 animate-spin" />
              <span>Executing...</span>
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
      {isContentVisible && (
        <div className="text-xs">
          <CodeHighlight className="language-sql">{children}</CodeHighlight>
        </div>
      )}
    </div>
  );
};
