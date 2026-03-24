import React, { useDeferredValue, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ProteaAIWrite } from "./ProteaAIWrite";
import { ProteaAIRename } from "./ProteaAIRename";
import { ProteaAICopy } from "./ProteaAICopy";
import { ProteaAIDelete } from "./ProteaAIDelete";
import { ProteaAIAddDependency } from "./ProteaAIAddDependency";
import { ProteaAIExecuteSql } from "./ProteaAIExecuteSql";
import { ProteaAILogs } from "./ProteaAILogs";
import { ProteaAIGrep } from "./ProteaAIGrep";
import { ProteaAIAddIntegration } from "./ProteaAIAddIntegration";
import { ProteaAIEdit } from "./ProteaAIEdit";
import { ProteaAISearchReplace } from "./ProteaAISearchReplace";
import { ProteaAICodebaseContext } from "./ProteaAICodebaseContext";
import { ProteaAIThink } from "./ProteaAIThink";
import { CodeHighlight } from "./CodeHighlight";
import { useAtomValue } from "jotai";
import { isStreamingByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { CustomTagState } from "./stateTypes";
import { ProteaAIOutput } from "./ProteaAIOutput";
import { ProteaAIProblemSummary } from "./ProteaAIProblemSummary";
import { ipc } from "@/ipc/types";
import { ProteaAIMcpToolCall } from "./ProteaAIMcpToolCall";
import { ProteaAIMcpToolResult } from "./ProteaAIMcpToolResult";
import { ProteaAIWebSearchResult } from "./ProteaAIWebSearchResult";
import { ProteaAIWebSearch } from "./ProteaAIWebSearch";
import { ProteaAIWebCrawl } from "./ProteaAIWebCrawl";
import { ProteaAIWebFetch } from "./ProteaAIWebFetch";
import { ProteaAIImageGeneration } from "./ProteaAIImageGeneration";
import { ProteaAICodeSearchResult } from "./ProteaAICodeSearchResult";
import { ProteaAICodeSearch } from "./ProteaAICodeSearch";
import { ProteaAIRead } from "./ProteaAIRead";
import { ProteaAIListFiles } from "./ProteaAIListFiles";
import { ProteaAIDatabaseSchema } from "./ProteaAIDatabaseSchema";
import { ProteaAISupabaseTableSchema } from "./ProteaAISupabaseTableSchema";
import { ProteaAISupabaseProjectInfo } from "./ProteaAISupabaseProjectInfo";
import { ProteaAIStatus } from "./ProteaAIStatus";
import { ProteaAICompaction } from "./ProteaAICompaction";
import { ProteaAIWritePlan } from "./ProteaAIWritePlan";
import { ProteaAIExitPlan } from "./ProteaAIExitPlan";
import { ProteaAIQuestionnaire } from "./ProteaAIQuestionnaire";
import { ProteaAIStepLimit } from "./ProteaAIStepLimit";
import { mapActionToButton } from "./ChatInput";
import { SuggestedAction } from "@/lib/schemas";
import { FixAllErrorsButton } from "./FixAllErrorsButton";
import { unescapeXmlAttr, unescapeXmlContent } from "../../../shared/xmlEscape";

const PROTEAAI_CUSTOM_TAGS = [
  "proteaai-write",
  "proteaai-rename",
  "proteaai-delete",
  "proteaai-add-dependency",
  "proteaai-execute-sql",
  "proteaai-read-logs",
  "proteaai-add-integration",
  "proteaai-output",
  "proteaai-problem-report",
  "proteaai-chat-summary",
  "proteaai-edit",
  "proteaai-grep",
  "proteaai-search-replace",
  "proteaai-codebase-context",
  "proteaai-web-search-result",
  "proteaai-web-search",
  "proteaai-web-crawl",
  "proteaai-web-fetch",
  "proteaai-code-search-result",
  "proteaai-code-search",
  "proteaai-read",
  "think",
  "proteaai-command",
  "proteaai-mcp-tool-call",
  "proteaai-mcp-tool-result",
  "proteaai-list-files",
  "proteaai-database-schema",
  "proteaai-supabase-table-schema",
  "proteaai-supabase-project-info",
  "proteaai-status",
  "proteaai-compaction",
  "proteaai-copy",
  "proteaai-image-generation",
  // Plan mode tags
  "proteaai-write-plan",
  "proteaai-exit-plan",
  "proteaai-questionnaire",
  // Step limit notification
  "proteaai-step-limit",
];

interface ProteaAIMarkdownParserProps {
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
 * Custom component to parse markdown content with ProteaAI-specific tags
 */
export const ProteaAIMarkdownParser: React.FC<ProteaAIMarkdownParserProps> = ({
  content,
}) => {
  const chatId = useAtomValue(selectedChatIdAtom);
  const isStreaming = useAtomValue(isStreamingByIdAtom).get(chatId!) ?? false;
  const deferredContent = useDeferredValue(content);
  const contentToParse = isStreaming ? deferredContent : content;

  // Extract content pieces (markdown and custom tags)
  const contentPieces = useMemo(() => {
    return parseCustomTags(contentToParse);
  }, [contentToParse]);

  // Extract error messages and track positions
  const { errorMessages, lastErrorIndex, errorCount } = useMemo(() => {
    const errors: string[] = [];
    let lastIndex = -1;
    let count = 0;

    contentPieces.forEach((piece, index) => {
      if (
        piece.type === "custom-tag" &&
        piece.tagInfo.tag === "proteaai-output" &&
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
  for (const tagName of PROTEAAI_CUSTOM_TAGS) {
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
    `<(${PROTEAAI_CUSTOM_TAGS.join("|")})\\s*([^>]*)>(.*?)<\\/\\1>`,
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
    case "proteaai-read":
      return (
        <ProteaAIRead
          node={{
            properties: {
              path: attributes.path || "",
              startLine: attributes.start_line || "",
              endLine: attributes.end_line || "",
            },
          }}
        >
          {content}
        </ProteaAIRead>
      );
    case "proteaai-web-search":
      return (
        <ProteaAIWebSearch
          node={{
            properties: {
              query: attributes.query || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAIWebSearch>
      );
    case "proteaai-web-crawl":
      return (
        <ProteaAIWebCrawl
          node={{
            properties: {},
          }}
        >
          {content}
        </ProteaAIWebCrawl>
      );
    case "proteaai-web-fetch":
      return (
        <ProteaAIWebFetch
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAIWebFetch>
      );
    case "proteaai-code-search":
      return (
        <ProteaAICodeSearch
          node={{
            properties: {
              query: attributes.query || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAICodeSearch>
      );
    case "proteaai-code-search-result":
      return (
        <ProteaAICodeSearchResult
          node={{
            properties: {},
          }}
        >
          {content}
        </ProteaAICodeSearchResult>
      );
    case "proteaai-web-search-result":
      return (
        <ProteaAIWebSearchResult
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAIWebSearchResult>
      );
    case "think":
      return (
        <ProteaAIThink
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAIThink>
      );
    case "proteaai-write":
      return (
        <ProteaAIWrite
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAIWrite>
      );

    case "proteaai-rename":
      return (
        <ProteaAIRename
          node={{
            properties: {
              from: attributes.from || "",
              to: attributes.to || "",
            },
          }}
        >
          {content}
        </ProteaAIRename>
      );

    case "proteaai-copy":
      return (
        <ProteaAICopy
          node={{
            properties: {
              from: attributes.from || "",
              to: attributes.to || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAICopy>
      );

    case "proteaai-delete":
      return (
        <ProteaAIDelete
          node={{
            properties: {
              path: attributes.path || "",
            },
          }}
        >
          {content}
        </ProteaAIDelete>
      );

    case "proteaai-add-dependency":
      return (
        <ProteaAIAddDependency
          node={{
            properties: {
              packages: attributes.packages || "",
            },
          }}
        >
          {content}
        </ProteaAIAddDependency>
      );

    case "proteaai-execute-sql":
      return (
        <ProteaAIExecuteSql
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
              description: attributes.description || "",
            },
          }}
        >
          {content}
        </ProteaAIExecuteSql>
      );

    case "proteaai-read-logs":
      return (
        <ProteaAILogs
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
        </ProteaAILogs>
      );

    case "proteaai-grep":
      return (
        <ProteaAIGrep
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
        </ProteaAIGrep>
      );

    case "proteaai-add-integration":
      return (
        <ProteaAIAddIntegration
          node={{
            properties: {
              provider: attributes.provider || "",
            },
          }}
        >
          {content}
        </ProteaAIAddIntegration>
      );

    case "proteaai-edit":
      return (
        <ProteaAIEdit
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAIEdit>
      );

    case "proteaai-search-replace":
      return (
        <ProteaAISearchReplace
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAISearchReplace>
      );

    case "proteaai-codebase-context":
      return (
        <ProteaAICodebaseContext
          node={{
            properties: {
              files: attributes.files || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAICodebaseContext>
      );

    case "proteaai-mcp-tool-call":
      return (
        <ProteaAIMcpToolCall
          node={{
            properties: {
              serverName: attributes.server || "",
              toolName: attributes.tool || "",
            },
          }}
        >
          {content}
        </ProteaAIMcpToolCall>
      );

    case "proteaai-mcp-tool-result":
      return (
        <ProteaAIMcpToolResult
          node={{
            properties: {
              serverName: attributes.server || "",
              toolName: attributes.tool || "",
            },
          }}
        >
          {content}
        </ProteaAIMcpToolResult>
      );

    case "proteaai-output":
      return (
        <ProteaAIOutput
          type={attributes.type as "warning" | "error"}
          message={attributes.message}
        >
          {content}
        </ProteaAIOutput>
      );

    case "proteaai-problem-report":
      return (
        <ProteaAIProblemSummary summary={attributes.summary}>
          {content}
        </ProteaAIProblemSummary>
      );

    case "proteaai-chat-summary":
      // Don't render anything for dyad-chat-summary
      return null;

    case "proteaai-command":
      if (attributes.type) {
        const action = {
          id: attributes.type,
        } as SuggestedAction;
        return <>{mapActionToButton(action)}</>;
      }
      return null;

    case "proteaai-list-files":
      return (
        <ProteaAIListFiles
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
        </ProteaAIListFiles>
      );

    case "proteaai-database-schema":
      return (
        <ProteaAIDatabaseSchema
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAIDatabaseSchema>
      );

    case "proteaai-supabase-table-schema":
      return (
        <ProteaAISupabaseTableSchema
          node={{
            properties: {
              table: attributes.table || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAISupabaseTableSchema>
      );

    case "proteaai-supabase-project-info":
      return (
        <ProteaAISupabaseProjectInfo
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAISupabaseProjectInfo>
      );

    case "proteaai-image-generation":
      return (
        <ProteaAIImageGeneration
          node={{
            properties: {
              prompt: attributes.prompt || "",
              path: attributes.path || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAIImageGeneration>
      );

    case "proteaai-status":
      return (
        <ProteaAIStatus
          node={{
            properties: {
              title: attributes.title || "Processing...",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAIStatus>
      );

    case "proteaai-compaction":
      return (
        <ProteaAICompaction
          node={{
            properties: {
              title: attributes.title || "Compacting conversation",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAICompaction>
      );

    case "proteaai-write-plan":
      return (
        <ProteaAIWritePlan
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
        </ProteaAIWritePlan>
      );

    case "proteaai-exit-plan":
      return (
        <ProteaAIExitPlan
          node={{
            properties: {
              notes: attributes.notes,
            },
          }}
        />
      );

    case "proteaai-questionnaire":
      return <ProteaAIQuestionnaire>{content}</ProteaAIQuestionnaire>;

    case "proteaai-step-limit":
      return (
        <ProteaAIStepLimit
          node={{
            properties: {
              steps: attributes.steps,
              limit: attributes.limit,
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </ProteaAIStepLimit>
      );

    default:
      return null;
  }
}
