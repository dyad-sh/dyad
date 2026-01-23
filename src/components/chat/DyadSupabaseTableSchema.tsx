import React, { useState } from "react";
import { CustomTagState } from "./stateTypes";
import {
  Table2,
  Loader2,
  CircleX,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";

interface DyadSupabaseTableSchemaProps {
  node: {
    properties: {
      table?: string;
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function DyadSupabaseTableSchema({
  node,
  children,
}: DyadSupabaseTableSchemaProps) {
  const [isContentVisible, setIsContentVisible] = useState(false);
  const { table, state } = node.properties;
  const isLoading = state === "pending";
  const isAborted = state === "aborted";
  const content = typeof children === "string" ? children : "";

  return (
    <div
      className={`bg-(--background-lightest) hover:bg-(--background-lighter) rounded-lg px-4 py-2 border my-2 cursor-pointer ${
        isLoading
          ? "border-amber-500"
          : isAborted
            ? "border-red-500"
            : "border-border"
      }`}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isLoading ? (
            <Loader2 className="size-4 animate-spin text-amber-600" />
          ) : isAborted ? (
            <CircleX className="size-4 text-red-500" />
          ) : (
            <Table2 className="size-4 text-muted-foreground" />
          )}
          <span className="text-gray-700 dark:text-gray-300 font-medium text-sm">
            {table ? `Table Schema: ${table}` : "Supabase Table Schema"}
          </span>
          {isLoading && (
            <span className="text-xs text-amber-600">Fetching...</span>
          )}
          {isAborted && (
            <span className="text-xs text-red-500">Did not finish</span>
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
      {isContentVisible && content && (
        <div className="mt-2 p-3 text-xs font-mono whitespace-pre-wrap max-h-80 overflow-y-auto bg-muted/30 rounded-md">
          {content}
        </div>
      )}
    </div>
  );
}
