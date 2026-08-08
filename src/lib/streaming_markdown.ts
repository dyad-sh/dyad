/**
 * Splitting a partly-arrived markdown message into what is settled and what is
 * still being written.
 *
 * A streamed reply re-renders on every flush — twenty-plus times a second. If
 * the whole message is one markdown tree, every one of those flushes re-parses
 * and re-reconciles the entire answer, so a long reply gets slower to render
 * the longer it gets. Markdown blocks are separated by blank lines, and text
 * before the last blank line cannot change meaning when more tokens arrive, so
 * that part can be parsed once and kept.
 *
 * The exception is a fenced code block: until its closing fence arrives, every
 * new line still belongs to it, so an open fence keeps the whole fence in the
 * unsettled part.
 */

export type StreamingSplit = {
  /** Blocks that can no longer change. Safe to memoise. */
  stable: string;
  /** The block still being written. Re-rendered on every chunk. */
  trailing: string;
};

/** Where the last unclosed ``` fence starts, or -1 when none is open. */
function openFenceIndex(text: string): number {
  const fence = /^[ \t]{0,3}(`{3,}|~{3,})/gm;
  let openAt = -1;
  let marker = "";
  for (const match of text.matchAll(fence)) {
    const ticks = match[1]!;
    if (openAt < 0) {
      openAt = match.index!;
      marker = ticks[0]!;
    } else if (ticks[0] === marker) {
      // A closing fence must be at least as long as the one that opened it.
      openAt = -1;
      marker = "";
    }
  }
  return openAt;
}

export function splitStreamingMarkdown(content: string): StreamingSplit {
  if (!content) return { stable: "", trailing: "" };

  const fenceAt = openFenceIndex(content);
  // Everything from an open fence onward is still being written.
  const searchLimit = fenceAt >= 0 ? fenceAt : content.length;

  // The last blank line before the unsettled region ends the settled part.
  const boundary = content.lastIndexOf("\n\n", Math.max(0, searchLimit - 1));
  if (boundary < 0 || boundary + 2 > searchLimit) {
    return { stable: "", trailing: content };
  }

  return {
    stable: content.slice(0, boundary + 2),
    trailing: content.slice(boundary + 2),
  };
}
