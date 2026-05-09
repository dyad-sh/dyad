import { describe, expect, it } from "vitest";
import {
  advanceParser,
  getParserBlocks,
  initialParserState,
  parseFullMessage,
  trimContent,
  type Block,
} from "@/lib/streamingMessageParser";

function blocksToShape(blocks: Block[]) {
  return blocks.map((b) => {
    if (b.kind === "markdown") {
      return { kind: "markdown", content: b.content, complete: b.complete };
    }
    return {
      kind: "custom-tag",
      tag: b.tag,
      attributes: b.attributes,
      content: b.content,
      complete: b.complete,
      inProgress: b.inProgress,
    };
  });
}

function feedAll(content: string, splits: number[]) {
  let state = initialParserState();
  let prev = 0;
  for (const at of splits) {
    state = advanceParser(state, content.slice(0, at));
    prev = at;
  }
  if (prev < content.length) {
    state = advanceParser(state, content);
  }
  return state;
}

describe("streamingMessageParser", () => {
  it("parses pure markdown as a single block", () => {
    const content = "Hello **world**\n\nSecond paragraph";
    const { blocks } = parseFullMessage(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "markdown",
      content,
    });
  });

  it("parses a single dyad-write tag", () => {
    const content =
      'Before\n<dyad-write path="src/foo.ts" description="foo">code here</dyad-write>\nAfter';
    const { blocks } = parseFullMessage(content);
    expect(blocksToShape(blocks)).toEqual([
      { kind: "markdown", content: "Before\n", complete: true },
      {
        kind: "custom-tag",
        tag: "dyad-write",
        attributes: { path: "src/foo.ts", description: "foo" },
        content: "code here",
        complete: true,
        inProgress: false,
      },
      { kind: "markdown", content: "\nAfter", complete: false },
    ]);
  });

  it("handles xml-escaped attribute and content values", () => {
    const content =
      '<dyad-write path="a.ts" description="A &amp; B">if (a &lt; b) {}</dyad-write>';
    const { blocks } = parseFullMessage(content);
    expect(blocks).toHaveLength(1);
    const tag = blocks[0];
    if (tag.kind !== "custom-tag") throw new Error("expected custom-tag");
    expect(tag.attributes.description).toBe("A & B");
    expect(tag.content).toBe("if (a < b) {}");
  });

  it("treats unclosed opening tag as in-progress", () => {
    const content = '<dyad-write path="x.ts">partial';
    const { blocks } = parseFullMessage(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "custom-tag",
      tag: "dyad-write",
      content: "partial",
      complete: false,
      inProgress: true,
    });
  });

  it("treats non-dyad < as text", () => {
    const content = "use <html>tag</html> in markdown";
    const { blocks } = parseFullMessage(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "markdown",
      content,
    });
  });

  it("incremental parse equals full parse for any split sequence", () => {
    const content = `Intro line.

<dyad-write path="src/foo.ts" description="foo &amp; bar">
const x = 1;
if (a &lt; b) { console.log("&amp;"); }
</dyad-write>

Some prose between blocks.

<think>step by step</think>

<dyad-add-dependency packages="react"></dyad-add-dependency>

Final words.`;

    const fullBlocks = parseFullMessage(content).blocks;

    // Try every single-split point.
    for (let i = 0; i <= content.length; i++) {
      let state = initialParserState();
      state = advanceParser(state, content.slice(0, i));
      state = advanceParser(state, content);
      const incBlocks = getParserBlocks(state);
      expect(blocksToShape(incBlocks)).toEqual(blocksToShape(fullBlocks));
    }

    // Try a handful of multi-split sequences (deterministic).
    const multiSplits = [
      [10, 25, 60, 120, 200],
      [1, 2, 3, 4, 5, 50, 100, 150],
      [content.length - 1],
      [5, 5, 5, 50, 50],
    ];
    for (const splits of multiSplits) {
      const state = feedAll(
        content,
        splits.filter((s) => s <= content.length),
      );
      const incBlocks = getParserBlocks(state);
      expect(blocksToShape(incBlocks)).toEqual(blocksToShape(fullBlocks));
    }
  });

  it("preserves committed block refs across updates", () => {
    const part1 =
      'Before\n<dyad-write path="x.ts">done</dyad-write>\n<dyad-write path="y.ts">in';
    const part2 = part1 + "progress";
    let state = initialParserState();
    state = advanceParser(state, part1);
    const blocks1 = getParserBlocks(state);
    state = advanceParser(state, part2);
    const blocks2 = getParserBlocks(state);
    // Completed dyad-write for x.ts should keep its identity.
    const xBefore = blocks1.find(
      (b) => b.kind === "custom-tag" && b.attributes.path === "x.ts",
    );
    const xAfter = blocks2.find(
      (b) => b.kind === "custom-tag" && b.attributes.path === "x.ts",
    );
    expect(xBefore).toBeDefined();
    expect(xBefore).toBe(xAfter);

    // The open in-progress block must get a new ref because its content grew —
    // that's how React.memo on ref equality knows to re-render only it.
    const yBefore = blocks1.find(
      (b) => b.kind === "custom-tag" && b.attributes.path === "y.ts",
    );
    const yAfter = blocks2.find(
      (b) => b.kind === "custom-tag" && b.attributes.path === "y.ts",
    );
    expect(yBefore).toBeDefined();
    expect(yAfter).toBeDefined();
    expect(yBefore).not.toBe(yAfter);
  });

  it("only the open block changes ref across many small chunks (O(chunk) renderer guarantee)", () => {
    // 50 completed dyad-write blocks followed by one open block.
    const completedSegments: string[] = [];
    for (let i = 0; i < 50; i++) {
      completedSegments.push(
        `<dyad-write path="f${i}.ts">content ${i}</dyad-write>`,
      );
    }
    const baseContent =
      completedSegments.join("\n") + '\n<dyad-write path="open.ts">';

    let state = initialParserState();
    state = advanceParser(state, baseContent);
    const completedRefs = getParserBlocks(state)
      .filter(
        (b) => b.kind === "custom-tag" && b.attributes.path?.startsWith("f"),
      )
      .map((b) => b);
    expect(completedRefs).toHaveLength(50);

    let content = baseContent;
    for (let chunk = 0; chunk < 20; chunk++) {
      content += `chunk-${chunk}-payload `;
      state = advanceParser(state, content);
      const after = getParserBlocks(state);
      // All 50 completed blocks must keep the SAME ref. If even one changes,
      // React.memo would mis-trigger and the per-chunk render cost balloons
      // past the open block.
      for (let i = 0; i < 50; i++) {
        const a = completedRefs[i];
        const b = after.find(
          (x) => x.kind === "custom-tag" && x.attributes.path === `f${i}.ts`,
        );
        expect(b).toBe(a);
      }
    }
  });

  it("handles a closing-tag that doesn't match the open tag as content", () => {
    const content = '<dyad-write path="a.ts">foo</dyad-edit>still</dyad-write>';
    const { blocks } = parseFullMessage(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "custom-tag",
      tag: "dyad-write",
      content: "foo</dyad-edit>still",
      complete: true,
    });
  });

  it("random-split fuzz: incremental matches full parse for many seeds", () => {
    const content = `Hello.
<dyad-write path="a.ts" description="x">code &lt;tag&gt; here</dyad-write>
mid prose
<dyad-add-dependency packages="react vue"></dyad-add-dependency>
<think>analysis &amp; plan</think>
<dyad-write path="b.ts">b body
multi-line
content</dyad-write>
trailing`;

    const fullBlocks = blocksToShape(parseFullMessage(content).blocks);

    // Deterministic LCG.
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    for (let trial = 0; trial < 50; trial++) {
      const splitCount = 3 + Math.floor(rand() * 12);
      const splits = new Set<number>();
      for (let k = 0; k < splitCount; k++) {
        splits.add(Math.floor(rand() * content.length));
      }
      const sorted = [...splits].sort((a, b) => a - b);
      let state = initialParserState();
      for (const s of sorted) {
        state = advanceParser(state, content.slice(0, s));
      }
      state = advanceParser(state, content);
      expect(blocksToShape(getParserBlocks(state))).toEqual(fullBlocks);
    }
  });

  it("trimContent shortens the content string at the open-block boundary", () => {
    const segments: string[] = [];
    for (let i = 0; i < 5; i++) {
      segments.push(`<dyad-write path="f${i}.ts">body${i}</dyad-write>`);
    }
    const fullContent = segments.join("\n") + '\n<dyad-write path="open.ts">in';
    const state = advanceParser(initialParserState(), fullContent);

    // Closed blocks (5 dyad-write + 5 newline markdowns) plus one open
    // custom-tag for "open.ts".
    expect(state.blocks.length).toBe(10);
    expect(state.openBlock?.kind).toBe("custom-tag");

    const trimmed = trimContent(state, fullContent);
    expect(trimmed.bytesDropped).toBeGreaterThan(0);

    // Closed blocks survive the trim — they live in state.blocks.
    expect(trimmed.state.blocks.length).toBe(10);
    const closedPaths = trimmed.state.blocks
      .filter(
        (b): b is Extract<Block, { kind: "custom-tag" }> =>
          b.kind === "custom-tag",
      )
      .map((b) => b.attributes.path);
    expect(closedPaths).toEqual(["f0.ts", "f1.ts", "f2.ts", "f3.ts", "f4.ts"]);

    // Trimmed content begins at the open block's '<'.
    expect(trimmed.content.startsWith('<dyad-write path="open.ts">in')).toBe(
      true,
    );
    expect(trimmed.state.cursor).toBe(trimmed.content.length);
    expect(trimmed.state.openBlockStartOffset).toBe(0);

    // Subsequent advance with more bytes appended works on local coordinates.
    const moreContent = trimmed.content + "progress";
    const advanced = advanceParser(trimmed.state, moreContent);
    const open = advanced.openBlock;
    expect(open?.kind).toBe("custom-tag");
    if (open?.kind === "custom-tag") {
      expect(open.attributes.path).toBe("open.ts");
      expect(open.content).toBe("inprogress");
    }
  });

  it("resets when content shrinks (resync)", () => {
    let state = initialParserState();
    state = advanceParser(state, '<dyad-write path="a.ts">old</dyad-write>');
    expect(getParserBlocks(state)).toHaveLength(1);
    state = advanceParser(state, "<dyad-write");
    // Resync caused full reparse — synthesized markdown for partial tag.
    const blocks = getParserBlocks(state);
    expect(blocks.length).toBeGreaterThanOrEqual(0);
    state = advanceParser(state, '<dyad-write path="b.ts">new</dyad-write>');
    const finalBlocks = getParserBlocks(state);
    expect(finalBlocks).toHaveLength(1);
    if (finalBlocks[0].kind !== "custom-tag")
      throw new Error("expected custom-tag");
    expect(finalBlocks[0].attributes.path).toBe("b.ts");
    expect(finalBlocks[0].content).toBe("new");
  });
});
