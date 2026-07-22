import { parseFullMessage } from "@/lib/streamingMessageParser";

/**
 * Builds the searchable text projection of a chat message for the
 * chat_search_fts index and for read_chat output.
 *
 * The projection policy is deliberately conservative: assistant messages can
 * embed entire files, SQL dumps, diffs, logs, and tool payloads inside Dyad
 * tags, and none of that belongs in chat recall. Only conversational signal
 * (prose, plans, summaries, findings) keeps its body; payload-bearing tags
 * are reduced to short metadata; unknown tags fail closed to metadata-only.
 *
 * Bump CHAT_SEARCH_PROJECTION_VERSION whenever the policy here changes so
 * ChatSearchIndexer rebuilds existing documents in the background.
 */
export const CHAT_SEARCH_PROJECTION_VERSION = 1;

export interface ChatSearchProjectionInput {
  role: "user" | "assistant";
  content: string;
  isCompactionSummary: boolean;
}

export interface ChatSearchProjection {
  text: string;
  truncated: boolean;
}

/**
 * Hard bound on projection size. Normal messages never approach this after
 * payload removal; it exists so a pathological message (e.g. a user pasting
 * megabytes of text) cannot bloat the index. Head and tail are kept so both
 * the opening ask and the trailing conclusion stay searchable.
 */
export const MAX_PROJECTION_CHARS = 16_000;
const TRUNCATION_HEAD_CHARS = 12_000;
const TRUNCATION_TAIL_CHARS = 3_000;
const TRUNCATION_MARKER = "\n…[truncated]…\n";

/** Max chars of a single kept attribute value in a metadata line. */
const MAX_ATTR_CHARS = 200;

/**
 * Tags whose body is conversational signal and stays searchable.
 */
const PRESERVE_BODY_TAGS = new Set([
  "dyad-chat-summary",
  "dyad-compaction",
  "dyad-write-plan",
  "dyad-exit-plan",
  "dyad-questionnaire",
  "dyad-app-blueprint",
  "dyad-security-finding",
  "dyad-status",
  "dyad-step-limit",
  "dyad-output",
]);

/**
 * Tags dropped entirely — no body, no attributes. `think` is model
 * reasoning; the chat-search tags are dropped so retrieved history can
 * never become recursively searchable copied history.
 */
const DROP_ENTIRELY_TAGS = new Set([
  "think",
  "dyad-search-chats",
  "dyad-read-chat",
]);

/**
 * Attributes worth keeping when a tag's body is dropped. Short, high-signal
 * identifiers only ("which file/table/query was this about"), never payloads.
 */
const KEPT_METADATA_ATTRIBUTES = [
  "path",
  "from",
  "to",
  "query",
  "description",
  "operation",
  "server",
  "tool",
  "url",
  "table",
  "provider",
  "packages",
  "name",
  "guide",
  "type",
  "title",
  "summary",
  "app_name",
  "revision",
] as const;

/**
 * Every other recognized tag — file writes, SQL, diffs, logs, tool output,
 * schemas, web payloads, scripts, MCP results, and any tag added in the
 * future without an explicit policy here — fails closed: body omitted,
 * allowlisted short attributes kept as a metadata line.
 */
function metadataLineForTag(
  tag: string,
  attributes: Record<string, string>,
): string {
  const parts: string[] = [];
  for (const key of KEPT_METADATA_ATTRIBUTES) {
    const value = attributes[key];
    if (value) {
      parts.push(value.slice(0, MAX_ATTR_CHARS));
    }
  }
  const label = tag.replace(/^dyad-/, "").replace(/-/g, " ");
  return parts.length > 0 ? `[${label}: ${parts.join(" ")}]` : `[${label}]`;
}

/**
 * Defense-in-depth for tag text the block parser did NOT recognize (tags
 * absent from DYAD_CUSTOM_TAG_NAMES flow through as plain markdown). Removes
 * paired spans, then any stray opening/closing dyad tags, so an unrecognized
 * payload tag cannot leak its body into the projection.
 */
function scrubUnrecognizedDyadTags(markdown: string): string {
  return (
    markdown
      .replace(/<(dyad-[a-z0-9-]+)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, " ")
      // An unclosed opening tag fails closed: drop everything after it
      // rather than risk leaking a payload body.
      .replace(/<(?:dyad-[a-z0-9-]+|think)\b[^>]*>[\s\S]*$/gi, " ")
      .replace(/<\/?(?:dyad-[a-z0-9-]+|think)\b[^>]*>/gi, " ")
  );
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function boundProjection(text: string): ChatSearchProjection {
  if (text.length <= MAX_PROJECTION_CHARS) {
    return { text, truncated: false };
  }
  const head = text.slice(0, TRUNCATION_HEAD_CHARS);
  const tail = text.slice(text.length - TRUNCATION_TAIL_CHARS);
  return { text: `${head}${TRUNCATION_MARKER}${tail}`, truncated: true };
}

export function projectChatMessageForSearch(
  input: ChatSearchProjectionInput,
): ChatSearchProjection {
  if (input.role === "user") {
    // User-authored text is preserved as-is. Literal <dyad-*> examples in a
    // user message are content the user typed (or attached), not trusted
    // tool markup, so they are not interpreted or stripped.
    return boundProjection(normalizeWhitespace(input.content));
  }

  const { blocks } = parseFullMessage(input.content);
  const parts: string[] = [];

  for (const block of blocks) {
    if (block.kind === "markdown") {
      const scrubbed = scrubUnrecognizedDyadTags(block.content);
      if (scrubbed.trim()) {
        parts.push(scrubbed);
      }
      continue;
    }

    if (DROP_ENTIRELY_TAGS.has(block.tag)) {
      continue;
    }

    if (PRESERVE_BODY_TAGS.has(block.tag)) {
      // An unclosed preserve-body tag (crash mid-stream) still has usable
      // text; scrub in case a payload tag got swallowed into its content.
      const body = scrubUnrecognizedDyadTags(block.content);
      if (body.trim()) {
        parts.push(body);
      }
      continue;
    }

    parts.push(metadataLineForTag(block.tag, block.attributes));
  }

  return boundProjection(normalizeWhitespace(parts.join("\n")));
}
