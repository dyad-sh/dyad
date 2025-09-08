import React, { useMemo, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, CircleX, Loader, Server, Wrench } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";

interface DyadMcpCallProps {
  children?: React.ReactNode;
  node?: any;
}

function truncate(text: string, max = 200): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function tryJsonParse(input: string): any | undefined {
  try {
    return JSON.parse(input);
  } catch {
    // Some servers may pretty-print multiple JSON fragments; try last JSON object
    const lastBrace = input.lastIndexOf("}");
    const firstBrace = input.indexOf("{");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(input.slice(firstBrace, lastBrace + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function hostname(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const h = new URL(url).hostname;
    return h.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function collectTitles(items: any[], max = 3): string[] {
  const titles: string[] = [];
  for (const it of items) {
    const t = it?.title || it?.name || hostname(it?.url || it?.link) || it?.id;
    if (t) titles.push(String(t));
    if (titles.length >= max) break;
  }
  return titles;
}

function summarizeMcpPayload(raw: string): string | undefined {
  const data = tryJsonParse(raw);
  if (!data) {
    const line = raw.replace(/[\r\n]+/g, " ").trim();
    return line ? truncate(line, 200) : undefined;
  }

  // Error shape
  if (data.error) {
    const msg = data.error.message || data.error || "Error";
    return `Error: ${truncate(String(msg), 160)}`;
  }

  // Common shapes: { results: [...] }, { items: [...] }, array
  const arr = Array.isArray(data)
    ? data
    : Array.isArray(data.results)
      ? data.results
      : Array.isArray(data.items)
        ? data.items
        : undefined;

  if (Array.isArray(arr)) {
    const n = arr.length;
    const titles = collectTitles(arr, 3);
    if (titles.length) return `${n} result${n === 1 ? "" : "s"} — top: ${titles.join("; ")}`;
    return `${n} result${n === 1 ? "" : "s"}`;
  }

  // Tools listing shape
  if (Array.isArray(data.tools)) {
    const n = data.tools.length;
    const titles = collectTitles(data.tools, 3);
    if (titles.length) return `${n} tool${n === 1 ? "" : "s"} — ${titles.join(", ")}`;
    return `${n} tool${n === 1 ? "" : "s"}`;
  }

  const keys = Object.keys(data).slice(0, 5);
  if (keys.length) return `Object with keys: ${keys.join(", ")}`;
  return undefined;
}

export const DyadMcpCall: React.FC<DyadMcpCallProps> = ({ children, node }) => {
  const [isOpen, setIsOpen] = useState(false);
  const title: string = node?.properties?.title || "MCP Tool";
  const server: string = node?.properties?.server || "";
  const tool: string = node?.properties?.tool || "";
  const state = (node?.properties?.state as CustomTagState) ?? "finished";

  const pending = state === "pending";
  const aborted = state === "aborted";
  const borderColor = pending ? "border-amber-500" : aborted ? "border-red-500" : "border-border";

  // Stringify children if it's not a string
  const contentString =
    typeof children === "string"
      ? children
      : typeof children === "object"
        ? JSON.stringify(children, null, 2)
        : String(children ?? "");

  const summary = useMemo(() => summarizeMcpPayload(contentString), [contentString]);

  return (
    <div
      className={`bg-(--background-lightest) hover:bg-(--background-lighter) rounded-lg px-4 py-2 border my-2 cursor-pointer ${borderColor}`}
      onClick={() => setIsOpen(!isOpen)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server size={16} />
          <span className="bg-purple-600 text-white text-xs px-1.5 py-0.5 rounded ml-1 font-medium">MCP</span>
          <div className="flex items-center gap-1 text-sm text-gray-800 dark:text-gray-200">
            <Wrench size={14} />
            <span className="font-medium">{title}</span>
            {pending && (
              <div className="flex items-center text-amber-600 text-xs ml-2">
                <Loader size={14} className="mr-1 animate-spin" />
                <span>Running...</span>
              </div>
            )}
            {aborted && (
              <div className="flex items-center text-red-600 text-xs ml-2">
                <CircleX size={14} className="mr-1" />
                <span>Did not finish</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center">
          {isOpen ? (
            <ChevronsDownUp size={20} className="text-gray-500 dark:text-gray-400" />
          ) : (
            <ChevronsUpDown size={20} className="text-gray-500 dark:text-gray-400" />
          )}
        </div>
      </div>
      {/* Descriptive inline summary of the MCP output */}
      {!pending && !aborted && (
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          {summary || "Output ready — click to expand details"}
        </div>
      )}
      {isOpen && (
        <div className="mt-3 text-xs">
          <CodeHighlight className="language-json">{contentString}</CodeHighlight>
        </div>
      )}
    </div>
  );
};

