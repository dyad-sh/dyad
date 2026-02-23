import React, { useState } from "react";
import { Globe, ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { CustomTagState } from "./stateTypes";

interface JoyWebScraperProps {
  url: string;
  template?: string;
  dataset?: string;
  crawl?: string;
  maxPages?: string;
  status?: string;
  state: CustomTagState;
  children?: React.ReactNode;
}

/**
 * Renders the result of a `web_scraper` tool invocation in the chat stream.
 */
export const JoyWebScraper: React.FC<JoyWebScraperProps> = ({
  url,
  template,
  dataset,
  crawl,
  maxPages,
  status,
  state,
  children,
}) => {
  const [expanded, setExpanded] = useState(false);
  const isRunning = state === "pending";
  const isDone = status === "completed" || state === "finished";
  const isFailed = status === "failed" || state === "aborted";

  return (
    <div className="my-2 rounded-lg border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/30 overflow-hidden text-sm">
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-violet-100 dark:hover:bg-violet-900/40 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <Globe size={14} className="text-violet-500 shrink-0" />
        <span className="flex-1 text-left text-xs text-gray-800 dark:text-gray-200 truncate">
          <span className="font-medium">Scrape</span>{" "}
          <span className="font-mono text-violet-600 dark:text-violet-400">{url}</span>
        </span>
        {template && (
          <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">
            {template}
          </span>
        )}
        {isRunning && (
          <Loader2 size={12} className="text-violet-500 animate-spin shrink-0" />
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
      <div className="flex items-center gap-3 px-3 py-1 text-[10px] text-gray-500 dark:text-gray-400 border-t border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20">
        {crawl === "true" && <span>Crawl mode (max {maxPages || "?"} pages)</span>}
        {dataset && <span>→ {dataset}</span>}
      </div>

      {/* Output area */}
      {expanded && children && (
        <div className="border-t border-violet-200 dark:border-violet-700 bg-black/90 px-3 py-2 max-h-64 overflow-auto">
          <pre className="whitespace-pre-wrap font-mono text-xs text-violet-300">
            {children}
          </pre>
        </div>
      )}
    </div>
  );
};
