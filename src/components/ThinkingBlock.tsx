import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { IpcClient } from "@/ipc/ipc_client";

const customLink = ({
  node: _node,
  ...props
}: {
  node?: any;
  [key: string]: any;
}) => (
  <a
    {...props}
    onClick={(e) => {
      const url = props.href;
      if (url) {
        e.preventDefault();
        IpcClient.getInstance().openExternalUrl(url);
      }
    }}
  />
);

export const VanillaMarkdownParser = ({ content }: { content: string }) => {
  return (
    <ReactMarkdown
      components={{
        a: customLink,
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

function getPreviewText(
  content: string,
  maxLines: number = 2,
  maxChars: number = 280,
): string {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return "";
  let preview = lines.slice(-maxLines).join("\n");
  if (preview.length > maxChars) {
    // Keep the tail since we want the last thoughts
    preview = "…" + preview.slice(preview.length - maxChars);
  }
  return preview;
}

interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

export function ThinkingBlock({
  content,
  isStreaming = false,
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!content.trim() && !isStreaming) {
    return null;
  }

  const previewText = getPreviewText(content);

  return (
    <div className="mb-3 border border-gray-200 rounded-lg bg-gray-50/50 dark:border-gray-700 dark:bg-gray-800/50">
      <button
        className="w-full px-3 py-2 flex items-center gap-2 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100/50 dark:hover:bg-gray-700/50 rounded-t-lg transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
        disabled={isStreaming && !content.trim()}
      >
        {isExpanded ? (
          <ChevronDownIcon className="w-4 h-4 flex-shrink-0" />
        ) : (
          <ChevronRightIcon className="w-4 h-4 flex-shrink-0" />
        )}
        <span className="flex items-center gap-2">
          Thinking
          {isStreaming && (
            <div className="flex items-center gap-1">
              <div
                className="w-1 h-1 bg-blue-500 rounded-full animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <div
                className="w-1 h-1 bg-blue-500 rounded-full animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <div
                className="w-1 h-1 bg-blue-500 rounded-full animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </div>
          )}
        </span>
      </button>

      {/* Collapsed preview (last 1-2 lines), ChatGPT-style */}
      {!isExpanded && (
        <div className="px-3 pb-2 pt-1 text-xs text-gray-600 dark:text-gray-400">
          <div className="prose dark:prose-invert prose-p:my-0 prose-pre:my-0 max-w-none">
            <VanillaMarkdownParser
              content={previewText || (isStreaming ? "…" : "")}
            />
          </div>
        </div>
      )}

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-600 dark:text-gray-400 font-mono bg-white dark:bg-gray-900 p-3 rounded border prose dark:prose-invert prose-headings:mb-2 prose-p:my-1 prose-pre:my-0 max-w-none">
            {content ? (
              <>
                <VanillaMarkdownParser content={content} />
                {isStreaming && (
                  <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-1" />
                )}
              </>
            ) : isStreaming ? (
              "..."
            ) : (
              ""
            )}
          </div>
        </div>
      )}
    </div>
  );
}
