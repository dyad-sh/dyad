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
import {
  isStreamingByIdAtom,
  selectedChatIdAtom,
  streamingBlocksByMessageIdAtom,
  messageJsxByIdAtom,
  type CachedClosedBlock,
  type DroppedSummary,
} from "@/atoms/chatAtoms";
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
import { mapActionToButton } from "./ChatInput";
import { SuggestedAction } from "@/lib/schemas";
import { FixAllErrorsButton } from "./FixAllErrorsButton";
import {
  type Block,
  parseFullMessage,
  TOOL_CALL_TAGS,
} from "@/lib/streamingMessageParser";

interface DyadMarkdownParserProps {
  content: string;
  /**
   * The id of the assistant message this content belongs to. Enables the
   * renderer to read the cached incremental parser state from the streaming
   * blocks atom; without it, the renderer falls back to a full reparse on
   * every content change.
   */
  messageId?: number;
}

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
 * The block list is sourced from an incremental parser (see
 * src/lib/streamingMessageParser.ts) so completed blocks keep referential
 * identity across streaming chunks. That lets React.memo skip every prior
 * block, leaving only the open trailing block to re-render per chunk.
 */
export const DyadMarkdownParser: React.FC<DyadMarkdownParserProps> = ({
  content,
  messageId,
}) => {
  const chatId = useAtomValue(selectedChatIdAtom);
  const isStreaming = useAtomValue(isStreamingByIdAtom).get(chatId!) ?? false;
  const deferredContent = useDeferredValue(content);
  const contentToParse = isStreaming ? deferredContent : content;

  const streamingStates = useAtomValue(streamingBlocksByMessageIdAtom);
  const cachedState =
    messageId !== undefined ? streamingStates.get(messageId) : undefined;

  const messageJsxMap = useAtomValue(messageJsxByIdAtom);
  const cachedJsx =
    messageId !== undefined ? messageJsxMap.get(messageId) : undefined;

  // Open block (in-progress) is sourced from the parser state. Closed blocks
  // come from the JSX cache when present. Falls back to one-shot parse for
  // history / non-streaming messages with no cache entry.
  const openBlock = cachedState?.openBlock ?? null;

  // Fallback path: no JSX cache (history, post-DB-restore). One-shot parse.
  const fallbackBlocks = useMemo<Block[] | null>(() => {
    if (cachedJsx !== undefined) return null;
    return parseFullMessage(contentToParse).blocks;
  }, [cachedJsx, contentToParse]);

  // Aggregate error messages for the FixAllErrorsButton.
  const { errorMessages, errorCount } = useMemo(() => {
    const errors: string[] = [];
    if (cachedJsx) {
      for (const entry of cachedJsx.entries) {
        if (entry.errorMessage) errors.push(entry.errorMessage);
      }
    } else if (fallbackBlocks) {
      for (const block of fallbackBlocks) {
        if (
          block.kind === "custom-tag" &&
          block.tag === "dyad-output" &&
          block.attributes.type === "error"
        ) {
          const msg = block.attributes.message?.trim();
          if (msg) errors.push(msg);
        }
      }
    }
    return { errorMessages: errors, errorCount: errors.length };
  }, [cachedJsx, fallbackBlocks]);

  const showFixAll =
    errorCount > 1 && !isStreaming && chatId !== null && chatId !== undefined;

  return (
    <>
      {cachedJsx && hasDropped(cachedJsx.dropped) && (
        <DroppedSummaryBlock dropped={cachedJsx.dropped} />
      )}
      {cachedJsx ? (
        <MemoCachedClosedBlocks entries={cachedJsx.entries} />
      ) : fallbackBlocks ? (
        fallbackBlocks.map((block) => (
          <React.Fragment key={block.id}>
            {block.kind === "markdown" ? (
              block.content && <MemoMarkdown content={block.content} />
            ) : (
              <MemoBlockCustomTag block={block} isStreaming={isStreaming} />
            )}
          </React.Fragment>
        ))
      ) : null}
      {openBlock ? (
        openBlock.kind === "markdown" ? (
          openBlock.content && <MemoMarkdown content={openBlock.content} />
        ) : (
          <MemoBlockCustomTag block={openBlock} isStreaming={isStreaming} />
        )
      ) : null}
      {showFixAll && (
        <div className="mt-3 w-full flex">
          <FixAllErrorsButton errorMessages={errorMessages} chatId={chatId!} />
        </div>
      )}
    </>
  );
};

function hasDropped(dropped: DroppedSummary): boolean {
  return dropped.markdown > 0 || dropped.toolCalls > 0;
}

/**
 * Header block summarizing what was evicted from the JSX cache while the
 * stream was running. Disappears automatically once the stream ends and the
 * cache is cleared (renderer falls back to a one-shot parse of the full DB
 * content). Suppresses any sub-count that is zero.
 */
const DroppedSummaryBlock: React.FC<{ dropped: DroppedSummary }> = ({
  dropped,
}) => {
  const parts: string[] = [];
  if (dropped.markdown > 0) {
    const noun = dropped.markdown === 1 ? "block" : "blocks";
    parts.push(`${dropped.markdown} markdown ${noun}`);
  }
  if (dropped.toolCalls > 0) {
    const writes = dropped.byToolTag["dyad-write"] ?? 0;
    const searchReplaces = dropped.byToolTag["dyad-search-replace"] ?? 0;
    const breakdown: string[] = [];
    if (writes > 0) {
      breakdown.push(`${writes} write_file`);
    }
    if (searchReplaces > 0) {
      breakdown.push(`${searchReplaces} search_replace`);
    }
    const detail = breakdown.length > 0 ? ` (${breakdown.join(", ")})` : "";
    const noun = dropped.toolCalls === 1 ? "call" : "calls";
    parts.push(`${dropped.toolCalls} tool ${noun}${detail}`);
  }
  if (parts.length === 0) return null;
  return (
    <div className="mb-3 px-3 py-2 rounded-md border border-dashed border-border bg-muted/40 text-xs text-muted-foreground">
      Earlier in this response: omitted {parts.join(" and ")}.
    </div>
  );
};

// Memoized renderer for the closed-block JSX cache. Skips re-rendering its
// subtree entirely when the entries array reference is unchanged. The chunk
// handler creates a new array reference only when blocks are appended or
// evicted.
const MemoCachedClosedBlocks = React.memo(function MemoCachedClosedBlocks({
  entries,
}: {
  entries: CachedClosedBlock[];
}) {
  return (
    <>
      {entries.map((entry) => (
        <React.Fragment key={entry.id}>{entry.element}</React.Fragment>
      ))}
    </>
  );
});

// Module-level constants so MemoMarkdown never gets fresh refs for these
// props, which would defeat ReactMarkdown's internal prop-equality checks.
const REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_COMPONENTS = { code: CodeHighlight, a: customLink };

// Memoized markdown piece. Without this, ReactMarkdown re-parses every
// completed segment's text into an AST on every streaming chunk.
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

type CustomTagBlock = Extract<Block, { kind: "custom-tag" }>;

// Memoized custom-tag block. The incremental parser preserves the Block
// reference for any completed (closed) tag across streaming patches, so
// referential equality on `block` is sufficient — completed blocks
// short-circuit and skip renderCustomTag entirely.
const MemoBlockCustomTag = React.memo(
  function MemoBlockCustomTag({
    block,
    isStreaming,
  }: {
    block: CustomTagBlock;
    isStreaming: boolean;
  }) {
    return <>{renderCustomTag(block, { isStreaming })}</>;
  },
  (prev, next) =>
    prev.block === next.block &&
    // Completed tags ignore isStreaming (getState returns "finished"
    // regardless), so skip the check to avoid one-time re-renders of every
    // completed tag when streaming ends.
    (prev.block.inProgress === false || prev.isStreaming === next.isStreaming),
);

/**
 * Build a React element for a committed (closed) block. Called from the
 * chunk handler on commit so the renderer stores a fully-built element
 * and never re-creates it across renders. The element is wrapped in a
 * memoized component so React.memo's ref equality skips re-rendering for
 * unchanged blocks even if the parent re-renders.
 */
export function buildClosedBlockJsx(block: Block): CachedClosedBlock {
  if (block.kind === "markdown") {
    return {
      id: block.id,
      element: <MemoMarkdown key={`m${block.id}`} content={block.content} />,
      bytes: block.content.length,
      category: "markdown",
    };
  }
  let errorMessage: string | undefined;
  if (block.tag === "dyad-output" && block.attributes.type === "error") {
    const trimmed = block.attributes.message?.trim();
    if (trimmed) errorMessage = trimmed;
  }
  const isToolCall = TOOL_CALL_TAGS.has(block.tag);
  return {
    id: block.id,
    element: (
      <MemoBlockCustomTag
        key={`t${block.id}`}
        block={block}
        isStreaming={false}
      />
    ),
    errorMessage,
    bytes: block.content.length,
    category: isToolCall ? "tool-call" : "markdown",
    toolTag: isToolCall ? block.tag : undefined,
  };
}

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
