import React, { useState } from "react";
import { Package, ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { CustomTagState } from "./stateTypes";

interface JoyPackageDatasetProps {
  dataset: string;
  name?: string;
  status?: string;
  bundle?: string;
  state: CustomTagState;
  children?: React.ReactNode;
}

/**
 * Renders the result of a `package_dataset` tool invocation in the chat stream.
 */
export const JoyPackageDataset: React.FC<JoyPackageDatasetProps> = ({
  dataset,
  name,
  status,
  bundle,
  state,
  children,
}) => {
  const [expanded, setExpanded] = useState(false);
  const isRunning = state === "pending";
  const isDone = state === "finished";
  const isFailed = state === "aborted";

  return (
    <div className="my-2 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 overflow-hidden text-sm">
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <Package size={14} className="text-emerald-500 shrink-0" />
        <span className="flex-1 text-left text-xs text-gray-800 dark:text-gray-200 truncate">
          <span className="font-medium">Package</span>{" "}
          <span className="font-mono text-emerald-600 dark:text-emerald-400">
            {name || dataset}
          </span>
        </span>
        {status && (
          <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">
            {status}
          </span>
        )}
        {isRunning && (
          <Loader2 size={12} className="text-emerald-500 animate-spin shrink-0" />
        )}
        {isDone && (
          <CheckCircle2 size={12} className="text-green-500 shrink-0" />
        )}
        {isFailed && (
          <XCircle size={12} className="text-red-500 shrink-0" />
        )}
        {expanded ? (
          <ChevronDown size={14} className="text-gray-400 shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-gray-400 shrink-0" />
        )}
      </button>

      {/* Meta row */}
      {bundle && (
        <div className="flex items-center gap-3 px-3 py-1 text-[10px] text-gray-500 dark:text-gray-400 border-t border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
          <span>Bundle: {bundle}</span>
        </div>
      )}

      {/* Output area */}
      {expanded && children && (
        <div className="border-t border-emerald-200 dark:border-emerald-700 bg-black/90 px-3 py-2 max-h-64 overflow-auto">
          <pre className="whitespace-pre-wrap font-mono text-xs text-emerald-300">
            {children}
          </pre>
        </div>
      )}
    </div>
  );
};
