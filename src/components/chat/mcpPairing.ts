import type { Block } from "@/lib/streamingMessageParser";

export type CustomTagBlock = Extract<Block, { kind: "custom-tag" }>;

export interface McpPairing {
  /** call-id -> the matching tool-result block. */
  resultByCallId: Map<string, CustomTagBlock>;
  /** call-ids that have a tool-call block, i.e. a card on screen. */
  callIds: Set<string>;
}

// Shared read-only sentinel returned when a message has no MCP tool blocks.
// Never mutate it.
export const EMPTY_MCP_PAIRING: McpPairing = {
  resultByCallId: new Map(),
  callIds: new Set(),
};

// Index MCP tool blocks by call-id so the renderer can collapse a call and its
// result into one card. A plain linear scan: `closedBlocks` only changes when a
// block closes (not per streamed token), so this runs on close events, not on
// the streaming hot path. Returns the shared empty sentinel (no allocation)
// when the message has no MCP tool blocks.
export function buildMcpPairing(blocks: Block[]): McpPairing {
  let pairing: McpPairing | null = null;
  for (const b of blocks) {
    if (b.kind !== "custom-tag") continue;
    const callId = b.attributes["call-id"];
    if (!callId) continue;
    if (b.tag !== "dyad-mcp-tool-call" && b.tag !== "dyad-mcp-tool-result") {
      continue;
    }
    pairing ??= { resultByCallId: new Map(), callIds: new Set() };
    if (b.tag === "dyad-mcp-tool-call") {
      pairing.callIds.add(callId);
    } else {
      pairing.resultByCallId.set(callId, b);
    }
  }
  return pairing ?? EMPTY_MCP_PAIRING;
}
