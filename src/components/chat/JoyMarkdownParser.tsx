import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";

import { JoyWrite } from "./JoyWrite";
import { JoyRename } from "./JoyRename";
import { JoyDelete } from "./JoyDelete";
import { JoyAddDependency } from "./JoyAddDependency";
import { JoyExecuteSql } from "./JoyExecuteSql";
import { JoyAddIntegration } from "./JoyAddIntegration";
import { JoyEdit } from "./JoyEdit";
import { JoySearchReplace } from "./JoySearchReplace";
import { JoyCodebaseContext } from "./JoyCodebaseContext";
import { JoyThink } from "./JoyThink";
import { CodeHighlight } from "./CodeHighlight";
import { useAtomValue } from "jotai";
import { isStreamingByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { CustomTagState } from "./stateTypes";
import { JoyOutput } from "./JoyOutput";
import { JoyProblemSummary } from "./JoyProblemSummary";
import { IpcClient } from "@/ipc/ipc_client";
import { JoyMcpToolCall } from "./JoyMcpToolCall";
import { JoyMcpToolResult } from "./JoyMcpToolResult";
import { JoyWebSearchResult } from "./JoyWebSearchResult";
import { JoyWebSearch } from "./JoyWebSearch";
import { JoyWebCrawl } from "./JoyWebCrawl";
import { JoyCodeSearchResult } from "./JoyCodeSearchResult";
import { JoyCodeSearch } from "./JoyCodeSearch";
import { JoyRead } from "./JoyRead";
import { JoyListFiles } from "./JoyListFiles";
import { JoyDatabaseSchema } from "./JoyDatabaseSchema";
import { JoyDocument } from "./JoyDocument";
import { mapActionToButton } from "./ChatInput";
import { SuggestedAction } from "@/lib/schemas";
import { FixAllErrorsButton } from "./FixAllErrorsButton";

const CUSTOM_TAG_NAMES = [
  "joy-write",
  "joy-rename",
  "joy-delete",
  "joy-add-dependency",
  "joy-execute-sql",
  "joy-add-integration",
  "joy-output",
  "joy-problem-report",
  "joy-chat-summary",
  "joy-edit",
  "joy-search-replace",
  "joy-codebase-context",
  "joy-web-search-result",
  "joy-web-search",
  "joy-web-crawl",
  "joy-code-search-result",
  "joy-code-search",
  "joy-read",
  "think",
  "joy-command",
  "joy-mcp-tool-call",
  "joy-mcp-tool-result",
  "joy-list-files",
  "joy-database-schema",
];

interface JoyMarkdownParserProps {
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
        IpcClient.getInstance().openExternalUrl(url);
      }
    }}
  />
);

export const VanillaMarkdownParser = ({ content }: { content: string }) => {
  return (
    <ReactMarkdown
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
 * Custom component to parse markdown content with Joy-specific tags
 */
export const JoyMarkdownParser: React.FC<JoyMarkdownParserProps> = ({
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
        piece.tagInfo.tag === "joy-output" &&
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
  for (const tagName of CUSTOM_TAG_NAMES) {
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
    `<(${CUSTOM_TAG_NAMES.join("|")})\\s*([^>]*)>(.*?)<\\/\\1>`,
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

    // Parse attributes
    const attributes: Record<string, string> = {};
    const attrPattern = /(\w+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrPattern.exec(attributesStr)) !== null) {
      attributes[attrMatch[1]] = attrMatch[2];
    }

    // Check if this tag was marked as in progress
    const tagInProgressSet = inProgressTags.get(tag);
    const isInProgress = tagInProgressSet?.has(startIndex);

    // Add the tag info
    contentPieces.push({
      type: "custom-tag",
      tagInfo: {
        tag,
        attributes,
        content: tagContent,
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
    case "joy-read":
      return (
        <JoyRead
          node={{
            properties: {
              path: attributes.path || "",
            },
          }}
        >
          {content}
        </JoyRead>
      );
    case "joy-web-search":
      return (
        <JoyWebSearch
          node={{
            properties: {},
          }}
        >
          {content}
        </JoyWebSearch>
      );
    case "joy-web-crawl":
      return (
        <JoyWebCrawl
          node={{
            properties: {},
          }}
        >
          {content}
        </JoyWebCrawl>
      );
    case "joy-code-search":
      return (
        <JoyCodeSearch
          node={{
            properties: {},
          }}
        >
          {content}
        </JoyCodeSearch>
      );
    case "joy-code-search-result":
      return (
        <JoyCodeSearchResult
          node={{
            properties: {},
          }}
        >
          {content}
        </JoyCodeSearchResult>
      );
    case "joy-web-search-result":
      return (
        <JoyWebSearchResult
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </JoyWebSearchResult>
      );
    case "think":
      return (
        <JoyThink
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </JoyThink>
      );
    case "joy-write":
      return (
        <JoyWrite
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </JoyWrite>
      );

    case "joy-rename":
      return (
        <JoyRename
          node={{
            properties: {
              from: attributes.from || "",
              to: attributes.to || "",
            },
          }}
        >
          {content}
        </JoyRename>
      );

    case "joy-delete":
      return (
        <JoyDelete
          node={{
            properties: {
              path: attributes.path || "",
            },
          }}
        >
          {content}
        </JoyDelete>
      );

    case "joy-add-dependency":
      return (
        <JoyAddDependency
          node={{
            properties: {
              packages: attributes.packages || "",
            },
          }}
        >
          {content}
        </JoyAddDependency>
      );

    case "joy-execute-sql":
      return (
        <JoyExecuteSql
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
              description: attributes.description || "",
            },
          }}
        >
          {content}
        </JoyExecuteSql>
      );

    case "joy-add-integration":
      return (
        <JoyAddIntegration
          node={{
            properties: {
              provider: attributes.provider || "",
            },
          }}
        >
          {content}
        </JoyAddIntegration>
      );

    case "joy-edit":
      return (
        <JoyEdit
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </JoyEdit>
      );

    case "joy-search-replace":
      return (
        <JoySearchReplace
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </JoySearchReplace>
      );

    case "joy-codebase-context":
      return (
        <JoyCodebaseContext
          node={{
            properties: {
              files: attributes.files || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </JoyCodebaseContext>
      );

    case "joy-mcp-tool-call":
      return (
        <JoyMcpToolCall
          node={{
            properties: {
              serverName: attributes.server || "",
              toolName: attributes.tool || "",
            },
          }}
        >
          {content}
        </JoyMcpToolCall>
      );

    case "joy-mcp-tool-result":
      return (
        <JoyMcpToolResult
          node={{
            properties: {
              serverName: attributes.server || "",
              toolName: attributes.tool || "",
            },
          }}
        >
          {content}
        </JoyMcpToolResult>
      );

    case "joy-output":
      return (
        <JoyOutput
          type={attributes.type as "warning" | "error"}
          message={attributes.message}
        >
          {content}
        </JoyOutput>
      );

    case "joy-problem-report":
      return (
        <JoyProblemSummary summary={attributes.summary}>
          {content}
        </JoyProblemSummary>
      );

    case "joy-chat-summary":
      // Don't render anything for joy-chat-summary
      return null;

    case "joy-command":
      if (attributes.type) {
        const action = {
          id: attributes.type,
        } as SuggestedAction;
        return <>{mapActionToButton(action)}</>;
      }
      return null;

    case "joy-list-files":
      return (
        <JoyListFiles
          node={{
            properties: {
              directory: attributes.directory || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </JoyListFiles>
      );

    case "joy-database-schema":
      return (
        <JoyDatabaseSchema
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </JoyDatabaseSchema>
      );

    case "joy-document":
      return (
        <JoyDocument
          node={{
            properties: {
              type: attributes.type || "document",
              name: attributes.name || "",
              id: attributes.id || "",
              description: attributes.description || "",
            },
          }}
        >
          {content}
        </JoyDocument>
      );

    default:
      return null;
  }
}
