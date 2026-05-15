import React, { useDeferredValue, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { DyadWrite } from "./DyadWrite";
import { DyadRename } from "./DyadRename";
import { DyadCopy } from "./DyadCopy";
import { DyadDelete } from "./DyadDelete";
import { DyadAddDependency } from "./DyadAddDependency";
import { DyadExecuteSql } from "./DyadExecuteSql";
import { DyadLogs } from "./DyadLogs";
import { DyadGrep } from "./DyadGrep";
import { DyadAddIntegration } from "./DyadAddIntegration";
import { DyadEnableNitro } from "./DyadEnableNitro";
import { DyadEdit } from "./DyadEdit";
import { DyadSearchReplace } from "./DyadSearchReplace";
import { DyadCodebaseContext } from "./DyadCodebaseContext";
import { DyadThink } from "./DyadThink";
import { CodeHighlight } from "./CodeHighlight";
import { useAtomValue } from "jotai";
import { isStreamingByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { CustomTagState } from "./stateTypes";
import { DyadOutput } from "./DyadOutput";
import { DyadProblemSummary } from "./DyadProblemSummary";
import { ipc } from "@/ipc/types";
import { DyadMcpToolCall } from "./DyadMcpToolCall";
import { DyadMcpToolResult } from "./DyadMcpToolResult";
import { DyadWebSearchResult } from "./DyadWebSearchResult";
import { DyadWebSearch } from "./DyadWebSearch";
import { DyadWebCrawl } from "./DyadWebCrawl";
import { DyadWebFetch } from "./DyadWebFetch";
import { DyadImageGeneration } from "./DyadImageGeneration";
import { DyadCodeSearchResult } from "./DyadCodeSearchResult";
import { DyadCodeSearch } from "./DyadCodeSearch";
import { DyadRead } from "./DyadRead";
import { DyadListFiles } from "./DyadListFiles";
import { DyadDatabaseSchema } from "./DyadDatabaseSchema";
import { DyadDbTableSchema } from "./DyadDbTableSchema";
import { DyadSupabaseProjectInfo } from "./DyadSupabaseProjectInfo";
import { DyadNeonProjectInfo } from "./DyadNeonProjectInfo";
import { DyadStatus } from "./DyadStatus";
import { DyadCompaction } from "./DyadCompaction";
import { DyadWritePlan } from "./DyadWritePlan";
import { DyadExitPlan } from "./DyadExitPlan";
import { DyadQuestionnaire } from "./DyadQuestionnaire";
import { DyadStepLimit } from "./DyadStepLimit";
import { DyadReadGuide } from "./DyadReadGuide";
import { DyadScript } from "./DyadScript";
import { mapActionToButton } from "./ChatInput";
import { SuggestedAction } from "@/lib/schemas";
import { FixAllErrorsButton } from "./FixAllErrorsButton";
import { type Block, parseFullMessage } from "@/lib/streamingMessageParser";

interface DyadMarkdownParserProps {
  content: string;
}

type CustomTagBlock = Extract<Block, { kind: "custom-tag" }>;

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
 * Custom component to parse markdown content with Dyad-specific tags.
 *
 * Block list is produced by an incremental dyad-tag parser
 * (src/lib/streamingMessageParser.ts) called one-shot per render.
 */
export const DyadMarkdownParser: React.FC<DyadMarkdownParserProps> = ({
  content,
}) => {
  const chatId = useAtomValue(selectedChatIdAtom);
  const isStreaming = useAtomValue(isStreamingByIdAtom).get(chatId!) ?? false;
  const deferredContent = useDeferredValue(content);
  const contentToParse = isStreaming ? deferredContent : content;

  const blocks = useMemo(
    () => parseFullMessage(contentToParse).blocks,
    [contentToParse],
  );

  const { errorMessages, lastErrorIndex, errorCount } = useMemo(() => {
    const errors: string[] = [];
    let lastIndex = -1;
    let count = 0;

    blocks.forEach((block, index) => {
      if (
        block.kind === "custom-tag" &&
        block.tag === "dyad-output" &&
        block.attributes.type === "error"
      ) {
        const errorMessage = block.attributes.message;
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
  }, [blocks]);

  return (
    <>
      {blocks.map((block, index) => (
        <React.Fragment key={block.id}>
          {block.kind === "markdown" ? (
            block.content && <MemoMarkdown content={block.content} />
          ) : (
            <MemoCustomTag block={block} isStreaming={isStreaming} />
          )}
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

// Module-level constants so MemoMarkdown never gets fresh refs for these
// props, which would defeat ReactMarkdown's internal prop-equality checks.
const REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_COMPONENTS = { code: CodeHighlight, a: customLink };

// Memoized markdown piece. Without this, ReactMarkdown re-parses every
// completed segment's text into an AST on every streaming chunk —
// the dominant per-render cost during long streams. Memoizing on
// `content` lets completed segments skip that re-parse entirely.
const MemoMarkdown = React.memo(function MemoMarkdown({
  content,
}: {
  content: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
});

function customTagBlockEqual(a: CustomTagBlock, b: CustomTagBlock): boolean {
  if (a.tag !== b.tag) return false;
  if (a.content !== b.content) return false;
  if (a.inProgress !== b.inProgress) return false;
  const aKeys = Object.keys(a.attributes);
  const bKeys = Object.keys(b.attributes);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a.attributes[k] !== b.attributes[k]) return false;
  }
  return true;
}

// Memoized custom-tag piece. parseFullMessage rebuilds Block objects on
// every chunk (new refs), so React.memo's default referential equality
// would never hit. The custom comparator deep-checks the fields that
// actually affect the rendered output, so completed dyad tags skip
// renderCustomTag and the React subtree rebuild when only later blocks
// change.
const MemoCustomTag = React.memo(
  function MemoCustomTag({
    block,
    isStreaming,
  }: {
    block: CustomTagBlock;
    isStreaming: boolean;
  }) {
    return <>{renderCustomTag(block, { isStreaming })}</>;
  },
  (prev, next) =>
    customTagBlockEqual(prev.block, next.block) &&
    // Completed tags don't use isStreaming (getState returns "finished"
    // regardless), so skip the check to avoid a one-time re-render of every
    // completed tag when streaming ends.
    (prev.block.inProgress === false || prev.isStreaming === next.isStreaming),
);

function getState({
  isStreaming,
  inProgress,
  explicitState,
}: {
  isStreaming?: boolean;
  inProgress?: boolean;
  explicitState?: string;
}): CustomTagState {
  if (explicitState === "aborted" || explicitState === "finished") {
    return explicitState;
  }
  if (explicitState === "in-progress" || explicitState === "pending") {
    return "pending";
  }
  if (!inProgress) {
    return "finished";
  }
  return isStreaming ? "pending" : "aborted";
}

/**
 * Render a custom tag based on its type
 */
function renderCustomTag(
  block: CustomTagBlock,
  { isStreaming }: { isStreaming: boolean },
): React.ReactNode {
  const { tag, attributes, content, inProgress } = block;

  switch (tag) {
    case "dyad-read":
      return (
        <DyadRead
          node={{
            properties: {
              path: attributes.path || "",
              startLine: attributes.start_line || "",
              endLine: attributes.end_line || "",
              appName: attributes.app_name || "",
            },
          }}
        >
          {content}
        </DyadRead>
      );
    case "dyad-web-search":
      return (
        <DyadWebSearch
          node={{
            properties: {
              query: attributes.query || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadWebSearch>
      );
    case "dyad-web-crawl":
      return (
        <DyadWebCrawl
          node={{
            properties: {},
          }}
        >
          {content}
        </DyadWebCrawl>
      );
    case "dyad-web-fetch":
      return (
        <DyadWebFetch
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadWebFetch>
      );
    case "dyad-code-search":
      return (
        <DyadCodeSearch
          node={{
            properties: {
              query: attributes.query || "",
              state: getState({ isStreaming, inProgress }),
              appName: attributes.app_name || "",
            },
          }}
        >
          {content}
        </DyadCodeSearch>
      );
    case "dyad-code-search-result":
      return (
        <DyadCodeSearchResult
          node={{
            properties: {},
          }}
        >
          {content}
        </DyadCodeSearchResult>
      );
    case "dyad-web-search-result":
      return (
        <DyadWebSearchResult
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadWebSearchResult>
      );
    case "think":
      return (
        <DyadThink
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadThink>
      );
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

    case "dyad-copy":
      return (
        <DyadCopy
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
        </DyadCopy>
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
              description: attributes.description || "",
            },
          }}
        >
          {content}
        </DyadExecuteSql>
      );

    case "dyad-read-logs":
      return (
        <DyadLogs
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
        </DyadLogs>
      );

    case "dyad-grep":
      return (
        <DyadGrep
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
              appName: attributes.app_name || "",
            },
          }}
        >
          {content}
        </DyadGrep>
      );

    case "dyad-add-integration":
      return (
        <DyadAddIntegration
          provider={
            attributes.provider === "neon" || attributes.provider === "supabase"
              ? attributes.provider
              : undefined
          }
        >
          {content}
        </DyadAddIntegration>
      );

    case "dyad-enable-nitro":
      return <DyadEnableNitro state={getState({ isStreaming, inProgress })} />;

    case "dyad-edit":
      return (
        <DyadEdit
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadEdit>
      );

    case "dyad-search-replace":
      return (
        <DyadSearchReplace
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadSearchReplace>
      );

    case "dyad-codebase-context":
      return (
        <DyadCodebaseContext
          node={{
            properties: {
              files: attributes.files || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadCodebaseContext>
      );

    case "dyad-mcp-tool-call":
      return (
        <DyadMcpToolCall
          node={{
            properties: {
              serverName: attributes.server || "",
              toolName: attributes.tool || "",
            },
          }}
        >
          {content}
        </DyadMcpToolCall>
      );

    case "dyad-mcp-tool-result":
      return (
        <DyadMcpToolResult
          node={{
            properties: {
              serverName: attributes.server || "",
              toolName: attributes.tool || "",
            },
          }}
        >
          {content}
        </DyadMcpToolResult>
      );

    case "dyad-output":
      return (
        <DyadOutput
          type={attributes.type as "warning" | "error"}
          message={attributes.message}
        >
          {content}
        </DyadOutput>
      );

    case "dyad-script":
      return (
        <DyadScript
          node={{
            properties: {
              description: attributes.description || "",
              truncated: attributes.truncated || "",
              executionMs: attributes["execution-ms"] || "",
              fullOutputPath: attributes["full-output-path"] || "",
            },
          }}
        >
          {content}
        </DyadScript>
      );

    case "dyad-problem-report":
      return (
        <DyadProblemSummary summary={attributes.summary}>
          {content}
        </DyadProblemSummary>
      );

    case "dyad-chat-summary":
      // Don't render anything for dyad-chat-summary
      return null;

    case "dyad-command":
      if (attributes.type) {
        const action = {
          id: attributes.type,
        } as SuggestedAction;
        return <>{mapActionToButton(action)}</>;
      }
      return null;

    case "dyad-list-files":
      return (
        <DyadListFiles
          node={{
            properties: {
              directory: attributes.directory || "",
              recursive: attributes.recursive || "",
              include_ignored:
                attributes.include_ignored || attributes.include_hidden || "",
              state: getState({ isStreaming, inProgress }),
              appName: attributes.app_name || "",
            },
          }}
        >
          {content}
        </DyadListFiles>
      );

    case "dyad-database-schema":
      return (
        <DyadDatabaseSchema
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadDatabaseSchema>
      );

    case "dyad-db-table-schema":
    // Backward compat: old messages used provider-specific tags
    case "dyad-supabase-table-schema":
    case "dyad-neon-table-schema":
      return (
        <DyadDbTableSchema
          provider={
            tag === "dyad-supabase-table-schema"
              ? "Supabase"
              : tag === "dyad-neon-table-schema"
                ? "Neon"
                : (attributes.provider as string) || ""
          }
          node={{
            properties: {
              table: attributes.table || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadDbTableSchema>
      );

    case "dyad-supabase-project-info":
      return (
        <DyadSupabaseProjectInfo
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadSupabaseProjectInfo>
      );

    case "dyad-neon-project-info":
      return (
        <DyadNeonProjectInfo
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadNeonProjectInfo>
      );

    case "dyad-read-guide":
      return (
        <DyadReadGuide
          node={{
            properties: {
              name: attributes.name || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadReadGuide>
      );

    case "dyad-image-generation":
      return (
        <DyadImageGeneration
          node={{
            properties: {
              prompt: attributes.prompt || "",
              path: attributes.path || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadImageGeneration>
      );

    case "dyad-status":
      return (
        <DyadStatus
          node={{
            properties: {
              title: attributes.title || "Processing...",
              state: getState({
                isStreaming,
                inProgress,
                explicitState: attributes.state,
              }),
            },
          }}
        >
          {content}
        </DyadStatus>
      );

    case "dyad-compaction":
      return (
        <DyadCompaction
          node={{
            properties: {
              title: attributes.title || "Compacting conversation",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadCompaction>
      );

    case "dyad-write-plan":
      return (
        <DyadWritePlan
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
        </DyadWritePlan>
      );

    case "dyad-exit-plan":
      return (
        <DyadExitPlan
          node={{
            properties: {
              notes: attributes.notes,
            },
          }}
        />
      );

    case "dyad-questionnaire":
      return <DyadQuestionnaire>{content}</DyadQuestionnaire>;

    case "dyad-step-limit":
      return (
        <DyadStepLimit
          node={{
            properties: {
              steps: attributes.steps,
              limit: attributes.limit,
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </DyadStepLimit>
      );

    default:
      return null;
  }
}
