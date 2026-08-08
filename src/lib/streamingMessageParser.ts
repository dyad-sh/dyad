import { unescapeXmlAttr, unescapeXmlContent } from "../../shared/xmlEscape";

/**
 * Incremental dyad-tag parser.
 *
 * Feed the message content as it grows; emit a list of stable Block
 * objects for the renderer. Committed Block objects keep referential
 * identity across calls so React.memo can skip them; the blocks array
 * ref changes only when a block closes during a given advance. The open
 * (trailing) block is rebuilt only when its content changes.
 *
 * Streaming-only quirk: pending bytes between an unrecognized "<" /
 * partial opening tag and its disambiguating character are temporarily
 * surfaced as appended markdown text (see getOpenBlock) so the user
 * sees them streaming, then re-shaped if the bytes turn into a real
 * opening tag.
 *
 * The parser does NOT decide between "in-progress" vs "aborted" — that's
 * the renderer's call based on whether the chat is still streaming. We
 * only mark blocks as `complete` (closing tag seen) vs not.
 */

// Recognised dyad custom-tag names. Anything outside this set with a
// leading "<NAME" is treated as markdown text, matching the rendering
// behavior in DyadMarkdownParser.
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
  "dyad-script",
];
const DYAD_CUSTOM_TAG_SET = new Set(DYAD_CUSTOM_TAG_NAMES);

export type Block =
  | {
      kind: "markdown";
      id: number;
      content: string;
      complete: boolean;
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
   * Valid while mode is tag-open / tag-attrs — captured so a successful
   * tag-attrs commit can record the new custom-tag block's start offset.
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

function commitOpenMarkdown(state: ParserState): void {
  if (state.openBlock && state.openBlock.kind === "markdown") {
    if (state.openBlock.content.length > 0) {
      // Immutable append: new array ref on commit so closed-block memo
      // wrappers can invalidate exactly when a block closes and stay
      // stable across "open block extends" chunks (used in follow-up PRs).
      state.blocks = [
        ...state.blocks,
        {
          ...state.openBlock,
          complete: true,
        },
      ];
    }
    state.openBlock = null;
  }
}

/**
 * Advance the parser through `content` starting from state.cursor.
 * If `content` is shorter than state.cursor (a rewrite/resync), the parser
 * is reset and re-runs from scratch.
 *
 * Returns a NEW state object. Individual committed Block objects share refs
 * with the previous state (so per-block React.memo hits); the blocks array
 * gets a new ref only when a block closes during this advance. The open
 * block is rebuilt only when its content changes.
 */
export function advanceParser(prev: ParserState, content: string): ParserState {
  let state: ParserState;
  if (content.length < prev.cursor) {
    state = initialParserState();
  } else {
    // Shallow clone — we mutate locally then return it. The blocks array
    // is reassigned (immutable append) on each commit, so prior refs are
    // preserved on chunks that don't close any block.
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
        // becomes the trailing open block.
        commitOpenMarkdown(state);
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
          // Finalize the custom-tag block. Immutable append (see commitOpenMarkdown).
          const finalContent = unescapeXmlContent(state.currentTag.rawContent);
          state.blocks = [
            ...state.blocks,
            {
              kind: "custom-tag",
              id: state.currentTag.blockId,
              tag: state.currentTag.tag,
              attributes: state.currentTag.attributes,
              content: finalContent,
              complete: true,
              inProgress: false,
            },
          ];
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
 * The currently-visible open (trailing) block, or null if there is none.
 * Pending bytes mid-tag-name are surfaced as appended markdown text so
 * the user sees them streaming while waiting for the disambiguating
 * character (the bytes get re-shaped into a custom-tag block once the
 * opening '>' arrives).
 */
export function getOpenBlock(state: ParserState): Block | null {
  let synthesizedMarkdown = "";
  let synthesizedTagContent = "";
  if (state.mode === "tag-open") {
    synthesizedMarkdown = state.pending;
  } else if (state.mode === "tag-attrs") {
    synthesizedMarkdown = "<" + state.pendingTagName + state.pendingAttrs;
  } else if (
    state.mode === "tag-close-start" ||
    state.mode === "tag-close-name"
  ) {
    // Bytes buffered mid-closing-tag ("<", "</", "</NAME") — surface them in
    // the open custom-tag's visible content so they stream and aren't lost
    // if the stream stops before the closing tag completes.
    synthesizedTagContent = state.pending;
  }

  if (state.openBlock) {
    if (synthesizedMarkdown && state.openBlock.kind === "markdown") {
      return {
        kind: "markdown",
        id: state.openBlock.id,
        content: state.openBlock.content + synthesizedMarkdown,
        complete: false,
      };
    }
    if (synthesizedTagContent && state.openBlock.kind === "custom-tag") {
      return {
        ...state.openBlock,
        content:
          state.openBlock.content + unescapeXmlContent(synthesizedTagContent),
      };
    }
    return state.openBlock;
  }
  if (synthesizedMarkdown) {
    return {
      kind: "markdown",
      id: state.nextBlockId,
      content: synthesizedMarkdown,
      complete: false,
    };
  }
  return null;
}

/**
 * Materialize the full current block list (closed + open). Used for
 * one-shot parses (parseFullMessage) and tests.
 */
export function getParserBlocks(state: ParserState): Block[] {
  const open = getOpenBlock(state);
  return open ? [...state.blocks, open] : state.blocks;
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
