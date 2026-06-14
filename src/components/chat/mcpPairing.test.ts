import { describe, expect, it } from "vitest";
import { advanceMcpPairing, buildMcpPairing } from "./DyadMarkdownParser";
import { parseFullMessage } from "@/lib/streamingMessageParser";

// Builds the block list for the out-of-order interleaving the AI SDK emits
// for two parallel tools: callA, callB, then results in completion order.
function outOfOrderBlocks() {
  const xml = [
    `<dyad-mcp-tool-call server="s" tool="slow" call-id="A">`,
    `{"a":1}`,
    `</dyad-mcp-tool-call>`,
    `<dyad-mcp-tool-call server="s" tool="fast" call-id="B">`,
    `{"b":2}`,
    `</dyad-mcp-tool-call>`,
    `<dyad-mcp-tool-result server="s" tool="fast" call-id="B">`,
    `fastresult`,
    `</dyad-mcp-tool-result>`,
    `<dyad-mcp-tool-result server="s" tool="slow" call-id="A">`,
    `slowresult`,
    `</dyad-mcp-tool-result>`,
  ].join("\n");
  return parseFullMessage(xml).blocks;
}

describe("buildMcpPairing", () => {
  it("pairs results to calls by call-id across out-of-order interleaving", () => {
    const pairing = buildMcpPairing(outOfOrderBlocks());

    expect(pairing.callIds).toEqual(new Set(["A", "B"]));
    expect(pairing.resultByCallId.get("A")?.content).toContain("slowresult");
    expect(pairing.resultByCallId.get("B")?.content).toContain("fastresult");
  });

  it("hides exactly the result blocks (calls stay visible)", () => {
    const blocks = outOfOrderBlocks();
    const pairing = buildMcpPairing(blocks);

    const resultIds = blocks
      .filter(
        (b) => b.kind === "custom-tag" && b.tag === "dyad-mcp-tool-result",
      )
      .map((b) => b.id);
    expect(pairing.hiddenResultIds).toEqual(new Set(resultIds));
  });

  it("leaves a call unpaired when its result has not arrived yet", () => {
    const xml = [
      `<dyad-mcp-tool-call server="s" tool="slow" call-id="A">`,
      `{"a":1}`,
      `</dyad-mcp-tool-call>`,
    ].join("\n");
    const pairing = buildMcpPairing(parseFullMessage(xml).blocks);

    expect(pairing.callIds).toEqual(new Set(["A"]));
    expect(pairing.resultByCallId.has("A")).toBe(false);
    expect(pairing.hiddenResultIds.size).toBe(0);
  });

  it("incrementally extending the tail matches a full rebuild", () => {
    const blocks = outOfOrderBlocks();

    // Feed the blocks one at a time, mutating the same accumulator the way the
    // component's ref-backed cache does (fromIndex advances past prior blocks).
    let acc = null as ReturnType<typeof advanceMcpPairing>;
    for (let i = 0; i < blocks.length; i++) {
      acc = advanceMcpPairing(acc, blocks, i);
    }

    const full = buildMcpPairing(blocks);
    expect(acc).not.toBeNull();
    expect(acc!.callIds).toEqual(full.callIds);
    expect([...acc!.resultByCallId.entries()]).toEqual([
      ...full.resultByCallId.entries(),
    ]);
    expect(acc!.hiddenResultIds).toEqual(full.hiddenResultIds);
  });

  it("returns null until the first MCP block (so callers keep the singleton)", () => {
    const blocks = parseFullMessage(
      "hello\n<dyad-write path='a'>x</dyad-write>",
    ).blocks;
    expect(advanceMcpPairing(null, blocks, 0)).toBeNull();
  });

  it("ignores legacy blocks without a call-id", () => {
    const xml = [
      `<dyad-mcp-tool-call server="s" tool="t">`,
      `{"a":1}`,
      `</dyad-mcp-tool-call>`,
      `<dyad-mcp-tool-result server="s" tool="t">`,
      `r`,
      `</dyad-mcp-tool-result>`,
    ].join("\n");
    const pairing = buildMcpPairing(parseFullMessage(xml).blocks);

    expect(pairing.callIds.size).toBe(0);
    expect(pairing.resultByCallId.size).toBe(0);
    expect(pairing.hiddenResultIds.size).toBe(0);
  });
});
