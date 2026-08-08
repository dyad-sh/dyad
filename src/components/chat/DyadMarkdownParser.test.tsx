import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as parserModule from "@/lib/streamingMessageParser";
import type {
  Block as ParserBlock,
  ParserState,
} from "@/lib/streamingMessageParser";

// Track every render of the inner ReactMarkdown component keyed by the
// content string it received. The DyadMarkdownParser wraps ReactMarkdown
// inside a React.memo'd MemoMarkdown, so a call here means the memo did
// not short-circuit — i.e. the block actually re-rendered.
const markdownRenderCounts = new Map<string, number>();

vi.mock("react-markdown", () => ({
  default: function MockReactMarkdown({ children }: { children: string }) {
    markdownRenderCounts.set(
      children,
      (markdownRenderCounts.get(children) ?? 0) + 1,
    );
    return null;
  },
}));

vi.mock("../preview_panel/FileEditor", () => ({
  FileEditor: () => null,
}));

import { DyadMarkdownParser } from "./DyadMarkdownParser";

describe("DyadMarkdownParser dyad-status", () => {
  afterEach(() => {
    cleanup();
  });

  it("honors explicit aborted state on closed status tags", () => {
    render(
      <DyadMarkdownParser
        content={
          '<dyad-status title="Supabase functions failed" state="aborted">\n0 succeeded\n1 failed\n</dyad-status>'
        }
      />,
    );

    const statusCard = screen.getByRole("button");

    expect(screen.getByText("Supabase functions failed")).toBeTruthy();
    expect(statusCard.className).toContain("border-l-red-500");
  });
});

describe("DyadMarkdownParser closed-block render counts", () => {
  beforeEach(() => {
    markdownRenderCounts.clear();
  });
  afterEach(() => {
    cleanup();
  });

  // Three markdown segments separated by two closed dyad-status tags.
  // After the parser consumes everything, each markdown segment becomes
  // its own closed Block whose `content` is exactly the bytes between
  // the previous tag's `>` and the next tag's `<`. We put the `\n\n`
  // separators on the markdown-side of the constants so each constant
  // matches the closed Block's content string verbatim.
  const MD1 = "First paragraph content.\n\n";
  const TAG1 = '<dyad-status title="S1" state="finished">ok</dyad-status>';
  const MD2 = "\n\nSecond paragraph content.\n\n";
  const TAG2 = '<dyad-status title="S2" state="finished">ok</dyad-status>';
  const MD3 = "\n\nThird paragraph content.";
  const FULL = MD1 + TAG1 + MD2 + TAG2 + MD3;

  it("renders each markdown block exactly once for a one-shot parse", () => {
    render(<DyadMarkdownParser content={FULL} />);

    // MD1 / MD2 are closed markdown blocks. MD3 is the trailing open block
    // (parser only closes a markdown block when a custom tag opens after
    // it). All three should reach the inner ReactMarkdown exactly once.
    expect(markdownRenderCounts.get(MD1)).toBe(1);
    expect(markdownRenderCounts.get(MD2)).toBe(1);
    expect(markdownRenderCounts.get(MD3)).toBe(1);
  });

  it("does not re-render closed markdown blocks as later content streams in", () => {
    // Each markdown block closes when the parser consumes the '>' of the
    // next custom tag's opening. After close, the closed-block's MemoMarkdown
    // should never re-execute even though many more chunks arrive.
    const md1ClosesAt = MD1.length + TAG1.indexOf(">") + 1;
    const md2ClosesAt =
      MD1.length + TAG1.length + MD2.length + TAG2.indexOf(">") + 1;

    // Phase 1: render up through the chunk that closes MD1.
    const { rerender } = render(
      <DyadMarkdownParser content={FULL.slice(0, md1ClosesAt)} />,
    );
    const md1AfterClose = markdownRenderCounts.get(MD1) ?? 0;
    expect(md1AfterClose).toBeGreaterThanOrEqual(1);

    // Phase 2: stream one character at a time through MD2's close.
    for (let i = md1ClosesAt + 1; i <= md2ClosesAt; i++) {
      rerender(<DyadMarkdownParser content={FULL.slice(0, i)} />);
    }
    const md2AfterClose = markdownRenderCounts.get(MD2) ?? 0;
    expect(md2AfterClose).toBeGreaterThanOrEqual(1);

    // MD1 already closed; the renders in phase 2 should leave its count
    // untouched. This is the property the component-local parser cache
    // unlocks: a closed block's content prop is referentially stable, so
    // React.memo skips its subtree on every subsequent chunk.
    expect(markdownRenderCounts.get(MD1)).toBe(md1AfterClose);

    // Phase 3: stream through the rest of the message. Both MD1 and MD2
    // are already closed; neither should re-render.
    for (let i = md2ClosesAt + 1; i <= FULL.length; i++) {
      rerender(<DyadMarkdownParser content={FULL.slice(0, i)} />);
    }
    expect(markdownRenderCounts.get(MD1)).toBe(md1AfterClose);
    expect(markdownRenderCounts.get(MD2)).toBe(md2AfterClose);
  });
});

describe("DyadMarkdownParser parser-cache perf metrics", () => {
  // Spies on the exported parser entry points. Pre-cache builds rebuild
  // every Block on every chunk via parseFullMessage; post-cache routes
  // through advanceParser with a stable ParserState. We spy on both so a
  // single test can run unmodified on either branch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let advanceSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parseFullSpy: any;

  beforeEach(() => {
    markdownRenderCounts.clear();
    advanceSpy = vi.spyOn(parserModule, "advanceParser");
    parseFullSpy = vi.spyOn(parserModule, "parseFullMessage");
  });

  afterEach(() => {
    cleanup();
    advanceSpy.mockRestore();
    parseFullSpy.mockRestore();
  });

  const MD1 = "First paragraph content goes here.\n\n";
  const TAG1 = '<dyad-status title="S1" state="finished">ok</dyad-status>';
  const MD2 = "\n\nSecond paragraph content goes here.\n\n";
  const TAG2 = '<dyad-status title="S2" state="finished">ok</dyad-status>';
  const MD3 = "\n\nThird paragraph content goes here.";
  const FULL = MD1 + TAG1 + MD2 + TAG2 + MD3;

  // Returned states in call order, with bytes-scanned for each call. For
  // advanceParser we infer scanned bytes from the cursor delta; for
  // parseFullMessage we treat the full input length as scanned (the parser
  // restarts from cursor 0).
  function collectCalls(): { state: ParserState; bytesScanned: number }[] {
    const out: { state: ParserState; bytesScanned: number }[] = [];
    (advanceSpy.mock.calls as unknown[][]).forEach((args, i) => {
      const prev = args[0] as ParserState;
      const next = advanceSpy.mock.results[i].value as ParserState;
      out.push({ state: next, bytesScanned: next.cursor - prev.cursor });
    });
    (parseFullSpy.mock.calls as unknown[][]).forEach((args, i) => {
      const content = args[0] as string;
      const result = parseFullSpy.mock.results[i].value as {
        state: ParserState;
      };
      out.push({ state: result.state, bytesScanned: content.length });
    });
    return out;
  }

  function streamFully() {
    const { rerender } = render(
      <DyadMarkdownParser content={FULL.slice(0, 1)} />,
    );
    for (let i = 2; i <= FULL.length; i++) {
      rerender(<DyadMarkdownParser content={FULL.slice(0, i)} />);
    }
  }

  it("scans each input byte at most a small constant number of times across a stream", () => {
    streamFully();
    const calls = collectCalls();
    const totalBytesScanned = calls.reduce((s, c) => s + c.bytesScanned, 0);
    // Linear in message length, not quadratic in chunk count. A parse-
    // from-scratch implementation hits ~N²/2 (here ≈ 19_000) and busts
    // this bound; the cached state.cursor keeps it near N.
    expect(totalBytesScanned).toBeLessThanOrEqual(FULL.length * 2);
  });

  it("allocates each closed Block exactly once across the stream", () => {
    streamFully();
    const calls = collectCalls();
    const closedBlockRefs = new Set<ParserBlock>();
    for (const c of calls) {
      for (const b of c.state.blocks) closedBlockRefs.add(b);
    }
    const finalClosedCount = calls[calls.length - 1].state.blocks.length;
    // Without the cache, every chunk rebuilds every closed Block; the
    // unique-ref count balloons to ~closedBlocks × chunks. With the
    // cache, each closed Block keeps one stable reference.
    expect(closedBlockRefs.size).toBeLessThanOrEqual(finalClosedCount + 1);
  });

  it("preserves the state.blocks array reference across chunks that do not close a block", () => {
    streamFully();
    const calls = collectCalls();
    let nonClosingPairs = 0;
    let stablePairs = 0;
    for (let i = 1; i < calls.length; i++) {
      const prev = calls[i - 1].state;
      const next = calls[i].state;
      if (next.blocks.length === prev.blocks.length) {
        nonClosingPairs++;
        if (prev.blocks === next.blocks) stablePairs++;
      }
    }
    // Sanity: streaming a multi-block message char-by-char produces many
    // chunks that do not close a block — make sure the harness saw them.
    expect(nonClosingPairs).toBeGreaterThan(0);
    // This is the property MemoClosedBlocks's default shallow equality
    // depends on: when no block closes, the blocks-array ref must stay
    // stable so React.memo bails out the entire subtree in O(1).
    expect(stablePairs).toBe(nonClosingPairs);
  });
});
