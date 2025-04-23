import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import { DyadWrite } from "./DyadWrite";
import { DyadRename } from "./DyadRename";
import { DyadDelete } from "./DyadDelete";
import { DyadAddDependency } from "./DyadAddDependency";
import { DyadExecuteSql } from "./DyadExecuteSql";
import { DyadAddIntegration } from "./DyadAddIntegration";
import { CodeHighlight } from "./CodeHighlight";
import { useAtomValue } from "jotai";
import { isStreamingAtom } from "@/atoms/chatAtoms";
import { CustomTagState } from "./stateTypes";

interface DyadMarkdownParserProps {
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

/**
 * Custom component to parse markdown content with Dyad-specific tags
 */
export const DyadMarkdownParser: React.FC<DyadMarkdownParserProps> = ({
  content,
}) => {
  const isStreaming = useAtomValue(isStreamingAtom);
  // Extract content pieces (markdown and custom tags)
  const contentPieces = useMemo(() => {
    return parseCustomTags(content);
  }, [content]);

  return (
    <>
      {contentPieces.map((piece, index) => (
        <React.Fragment key={index}>
          {piece.type === "markdown"
            ? piece.content && (
                <ReactMarkdown
                  rehypePlugins={[rehypeRaw]}
                  components={{ code: CodeHighlight } as any}
                >
                  {piece.content}
                </ReactMarkdown>
              )
            : renderCustomTag(piece.tagInfo, { isStreaming })}
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
  const customTagNames = [
    "dyad-write",
    "dyad-rename",
    "dyad-delete",
    "dyad-add-dependency",
    "dyad-execute-sql",
    "dyad-add-integration",
  ];

  let processedContent = content;
  // Map to track which tags are in progress and their positions
  const inProgressTags = new Map<string, Set<number>>();

  // For each tag type, check if there are unclosed tags
  for (const tagName of customTagNames) {
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

  const customTagNames = [
    "dyad-write",
    "dyad-rename",
    "dyad-delete",
    "dyad-add-dependency",
    "dyad-execute-sql",
    "dyad-add-integration",
  ];

  const tagPattern = new RegExp(
    `<(${customTagNames.join("|")})\\s*([^>]*)>(.*?)<\\/\\1>`,
    "gs"
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
  { isStreaming }: { isStreaming: boolean }
): React.ReactNode {
  const { tag, attributes, content, inProgress } = tagInfo;

  switch (tag) {
    case "dyad-write":
      return (
        <DyadWrite
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadWrite>
      );

    case "dyad-rename":
      return (
        <DyadRename
          node={{
            properties: {
              from: attributes.from || "",
              to: attributes.to || "",
            },
          }}
        >
          {content}
        </DyadRename>
      );

    case "dyad-delete":
      return (
        <DyadDelete
          node={{
            properties: {
              path: attributes.path || "",
            },
          }}
        >
          {content}
        </DyadDelete>
      );

    case "dyad-add-dependency":
      return (
        <DyadAddDependency
          node={{
            properties: {
              packages: attributes.packages || "",
            },
          }}
        >
          {content}
        </DyadAddDependency>
      );

    case "dyad-execute-sql":
      return (
        <DyadExecuteSql
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadExecuteSql>
      );

    case "dyad-add-integration":
      return (
        <DyadAddIntegration
          node={{
            properties: {
              provider: attributes.provider || "",
            },
          }}
        >
          {content}
        </DyadAddIntegration>
      );

    default:
      return null;
  }
}

/**
 * Extract attribute values from className string
 */
function extractAttribute(className: string, attrName: string): string {
  const match = new RegExp(`${attrName}="([^"]*)"`, "g").exec(className);
  return match ? match[1] : "";
}
