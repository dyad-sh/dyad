import { describe, expect, it } from "vitest";
import {
  MCP_TRANSCRIPT_MIN_PREVIEW_CHARS,
  MCP_TRANSCRIPT_PAYLOAD_MAX_CHARS,
  MCP_TRANSCRIPT_TURN_BUDGET_CHARS,
  createMcpTranscriptBudget,
  previewMcpPayload,
  truncatedFromAttr,
} from "./mcp_transcript_preview";

describe("previewMcpPayload", () => {
  it("keeps small payloads whole and charges the budget", () => {
    const budget = createMcpTranscriptBudget();
    const preview = previewMcpPayload('{"a":1}', budget);
    expect(preview).toEqual({ text: '{"a":1}' });
    expect(truncatedFromAttr(preview)).toBe("");
    expect(budget.usedChars).toBe(7);
  });

  it("caps a single payload at the per-payload limit", () => {
    const budget = createMcpTranscriptBudget();
    const text = "x".repeat(MCP_TRANSCRIPT_PAYLOAD_MAX_CHARS + 10);
    const preview = previewMcpPayload(text, budget);
    expect(preview.text).toHaveLength(MCP_TRANSCRIPT_PAYLOAD_MAX_CHARS);
    expect(preview.truncatedFrom).toBe(text.length);
    expect(truncatedFromAttr(preview)).toBe(` truncated-from="${text.length}"`);
  });

  it("shrinks payloads to the minimum preview once the turn budget is spent", () => {
    const budget = createMcpTranscriptBudget();
    const text = "y".repeat(MCP_TRANSCRIPT_PAYLOAD_MAX_CHARS);
    let total = 0;
    for (let i = 0; i < 100; i++) {
      total += previewMcpPayload(text, budget).text.length;
    }
    expect(total).toBeLessThanOrEqual(
      MCP_TRANSCRIPT_TURN_BUDGET_CHARS + 100 * MCP_TRANSCRIPT_MIN_PREVIEW_CHARS,
    );
    const late = previewMcpPayload(text, budget);
    expect(late.text).toHaveLength(MCP_TRANSCRIPT_MIN_PREVIEW_CHARS);
    expect(late.truncatedFrom).toBe(text.length);
  });

  it("does not split a surrogate pair at the cut", () => {
    const budget = createMcpTranscriptBudget();
    const text =
      "a".repeat(MCP_TRANSCRIPT_PAYLOAD_MAX_CHARS - 1) + "😀" + "tail";
    const preview = previewMcpPayload(text, budget);
    expect(preview.text).toHaveLength(MCP_TRANSCRIPT_PAYLOAD_MAX_CHARS - 1);
    expect(preview.text.endsWith("a")).toBe(true);
  });
});
