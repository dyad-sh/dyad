import React from "react";
import { CustomTagState } from "./stateTypes";

interface DyadMcpToolProps {
  node: {
    properties: {
      tool?: string;
      args?: string;
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export const DyadMcpTool: React.FC<DyadMcpToolProps> = ({ node, children }) => {
  const { tool, args, state } = node.properties;

  let parsedArgs = null;
  if (args) {
    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      parsedArgs = args; // fallback to string if JSON parsing fails
    }
  }

  const getStateIcon = (state?: CustomTagState) => {
    switch (state) {
      case "pending":
        return "⏳";
      case "finished":
        return "✅";
      case "aborted":
        return "❌";
      default:
        return "🔧";
    }
  };

  const getStateColor = (state?: CustomTagState) => {
    switch (state) {
      case "pending":
        return "#fbbf24";
      case "finished":
        return "#10b981";
      case "aborted":
        return "#ef4444";
      default:
        return "#6366f1";
    }
  };

  return (
    <div className="my-4 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-lg"
          style={{ color: getStateColor(state) }}
        >
          {getStateIcon(state)}
        </span>
        <h4 className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">
          MCP Tool Call
        </h4>
      </div>

      <div className="space-y-2">
        {tool && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Tool:
            </span>
            <code className="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">
              {tool}
            </code>
          </div>
        )}

        {parsedArgs && (
          <div className="flex items-start gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mt-1">
              Args:
            </span>
            <pre className="text-xs bg-gray-200 dark:bg-gray-700 p-2 rounded overflow-x-auto flex-1">
              {typeof parsedArgs === 'string'
                ? parsedArgs
                : JSON.stringify(parsedArgs, null, 2)
              }
            </pre>
          </div>
        )}

        {children && (
          <div className="mt-3">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Result:
            </span>
            <div className="mt-1 p-3 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm">
              <div className="whitespace-pre-wrap">{children}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
