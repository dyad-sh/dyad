import { unescapeXmlAttr, unescapeXmlContent } from "../../shared/xmlEscape";

/**
 * Incremental dyad-tag parser.
 *
 * Goal: feed the message content as it grows and emit a list of stable
 * block objects for the renderer. Completed blocks keep referential
 * identity across updates so React.memo can skip them. Only the open
 * trailing block changes refs while bytes are arriving.
 *
 * The visible block list (getParserBlocks) is identical to what
 * parseCustomTags produced on the same final string, with one streaming-only
 * caveat: pending bytes between an unrecognized "<" / partial opening tag
 * and its disambiguating character are temporarily attached to the trailing
 * markdown block, then re-shaped if the bytes turn into a real opening tag.
 *
 * The parser does NOT decide between "in-progress" vs "aborted" — that's
 * the renderer's call based on whether the chat is still streaming. We only
 * mark blocks as `complete` (closing tag seen) vs not.
 */

// Mirror of DYAD_CUSTOM_TAGS in DyadMarkdownParser. Kept here as the source
// of truth so the parser doesn't depend on the renderer file.
const DYAD_CUSTOM_TAG_NAMES = [
  "dyad-write",
  "dyad-rename",
  "dyad-delete",
  "dyad-add-dependency",
  "dyad-execute-sql",
  "dyad-read-logs",
  "dyad-add-integration",
  "dyad-enable-nitro",
  "dyad-output",
  "dyad-problem-report",
  "dyad-chat-summary",
  "dyad-edit",
  "dyad-grep",
  "dyad-search-replace",
  "dyad-codebase-context",
  "dyad-web-search-result",
  "dyad-web-search",
  "dyad-web-crawl",
  "dyad-web-fetch",
  "dyad-code-search-result",
  "dyad-code-search",
  "dyad-read",
  "think",
  "dyad-command",
  "dyad-mcp-tool-call",
  "dyad-mcp-tool-result",
  "dyad-list-files",
  "dyad-database-schema",
  "dyad-db-table-schema",
  "dyad-supabase-table-schema",
  "dyad-supabase-project-info",
  "dyad-neon-project-info",
  "dyad-neon-table-schema",
  "dyad-read-guide",
  "dyad-status",
  "dyad-compaction",
  "dyad-copy",
  "dyad-image-generation",
  "dyad-write-plan",
  "dyad-exit-plan",
  "dyad-questionnaire",
  "dyad-step-limit",
];
const DYAD_CUSTOM_TAG_SET = new Set(DYAD_CUSTOM_TAG_NAMES);

export type Block =
  | {
      kind: "markdown";
      id: number;
      content: string;
      complete: boolean;
      /** Byte offset (in the parser's local content) at which this block ends. Set on commit. */
      endOffset?: number;
    }
  | {
      kind: "custom-tag";
      id: number;
      tag: string;
      attributes: Record<string, string>;
      content: string;
      complete: boolean;
      /** True when the closing tag has not yet been seen. */
      inProgress: boolean;
      /** Byte offset (in the parser's local content) at which this block ends. Set on commit. */
      endOffset?: number;
    };

type Mode =
  | "prose" // looking for "<" that may begin a custom tag
  | "tag-open" // saw "<", reading a name
  | "tag-attrs" // saw "<NAME ", reading attributes until ">"
  | "tag-content" // inside a tag's content
  | "tag-close-start" // saw "<" inside tag content
  | "tag-close-name"; // saw "</", reading closing name until ">"

interface OpenTag {
  tag: string;
  attributes: Record<string, string>;
  /** Block id assigned when opening. */
  blockId: number;
  /** Accumulated raw (still escaped) content. */
  rawContent: string;
}

export interface ParserState {
  /** Bytes from `content` already consumed. */
  cursor: number;
  mode: Mode;
  /** Bytes seen but not yet committed (e.g. partial "<dyad-..."). */
  pending: string;
  /** While in tag-attrs, the tag name. */
  pendingTagName: string;
  /** While in tag-attrs, raw chars between name and '>'. */
  pendingAttrs: string;
  /** While in tag-close-name, raw chars after "</". */
  pendingCloseName: string;
  /** The currently-open custom tag, if mode is tag-content / tag-close-*. */
  currentTag: OpenTag | null;
  /**
   * Byte offset of the '<' that started the most recent tag candidate.
   * Valid while mode is tag-open / tag-attrs / tag-close-* — used to set
   * the endOffset of the markdown block that preceded a real tag.
   */
  tagStartOffset: number;
  /** Open trailing block — markdown while in prose modes, custom-tag while in tag-content/close. */
  openBlock: Block | null;
  /** Committed (closed) blocks. Refs stable across updates. */
  blocks: Block[];
  nextBlockId: number;
}

export function initialParserState(): ParserState {
  return {
    cursor: 0,
    mode: "prose",
    pending: "",
    pendingTagName: "",
    pendingAttrs: "",
    pendingCloseName: "",
    currentTag: null,
    tagStartOffset: 0,
    openBlock: null,
    blocks: [],
    nextBlockId: 0,
  };
}

const NAME_CHAR = /[A-Za-z0-9-]/;

function parseAttributes(attrsStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrsStr)) !== null) {
    out[m[1]] = unescapeXmlAttr(m[2]);
  }
  return out;
}

function appendToMarkdownOpen(state: ParserState, text: string): void {
  if (!text) return;
  if (state.openBlock && state.openBlock.kind === "markdown") {
    state.openBlock = {
      kind: "markdown",
      id: state.openBlock.id,
      content: state.openBlock.content + text,
      complete: false,
    };
  } else {
    state.openBlock = {
      kind: "markdown",
      id: state.nextBlockId++,
      content: text,
      complete: false,
    };
  }
}

function commitOpenMarkdown(state: ParserState, endOffset: number): void {
  if (state.openBlock && state.openBlock.kind === "markdown") {
    if (state.openBlock.content.length > 0) {
      state.blocks.push({
        ...state.openBlock,
        complete: true,
        endOffset,
      });
    }
    state.openBlock = null;
  }
}

/**
 * Advance the parser through `content` starting from state.cursor.
 * If `content` is shorter than state.cursor (a rewrite/resync), the parser
 * is reset and re-runs from scratch.
 *
 * Returns a NEW state object. Committed blocks share refs with the previous
 * state; the open block is rebuilt only when its content changes.
 */
export function advanceParser(prev: ParserState, content: string): ParserState {
  let state: ParserState;
  if (content.length < prev.cursor) {
    state = initialParserState();
  } else {
    // Shallow clone — we mutate locally then return it. Committed blocks
    // array reference is reused (we only push, never mutate prior entries).
    state = {
      cursor: prev.cursor,
      mode: prev.mode,
      pending: prev.pending,
      pendingTagName: prev.pendingTagName,
      pendingAttrs: prev.pendingAttrs,
      pendingCloseName: prev.pendingCloseName,
      currentTag: prev.currentTag,
      tagStartOffset: prev.tagStartOffset,
      openBlock: prev.openBlock,
      blocks: prev.blocks,
      nextBlockId: prev.nextBlockId,
    };
  }

  const len = content.length;
  let i = state.cursor;

  while (i < len) {
    const ch = content[i];

    if (state.mode === "prose") {
      if (ch === "<") {
        state.pending = "<";
        state.tagStartOffset = i;
        state.mode = "tag-open";
        i++;
      } else {
        // Fast-forward over a run of non-'<' chars; cheaper than per-char append.
        let j = i + 1;
        while (j < len && content[j] !== "<") j++;
        appendToMarkdownOpen(state, content.slice(i, j));
        i = j;
      }
      continue;
    }

    if (state.mode === "tag-open") {
      if (NAME_CHAR.test(ch)) {
        state.pending += ch;
        i++;
        continue;
      }
      // Disambiguator. The pending buffer is "<NAME". To be a real custom
      // tag, NAME must be in the set AND the next char must be ws or '>'.
      const name = state.pending.slice(1);
      if (
        DYAD_CUSTOM_TAG_SET.has(name) &&
        (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ">")
      ) {
        state.pendingTagName = name;
        state.pendingAttrs = "";
        state.pending = "";
        state.mode = "tag-attrs";
        // Don't advance i — let tag-attrs see this char (handles '>' immediately).
        continue;
      }
      // Not a custom tag. Flush the buffered "<NAME" to markdown and resume.
      appendToMarkdownOpen(state, state.pending);
      state.pending = "";
      state.mode = "prose";
      // Re-process current char in prose mode.
      continue;
    }

    if (state.mode === "tag-attrs") {
      if (ch === ">") {
        const attrs = parseAttributes(state.pendingAttrs);
        // Commit the prior markdown block (if any) so the new tag block
        // becomes the trailing open block. The markdown block ends at the
        // '<' that began this tag.
        commitOpenMarkdown(state, state.tagStartOffset);
        state.currentTag = {
          tag: state.pendingTagName,
          attributes: attrs,
          blockId: state.nextBlockId++,
          rawContent: "",
        };
        state.openBlock = {
          kind: "custom-tag",
          id: state.currentTag.blockId,
          tag: state.currentTag.tag,
          attributes: state.currentTag.attributes,
          content: "",
          complete: false,
          inProgress: true,
        };
        state.pendingTagName = "";
        state.pendingAttrs = "";
        state.mode = "tag-content";
        i++;
        continue;
      }
      // Fast-forward attribute bytes.
      let j = i;
      while (j < len && content[j] !== ">") j++;
      state.pendingAttrs += content.slice(i, j);
      i = j;
      continue;
    }

    if (state.mode === "tag-content") {
      if (ch === "<") {
        state.pending = "<";
        state.mode = "tag-close-start";
        i++;
        continue;
      }
      // Fast-forward run of non-'<' content into rawContent.
      let j = i + 1;
      while (j < len && content[j] !== "<") j++;
      const chunk = content.slice(i, j);
      if (state.currentTag) {
        state.currentTag.rawContent += chunk;
        const open = state.openBlock;
        if (open && open.kind === "custom-tag") {
          state.openBlock = {
            ...open,
            content: unescapeXmlContent(state.currentTag.rawContent),
          };
        }
      }
      i = j;
      continue;
    }

    if (state.mode === "tag-close-start") {
      if (ch === "/") {
        state.pending += "/";
        state.pendingCloseName = "";
        state.mode = "tag-close-name";
        i++;
        continue;
      }
      // Not a closing tag — '<' was content. Push pending into rawContent and resume.
      if (state.currentTag) {
        state.currentTag.rawContent += state.pending;
        const open = state.openBlock;
        if (open && open.kind === "custom-tag") {
          state.openBlock = {
            ...open,
            content: unescapeXmlContent(state.currentTag.rawContent),
          };
        }
      }
      state.pending = "";
      state.mode = "tag-content";
      // Reprocess current char in tag-content (handles consecutive "<").
      continue;
    }

    if (state.mode === "tag-close-name") {
      if (ch === ">") {
        const closing = state.pendingCloseName;
        if (state.currentTag && closing === state.currentTag.tag) {
          // Finalize the custom-tag block. End offset is one past the '>'.
          const finalContent = unescapeXmlContent(state.currentTag.rawContent);
          state.blocks.push({
            kind: "custom-tag",
            id: state.currentTag.blockId,
            tag: state.currentTag.tag,
            attributes: state.currentTag.attributes,
            content: finalContent,
            complete: true,
            inProgress: false,
            endOffset: i + 1,
          });
          state.currentTag = null;
          state.openBlock = null;
          state.pending = "";
          state.pendingCloseName = "";
          state.mode = "prose";
          i++;
          continue;
        }
        // Mismatched closing — treat the buffered "</NAME>" as raw content.
        // state.pending already contains "</NAME"; just append the closing '>'.
        const buffered = state.pending + ">";
        if (state.currentTag) {
          state.currentTag.rawContent += buffered;
          const open = state.openBlock;
          if (open && open.kind === "custom-tag") {
            state.openBlock = {
              ...open,
              content: unescapeXmlContent(state.currentTag.rawContent),
            };
          }
        }
        state.pending = "";
        state.pendingCloseName = "";
        state.mode = "tag-content";
        i++;
        continue;
      }
      if (NAME_CHAR.test(ch)) {
        state.pendingCloseName += ch;
        state.pending += ch;
        i++;
        continue;
      }
      // Unexpected char inside closing name — treat the buffer as raw content.
      const buffered = state.pending;
      if (state.currentTag) {
        state.currentTag.rawContent += buffered;
        const open = state.openBlock;
        if (open && open.kind === "custom-tag") {
          state.openBlock = {
            ...open,
            content: unescapeXmlContent(state.currentTag.rawContent),
          };
        }
      }
      state.pending = "";
      state.pendingCloseName = "";
      state.mode = "tag-content";
      // Reprocess this char as content.
      continue;
    }
  }

  state.cursor = len;
  return state;
}

/**
 * Materialize the current visible block list. Pending bytes mid-tag-name
 * are surfaced as appended markdown text so they show as raw text while
 * the next byte is awaited (matches the existing parseCustomTags behavior
 * for unfinished opening tags without a '>').
 */
export function getParserBlocks(state: ParserState): Block[] {
  // When mid-disambiguation of a possible opening tag, surface the pending
  // bytes as raw markdown text so the user sees them streaming.
  let synthesized = "";
  if (state.mode === "tag-open") {
    synthesized = state.pending;
  } else if (state.mode === "tag-attrs") {
    synthesized = "<" + state.pendingTagName + state.pendingAttrs;
  }

  if (state.openBlock) {
    if (synthesized && state.openBlock.kind === "markdown") {
      return [
        ...state.blocks,
        {
          kind: "markdown",
          id: state.openBlock.id,
          content: state.openBlock.content + synthesized,
          complete: false,
        },
      ];
    }
    return [...state.blocks, state.openBlock];
  }
  if (synthesized) {
    return [
      ...state.blocks,
      {
        kind: "markdown",
        id: state.nextBlockId,
        content: synthesized,
        complete: false,
      },
    ];
  }
  return state.blocks;
}

/**
 * One-shot parse of `content`. Used for non-streaming messages (history,
 * post-completion) so the renderer's block-list pipeline is uniform.
 */
export function parseFullMessage(content: string): {
  state: ParserState;
  blocks: Block[];
} {
  const state = advanceParser(initialParserState(), content);
  return { state, blocks: getParserBlocks(state) };
}

/**
 * Drop the oldest committed blocks beyond `keepLastN`, slicing the content
 * string at the byte boundary of the last dropped block. Returns adjusted
 * state and content. The open block (if any) and parser scan position
 * are shifted to the new origin so subsequent advanceParser calls keep
 * working in local coordinates.
 *
 * Caller is responsible for tracking the cumulative `bytesDropped` so
 * incoming streaming patches (which carry server-side offsets) can be
 * translated to local coordinates.
 */
export function trimToLastNBlocks(
  state: ParserState,
  content: string,
  keepLastN: number,
): { state: ParserState; content: string; bytesDropped: number } {
  if (state.blocks.length <= keepLastN) {
    return { state, content, bytesDropped: 0 };
  }
  const dropCount = state.blocks.length - keepLastN;
  const lastDropped = state.blocks[dropCount - 1];
  // Every committed block must have an endOffset (parser sets it on commit).
  // If somehow absent (forward-compat), bail out instead of corrupting state.
  if (lastDropped.endOffset === undefined) {
    return { state, content, bytesDropped: 0 };
  }
  const cutAt = lastDropped.endOffset;
  const newContent = content.slice(cutAt);
  const remaining = state.blocks.slice(dropCount).map((b) => ({
    ...b,
    endOffset: b.endOffset !== undefined ? b.endOffset - cutAt : b.endOffset,
  }));
  const newState: ParserState = {
    ...state,
    cursor: state.cursor - cutAt,
    tagStartOffset: Math.max(0, state.tagStartOffset - cutAt),
    blocks: remaining,
  };
  return { state: newState, content: newContent, bytesDropped: cutAt };
}
