import React, { useMemo, useState } from "react";
import { Wrench, ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";

interface DyadMcpToolCallProps {
  node?: any;
  children?: React.ReactNode;
}

export const DyadMcpToolCall: React.FC<DyadMcpToolCallProps> = ({
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
      console.error("Error parsing JSON for dyad-mcp-tool-call", e);
      return raw;
    }
  }, [expanded, raw]);

  return (
    <div
      className="relative bg-white/5 backdrop-blur-md hover:bg-white/10 rounded-lg px-3 py-2.5 border border-white/10 my-2 cursor-pointer transition-all min-h-[42px]"
      onClick={() => setExpanded((v) => !v)}
    >
      {/* Top-left label badge */}
      <div
        className="absolute top-2.5 left-3 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-blue-400 bg-blue-500/10 backdrop-blur-sm border border-blue-500/20"
        style={{ zIndex: 1 }}
      >
        <Wrench size={12} className="text-blue-400" />
        <span>Tool Call</span>
      </div>

      {/* Right chevron */}
      <div className="absolute top-2.5 right-3 p-1 text-white/40">
        {expanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
      </div>

      {/* Header content */}
      <div className="flex items-center gap-2 pl-24 pr-10 min-h-[26px]">
        {serverName ? (
          <span className="text-[10px] px-2 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
            {serverName}
          </span>
        ) : null}
        {toolName ? (
          <span className="text-[10px] px-2 py-1 rounded-full bg-white/5 text-white/60 border border-white/10 font-medium">
            {toolName}
          </span>
        ) : null}
        {/* Intentionally no preview or content when collapsed */}
      </div>

      {/* JSON content */}
      {expanded ? (
        <div className="mt-3 pr-4 pb-1">
          <CodeHighlight className="language-json">{prettyJson}</CodeHighlight>
        </div>
      ) : null}
    </div>
  );
};
