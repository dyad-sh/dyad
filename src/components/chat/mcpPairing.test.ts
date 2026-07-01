import { describe, expect, it } from "vitest";
import { buildMcpPairing } from "./mcpPairing";
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

  it("leaves a call unpaired when its result has not arrived yet", () => {
    const xml = [
      `<dyad-mcp-tool-call server="s" tool="slow" call-id="A">`,
      `{"a":1}`,
      `</dyad-mcp-tool-call>`,
    ].join("\n");
    const pairing = buildMcpPairing(parseFullMessage(xml).blocks);

    expect(pairing.callIds).toEqual(new Set(["A"]));
    expect(pairing.resultByCallId.has("A")).toBe(false);
  });

  it("does not mark an unmatched result for hiding (no matching call id)", () => {
    // A result whose call block is absent must stay visible: the renderer hides
    // a result only when callIds contains its call-id.
    const xml = [
      `<dyad-mcp-tool-result server="s" tool="orphan" call-id="Z">`,
      `orphaned`,
      `</dyad-mcp-tool-result>`,
    ].join("\n");
    const pairing = buildMcpPairing(parseFullMessage(xml).blocks);

    expect(pairing.callIds.has("Z")).toBe(false);
    expect(pairing.resultByCallId.get("Z")?.content).toContain("orphaned");
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
  });
});
