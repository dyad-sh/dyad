import { describe, expect, it } from "vitest";
import type { StreamingPatch } from "@/ipc/types";
import { hashPrefix } from "@/lib/prefixHash";
import { applyStreamingChunk } from "@/lib/streamingChunk";
import { initialParserState } from "@/lib/streamingMessageParser";

function patch(
  offset: number,
  content: string,
  fullPrefix?: string,
): StreamingPatch {
  return {
    offset,
    content,
    prefixHash:
      fullPrefix !== undefined && offset > 0
        ? hashPrefix(fullPrefix, offset)
        : undefined,
  };
}

describe("applyStreamingChunk", () => {
  it("applies a fresh patch and runs the parser", () => {
    const result = applyStreamingChunk({
      prevContent: "",
      prevParserState: undefined,
      prevDroppedBytes: 0,
      patch: patch(0, "Hello "),
    });
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    // Markdown open block starts at offset 0; trim is a no-op when cutAt
    // would be 0. Content is preserved, droppedBytes stays zero.
    expect(result.droppedBytes).toBe(0);
    expect(result.content).toBe("Hello ");
    expect(result.parserState.cursor).toBe(6);
    expect(result.parserState.openBlock?.kind).toBe("markdown");
  });

  it("trims after a custom-tag closes (state lands in clean prose)", () => {
    const result = applyStreamingChunk({
      prevContent: "",
      prevParserState: undefined,
      prevDroppedBytes: 0,
      patch: patch(0, '<dyad-write path="a.ts">body-a</dyad-write>'),
    });
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    // After the closing tag the parser is in clean prose with no open
    // block; trimContent cuts at cursor and drops the whole local content.
    expect(result.content).toBe("");
    expect(result.droppedBytes).toBe(
      '<dyad-write path="a.ts">body-a</dyad-write>'.length,
    );
    expect(result.parserState.blocks).toHaveLength(1);
    expect(result.parserState.openBlock).toBeNull();
  });

  it("preserves committed blocks across a sequence of patches", () => {
    let state = applyStreamingChunk({
      prevContent: "",
      prevParserState: undefined,
      prevDroppedBytes: 0,
      patch: patch(0, '<dyad-write path="a.ts">body-a</dyad-write>'),
    });
    expect(state.kind).toBe("applied");
    if (state.kind !== "applied") return;
    expect(state.parserState.blocks.length).toBe(1);
    expect(state.parserState.blocks[0].kind).toBe("custom-tag");

    // Second patch appends another full custom-tag.
    const fullSoFar =
      '<dyad-write path="a.ts">body-a</dyad-write><dyad-write path="b.ts">body-b</dyad-write>';
    const patch2 = patch(
      // Server-absolute offset = end of first tag; renderer-local content is
      // empty after the previous trim, so the splice base is the absolute
      // length minus the cumulative dropped bytes.
      state.droppedBytes,
      '<dyad-write path="b.ts">body-b</dyad-write>',
      fullSoFar,
    );
    state = applyStreamingChunk({
      prevContent: state.content,
      prevParserState: state.parserState,
      prevDroppedBytes: state.droppedBytes,
      patch: patch2,
    });
    expect(state.kind).toBe("applied");
    if (state.kind !== "applied") return;
    expect(state.parserState.blocks.length).toBe(2);
    const paths = state.parserState.blocks
      .filter(
        (b): b is Extract<typeof b, { kind: "custom-tag" }> =>
          b.kind === "custom-tag",
      )
      .map((b) => b.attributes.path);
    expect(paths).toEqual(["a.ts", "b.ts"]);
  });

  it("keeps an in-progress custom-tag as the open block and trims around it", () => {
    let state = applyStreamingChunk({
      prevContent: "",
      prevParserState: undefined,
      prevDroppedBytes: 0,
      patch: patch(0, '<dyad-write path="a.ts">body-a</dyad-write>'),
    });
    expect(state.kind).toBe("applied");
    if (state.kind !== "applied") return;

    const fullSoFar =
      '<dyad-write path="a.ts">body-a</dyad-write><dyad-write path="b.ts">par';
    state = applyStreamingChunk({
      prevContent: state.content,
      prevParserState: state.parserState,
      prevDroppedBytes: state.droppedBytes,
      patch: patch(
        state.droppedBytes,
        '<dyad-write path="b.ts">par',
        fullSoFar,
      ),
    });
    expect(state.kind).toBe("applied");
    if (state.kind !== "applied") return;
    // a.ts committed, b.ts is the open block.
    expect(state.parserState.blocks.length).toBe(1);
    expect(state.parserState.openBlock?.kind).toBe("custom-tag");
    if (state.parserState.openBlock?.kind !== "custom-tag") return;
    expect(state.parserState.openBlock.attributes.path).toBe("b.ts");
    // Local content starts at the open block's '<'.
    expect(state.content.startsWith('<dyad-write path="b.ts">par')).toBe(true);
    expect(state.parserState.openBlockStartOffset).toBe(0);
  });

  it("returns mismatch when the offset is beyond the local content", () => {
    const result = applyStreamingChunk({
      prevContent: "abc",
      prevParserState: initialParserState(),
      prevDroppedBytes: 0,
      patch: patch(99, "tail"),
    });
    expect(result.kind).toBe("mismatch");
  });

  it("returns mismatch when prefix hash disagrees with local content", () => {
    const result = applyStreamingChunk({
      prevContent: "abc",
      prevParserState: initialParserState(),
      prevDroppedBytes: 0,
      patch: { offset: 3, content: "tail", prefixHash: 0xdeadbeef },
    });
    expect(result.kind).toBe("mismatch");
  });

  it("skips the prefix hash check after bytes have been dropped", () => {
    // priorBytesDropped > 0 means the renderer no longer holds the agreed
    // prefix; the pipeline must accept the patch despite a stale hash.
    const result = applyStreamingChunk({
      prevContent: "open-block-tail",
      prevParserState: initialParserState(),
      prevDroppedBytes: 100,
      // server-absolute offset = 100 + 15 (length of prevContent)
      patch: { offset: 115, content: "more", prefixHash: 0xdeadbeef },
    });
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(result.content.endsWith("more")).toBe(true);
  });

  it("returns noop when the patch produces identical content", () => {
    const init = applyStreamingChunk({
      prevContent: "",
      prevParserState: undefined,
      prevDroppedBytes: 0,
      patch: patch(0, "Hello "),
    });
    expect(init.kind).toBe("applied");
    if (init.kind !== "applied") return;
    // markdown openBlock at offset 0 → no trim → content preserved.
    expect(init.content).toBe("Hello ");

    // An empty-tail patch at the current end produces identical content
    // (idempotent retransmit). Pipeline returns noop so the caller can
    // skip atom writes.
    const replay = applyStreamingChunk({
      prevContent: init.content,
      prevParserState: init.parserState,
      prevDroppedBytes: init.droppedBytes,
      patch: {
        offset: init.droppedBytes + init.content.length,
        content: "",
      },
    });
    expect(replay.kind).toBe("noop");
  });

  it("droppedBytes is monotonically non-decreasing across patches", () => {
    let state = applyStreamingChunk({
      prevContent: "",
      prevParserState: undefined,
      prevDroppedBytes: 0,
      patch: patch(0, "intro text "),
    });
    expect(state.kind).toBe("applied");
    if (state.kind !== "applied") return;
    let prevDropped = state.droppedBytes;

    const segments = [
      '<dyad-write path="f0.ts">b0</dyad-write>',
      '\n<dyad-write path="f1.ts">b1</dyad-write>',
      '\n<dyad-write path="f2.ts">b2</dyad-write>',
    ];
    let absoluteContent = "intro text ";
    for (const seg of segments) {
      const newAbsolute = absoluteContent + seg;
      const result = applyStreamingChunk({
        prevContent: state.content,
        prevParserState: state.parserState,
        prevDroppedBytes: state.droppedBytes,
        patch: patch(absoluteContent.length, seg, absoluteContent),
      });
      expect(result.kind).toBe("applied");
      if (result.kind !== "applied") return;
      expect(result.droppedBytes).toBeGreaterThanOrEqual(prevDropped);
      prevDropped = result.droppedBytes;
      state = result;
      absoluteContent = newAbsolute;
    }
    // After three full custom-tag commits all completed, the parser is in
    // clean prose with no open block; everything has been trimmed.
    expect(state.content).toBe("");
    expect(state.parserState.blocks.length).toBeGreaterThanOrEqual(3);
  });
});
