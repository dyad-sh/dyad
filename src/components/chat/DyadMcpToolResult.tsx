import React, { useMemo, useState } from "react";
import { CheckCircle, ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";

interface DyadMcpToolResultProps {
  node?: any;
  children?: React.ReactNode;
}

export const DyadMcpToolResult: React.FC<DyadMcpToolResultProps> = ({
  node,
  children,
}) => {
  const serverName: string = node?.properties?.serverName || "";
  const toolName: string = node?.properties?.toolName || "";
  const [expanded, setExpanded] = useState(false);

  const raw = typeof children === "string" ? children : String(children ?? "");

  const prettyJson = useMemo(() => {
    if (!expanded) return "";
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch (e) {
      console.error("Error parsing JSON for dyad-mcp-tool-result", e);
      return raw;
    }
  }, [expanded, raw]);

  return (
    <div
      className="relative bg-(--background-lightest) hover:bg-(--background-lighter) rounded-lg px-4 py-2 border my-2 cursor-pointer"
      onClick={() => setExpanded((v) => !v)}
    >
      {/* Top-left label badge */}
      <div
        className="absolute top-3 left-2 flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold text-emerald-600 bg-white dark:bg-zinc-900"
        style={{ zIndex: 1 }}
      >
        <CheckCircle size={16} className="text-emerald-600" />
        <span>Tool Result</span>
      </div>

      {/* Right chevron */}
      <div className="absolute top-2 right-2 p-1 text-gray-500">
        {expanded ? <ChevronsDownUp size={18} /> : <ChevronsUpDown size={18} />}
      </div>

      {/* Header content */}
      <div className="flex items-start gap-2 pl-24 pr-8 py-1">
        {serverName ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-zinc-800 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-zinc-700">
            {serverName}
          </span>
        ) : null}
        {toolName ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-200 border border-border">
            {toolName}
          </span>
        ) : null}
        {/* Intentionally no preview or content when collapsed */}
      </div>

      {/* JSON content */}
      {expanded ? (
        <div className="mt-2 pr-4 pb-2">
          <CodeHighlight className="language-json">{prettyJson}</CodeHighlight>
        </div>
      ) : null}
    </div>
  );
};
