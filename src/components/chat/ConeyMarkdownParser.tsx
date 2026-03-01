import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ConeyWrite } from "./ConeyWrite";
import { ConeyRename } from "./ConeyRename";
import { ConeyDelete } from "./ConeyDelete";
import { ConeyAddDependency } from "./ConeyAddDependency";
import { ConeyExecuteSql } from "./ConeyExecuteSql";
import { ConeyLogs } from "./ConeyLogs";
import { ConeyGrep } from "./ConeyGrep";
import { ConeyAddIntegration } from "./ConeyAddIntegration";
import { ConeyEdit } from "./ConeyEdit";
import { ConeySearchReplace } from "./ConeySearchReplace";
import { ConeyCodebaseContext } from "./ConeyCodebaseContext";
import { ConeyThink } from "./ConeyThink";
import { CodeHighlight } from "./CodeHighlight";
import { useAtomValue } from "jotai";
import { isStreamingByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { CustomTagState } from "./stateTypes";
import { ConeyOutput } from "./ConeyOutput";
import { ConeyProblemSummary } from "./ConeyProblemSummary";
import { ipc } from "@/ipc/types";
import { ConeyMcpToolCall } from "./ConeyMcpToolCall";
import { ConeyMcpToolResult } from "./ConeyMcpToolResult";
import { ConeyWebSearchResult } from "./ConeyWebSearchResult";
import { ConeyWebSearch } from "./ConeyWebSearch";
import { ConeyWebCrawl } from "./ConeyWebCrawl";
import { ConeyCodeSearchResult } from "./ConeyCodeSearchResult";
import { ConeyCodeSearch } from "./ConeyCodeSearch";
import { ConeyRead } from "./ConeyRead";
import { ConeyListFiles } from "./ConeyListFiles";
import { ConeyDatabaseSchema } from "./ConeyDatabaseSchema";
import { ConeySupabaseTableSchema } from "./ConeySupabaseTableSchema";
import { ConeySupabaseProjectInfo } from "./ConeySupabaseProjectInfo";
import { ConeyStatus } from "./ConeyStatus";
import { ConeyCompaction } from "./ConeyCompaction";
import { ConeyWritePlan } from "./ConeyWritePlan";
import { ConeyExitPlan } from "./ConeyExitPlan";
import { mapActionToButton } from "./ChatInput";
import { SuggestedAction } from "@/lib/schemas";
import { FixAllErrorsButton } from "./FixAllErrorsButton";
import { unescapeXmlAttr, unescapeXmlContent } from "../../../shared/xmlEscape";

const CONEY_CUSTOM_TAGS = [
  "coney-write",
  "coney-rename",
  "coney-delete",
  "coney-add-dependency",
  "coney-execute-sql",
  "coney-read-logs",
  "coney-add-integration",
  "coney-output",
  "coney-problem-report",
  "coney-chat-summary",
  "coney-edit",
  "coney-grep",
  "coney-search-replace",
  "coney-codebase-context",
  "coney-web-search-result",
  "coney-web-search",
  "coney-web-crawl",
  "coney-code-search-result",
  "coney-code-search",
  "coney-read",
  "think",
  "coney-command",
  "coney-mcp-tool-call",
  "coney-mcp-tool-result",
  "coney-list-files",
  "coney-database-schema",
  "coney-supabase-table-schema",
  "coney-supabase-project-info",
  "coney-status",
  "coney-compaction",
  // Plan mode tags
  "coney-write-plan",
  "coney-exit-plan",
];

interface ConeyMarkdownParserProps {
  content: string;
}

type CustomTagInfo = {
  tag: string;
  attributes: Record<string, string>;
  content: string;
  fullMatch: string;
  inProgress?: boolean;
};

type ContentPiece =
  | { type: "markdown"; content: string }
  | { type: "custom-tag"; tagInfo: CustomTagInfo };

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
        ipc.system.openExternalUrl(url);
      }
    }}
  />
);

export const VanillaMarkdownParser = ({ content }: { content: string }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code: CodeHighlight,
        a: customLink,
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

/**
 * Custom component to parse markdown content with Coney-specific tags
 */
export const ConeyMarkdownParser: React.FC<ConeyMarkdownParserProps> = ({
  content,
}) => {
  const chatId = useAtomValue(selectedChatIdAtom);
  const isStreaming = useAtomValue(isStreamingByIdAtom).get(chatId!) ?? false;
  // Extract content pieces (markdown and custom tags)
  const contentPieces = useMemo(() => {
    return parseCustomTags(content);
  }, [content]);

  // Extract error messages and track positions
  const { errorMessages, lastErrorIndex, errorCount } = useMemo(() => {
    const errors: string[] = [];
    let lastIndex = -1;
    let count = 0;

    contentPieces.forEach((piece, index) => {
      if (
        piece.type === "custom-tag" &&
        piece.tagInfo.tag === "coney-output" &&
        piece.tagInfo.attributes.type === "error"
      ) {
        const errorMessage = piece.tagInfo.attributes.message;
        if (errorMessage?.trim()) {
          errors.push(errorMessage.trim());
          count++;
          lastIndex = index;
        }
      }
    });

    return {
      errorMessages: errors,
      lastErrorIndex: lastIndex,
      errorCount: count,
    };
  }, [contentPieces]);

  return (
    <>
      {contentPieces.map((piece, index) => (
        <React.Fragment key={index}>
          {piece.type === "markdown"
            ? piece.content && (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code: CodeHighlight,
                    a: customLink,
                  }}
                >
                  {piece.content}
                </ReactMarkdown>
              )
            : renderCustomTag(piece.tagInfo, { isStreaming })}
          {index === lastErrorIndex &&
            errorCount > 1 &&
            !isStreaming &&
            chatId && (
              <div className="mt-3 w-full flex">
                <FixAllErrorsButton
                  errorMessages={errorMessages}
                  chatId={chatId}
                />
              </div>
            )}
        </React.Fragment>
      ))}
    </>
  );
};

/**
 * Pre-process content to handle unclosed custom tags
 * Adds closing tags at the end of the content for any unclosed custom tags
 * Assumes the opening tags are complete and valid
 * Returns the processed content and a map of in-progress tags
 */
function preprocessUnclosedTags(content: string): {
  processedContent: string;
  inProgressTags: Map<string, Set<number>>;
} {
  let processedContent = content;
  // Map to track which tags are in progress and their positions
  const inProgressTags = new Map<string, Set<number>>();

  // For each tag type, check if there are unclosed tags
  for (const tagName of CONEY_CUSTOM_TAGS) {
    // Count opening and closing tags
    const openTagPattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>`, "g");
    const closeTagPattern = new RegExp(`</${tagName}>`, "g");

    // Track the positions of opening tags
    const openingMatches: RegExpExecArray[] = [];
    let match;

    // Reset regex lastIndex to start from the beginning
    openTagPattern.lastIndex = 0;

    while ((match = openTagPattern.exec(processedContent)) !== null) {
      openingMatches.push({ ...match });
    }

    const openCount = openingMatches.length;
    const closeCount = (processedContent.match(closeTagPattern) || []).length;

    // If we have more opening than closing tags
    const missingCloseTags = openCount - closeCount;
    if (missingCloseTags > 0) {
      // Add the required number of closing tags at the end
      processedContent += Array(missingCloseTags)
        .fill(`</${tagName}>`)
        .join("");

      // Mark the last N tags as in progress where N is the number of missing closing tags
      const inProgressIndexes = new Set<number>();
      const startIndex = openCount - missingCloseTags;
      for (let i = startIndex; i < openCount; i++) {
        inProgressIndexes.add(openingMatches[i].index);
      }
      inProgressTags.set(tagName, inProgressIndexes);
    }
  }

  return { processedContent, inProgressTags };
}

/**
 * Parse the content to extract custom tags and markdown sections into a unified array
 */
function parseCustomTags(content: string): ContentPiece[] {
  const { processedContent, inProgressTags } = preprocessUnclosedTags(content);

  const tagPattern = new RegExp(
    `<(${CONEY_CUSTOM_TAGS.join("|")})\\s*([^>]*)>(.*?)<\\/\\1>`,
    "gs",
  );

  const contentPieces: ContentPiece[] = [];
  let lastIndex = 0;
  let match;

  // Find all custom tags
  while ((match = tagPattern.exec(processedContent)) !== null) {
    const [fullMatch, tag, attributesStr, tagContent] = match;
    const startIndex = match.index;

    // Add the markdown content before this tag
    if (startIndex > lastIndex) {
      contentPieces.push({
        type: "markdown",
        content: processedContent.substring(lastIndex, startIndex),
      });
    }

    // Parse attributes and unescape values
    const attributes: Record<string, string> = {};
    const attrPattern = /([\w-]+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrPattern.exec(attributesStr)) !== null) {
      attributes[attrMatch[1]] = unescapeXmlAttr(attrMatch[2]);
    }

    // Check if this tag was marked as in progress
    const tagInProgressSet = inProgressTags.get(tag);
    const isInProgress = tagInProgressSet?.has(startIndex);

    // Add the tag info with unescaped content
    contentPieces.push({
      type: "custom-tag",
      tagInfo: {
        tag,
        attributes,
        content: unescapeXmlContent(tagContent),
        fullMatch,
        inProgress: isInProgress || false,
      },
    });

    lastIndex = startIndex + fullMatch.length;
  }

  // Add the remaining markdown content
  if (lastIndex < processedContent.length) {
    contentPieces.push({
      type: "markdown",
      content: processedContent.substring(lastIndex),
    });
  }

  return contentPieces;
}

function getState({
  isStreaming,
  inProgress,
}: {
  isStreaming?: boolean;
  inProgress?: boolean;
}): CustomTagState {
  if (!inProgress) {
    return "finished";
  }
  return isStreaming ? "pending" : "aborted";
}

/**
 * Render a custom tag based on its type
 */
function renderCustomTag(
  tagInfo: CustomTagInfo,
  { isStreaming }: { isStreaming: boolean },
): React.ReactNode {
  const { tag, attributes, content, inProgress } = tagInfo;

  switch (tag) {
    case "coney-read":
      return (
        <ConeyRead
          node={{
            properties: {
              path: attributes.path || "",
              startLine: attributes.start_line || "",
              endLine: attributes.end_line || "",
            },
          }}
        >
          {content}
        </ConeyRead>
      );
    case "coney-web-search":
      return (
        <ConeyWebSearch
          node={{
            properties: {
              query: attributes.query || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeyWebSearch>
      );
    case "coney-web-crawl":
      return (
        <ConeyWebCrawl
          node={{
            properties: {},
          }}
        >
          {content}
        </ConeyWebCrawl>
      );
    case "coney-code-search":
      return (
        <ConeyCodeSearch
          node={{
            properties: {
              query: attributes.query || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeyCodeSearch>
      );
    case "coney-code-search-result":
      return (
        <ConeyCodeSearchResult
          node={{
            properties: {},
          }}
        >
          {content}
        </ConeyCodeSearchResult>
      );
    case "coney-web-search-result":
      return (
        <ConeyWebSearchResult
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeyWebSearchResult>
      );
    case "think":
      return (
        <ConeyThink
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeyThink>
      );
    case "coney-write":
      return (
        <ConeyWrite
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeyWrite>
      );

    case "coney-rename":
      return (
        <ConeyRename
          node={{
            properties: {
              from: attributes.from || "",
              to: attributes.to || "",
            },
          }}
        >
          {content}
        </ConeyRename>
      );

    case "coney-delete":
      return (
        <ConeyDelete
          node={{
            properties: {
              path: attributes.path || "",
            },
          }}
        >
          {content}
        </ConeyDelete>
      );

    case "coney-add-dependency":
      return (
        <ConeyAddDependency
          node={{
            properties: {
              packages: attributes.packages || "",
            },
          }}
        >
          {content}
        </ConeyAddDependency>
      );

    case "coney-execute-sql":
      return (
        <ConeyExecuteSql
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
              description: attributes.description || "",
            },
          }}
        >
          {content}
        </ConeyExecuteSql>
      );

    case "coney-read-logs":
      return (
        <ConeyLogs
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
              time: attributes.time || "",
              type: attributes.type || "",
              level: attributes.level || "",
              count: attributes.count || "",
            },
          }}
        >
          {content}
        </ConeyLogs>
      );

    case "coney-grep":
      return (
        <ConeyGrep
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
              query: attributes.query || "",
              include: attributes.include || "",
              exclude: attributes.exclude || "",
              "case-sensitive": attributes["case-sensitive"] || "",
              count: attributes.count || "",
              total: attributes.total || "",
              truncated: attributes.truncated || "",
            },
          }}
        >
          {content}
        </ConeyGrep>
      );

    case "coney-add-integration":
      return (
        <ConeyAddIntegration
          node={{
            properties: {
              provider: attributes.provider || "",
            },
          }}
        >
          {content}
        </ConeyAddIntegration>
      );

    case "coney-edit":
      return (
        <ConeyEdit
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeyEdit>
      );

    case "coney-search-replace":
      return (
        <ConeySearchReplace
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeySearchReplace>
      );

    case "coney-codebase-context":
      return (
        <ConeyCodebaseContext
          node={{
            properties: {
              files: attributes.files || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeyCodebaseContext>
      );

    case "coney-mcp-tool-call":
      return (
        <ConeyMcpToolCall
          node={{
            properties: {
              serverName: attributes.server || "",
              toolName: attributes.tool || "",
            },
          }}
        >
          {content}
        </ConeyMcpToolCall>
      );

    case "coney-mcp-tool-result":
      return (
        <ConeyMcpToolResult
          node={{
            properties: {
              serverName: attributes.server || "",
              toolName: attributes.tool || "",
            },
          }}
        >
          {content}
        </ConeyMcpToolResult>
      );

    case "coney-output":
      return (
        <ConeyOutput
          type={attributes.type as "warning" | "error"}
          message={attributes.message}
        >
          {content}
        </ConeyOutput>
      );

    case "coney-problem-report":
      return (
        <ConeyProblemSummary summary={attributes.summary}>
          {content}
        </ConeyProblemSummary>
      );

    case "coney-chat-summary":
      // Don't render anything for coney-chat-summary
      return null;

    case "coney-command":
      if (attributes.type) {
        const action = {
          id: attributes.type,
        } as SuggestedAction;
        return <>{mapActionToButton(action)}</>;
      }
      return null;

    case "coney-list-files":
      return (
        <ConeyListFiles
          node={{
            properties: {
              directory: attributes.directory || "",
              recursive: attributes.recursive || "",
              include_hidden: attributes.include_hidden || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeyListFiles>
      );

    case "coney-database-schema":
      return (
        <ConeyDatabaseSchema
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeyDatabaseSchema>
      );

    case "coney-supabase-table-schema":
      return (
        <ConeySupabaseTableSchema
          node={{
            properties: {
              table: attributes.table || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeySupabaseTableSchema>
      );

    case "coney-supabase-project-info":
      return (
        <ConeySupabaseProjectInfo
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeySupabaseProjectInfo>
      );

    case "coney-status":
      return (
        <ConeyStatus
          node={{
            properties: {
              title: attributes.title || "Processing...",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeyStatus>
      );

    case "coney-compaction":
      return (
        <ConeyCompaction
          node={{
            properties: {
              title: attributes.title || "Compacting conversation",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeyCompaction>
      );

    case "coney-write-plan":
      return (
        <ConeyWritePlan
          node={{
            properties: {
              title: attributes.title || "Implementation Plan",
              summary: attributes.summary,
              complete: attributes.complete,
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ConeyWritePlan>
      );

    case "coney-exit-plan":
      return (
        <ConeyExitPlan
          node={{
            properties: {
              notes: attributes.notes,
            },
          }}
        />
      );

    default:
      return null;
  }
}
