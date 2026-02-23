import React, { useState } from "react";
import { Terminal, ChevronDown, ChevronRight } from "lucide-react";
import { CustomTagState } from "./stateTypes";

interface JoyRunCommandProps {
  command: string;
  directory?: string;
  state: CustomTagState;
  children?: React.ReactNode;
}

/**
 * Renders the output of a `run_command` tool invocation in the chat stream.
 * Shows the command that was executed with a terminal-like appearance,
 * and optionally expands to show stdout/stderr captured in `children`.
 */
export const JoyRunCommand: React.FC<JoyRunCommandProps> = ({
  command,
  directory,
  state,
  children,
}) => {
  const [expanded, setExpanded] = useState(false);
  const isRunning = state === "pending";

  return (
    <div className="my-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 overflow-hidden text-sm">
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <Terminal size={14} className="text-green-500 shrink-0" />
        <code className="flex-1 text-left font-mono text-xs text-gray-800 dark:text-gray-200 truncate">
          {command}
        </code>
        {directory && (
          <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">
            in {directory}
          </span>
        )}
        {isRunning && (
          <span className="ml-auto text-[10px] text-yellow-600 dark:text-yellow-400 animate-pulse shrink-0">
            running…
          </span>
        )}
        {expanded ? (
          <ChevronDown size={14} className="text-gray-400 shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-gray-400 shrink-0" />
        )}
      </button>

      {/* Output area */}
      {expanded && children && (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-black/90 px-3 py-2 max-h-64 overflow-auto">
          <pre className="whitespace-pre-wrap font-mono text-xs text-green-300">
            {children}
          </pre>
        </div>
      )}
    </div>
  );
};
