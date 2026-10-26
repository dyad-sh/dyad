import { describe, expect, it } from "vitest";
import { MCP_RESULT_MAX_BYTES } from "./mcp_result_sanitizer";
import {
  MCP_CONSENT_PREVIEW_MAX_CHARS,
  prepareMcpToolCallArgs,
} from "./mcp_tool_call_args";

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    objectId: `object_${index % 100}`,
    frame: Math.floor(index / 100),
    x: index * 1.5,
  }));
}

describe("prepareMcpToolCallArgs", () => {
  it("keeps the existing pretty JSON and preview for small arguments", () => {
    const args = { path: "/a.txt", content: "hello" };

    expect(prepareMcpToolCallArgs(args)).toEqual({
      transcriptText: JSON.stringify(args, null, 2),
      consentPreview: JSON.stringify(args),
      truncated: false,
    });
  });

  it("stores compact JSON when only the pretty form exceeds the cap", () => {
    const args = { rows: rows(2000) };
    const compact = JSON.stringify(args);
    expect(compact.length).toBeLessThan(MCP_RESULT_MAX_BYTES - 4096);
    expect(JSON.stringify(args, null, 2).length).toBeGreaterThan(
      MCP_RESULT_MAX_BYTES,
    );

    const prepared = prepareMcpToolCallArgs(args);

    expect(prepared.truncated).toBe(false);
    expect(prepared.transcriptText).toBe(compact);
  });

  it("caps huge object arguments without changing them", () => {
    const args = { table: "frames", rows: rows(200_000) };
    const before = args.rows.length;

    const prepared = prepareMcpToolCallArgs(args);

    expect(prepared.truncated).toBe(true);
    expect(
      Buffer.byteLength(prepared.transcriptText, "utf8"),
    ).toBeLessThanOrEqual(MCP_RESULT_MAX_BYTES);
    const stored = JSON.parse(prepared.transcriptText);
    expect(stored.table).toBe("frames");
    expect(stored.rows.length).toBeGreaterThan(0);
    expect(stored._dyadMcpTruncation).toMatchObject({ truncated: true });
    expect(prepared.consentPreview).toHaveLength(MCP_CONSENT_PREVIEW_MAX_CHARS);
    expect(args.rows).toHaveLength(before);
    expect("_dyadMcpTruncation" in args).toBe(false);
  });

  it("caps huge string arguments and their consent preview", () => {
    const args = "x".repeat(5 * 1024 * 1024);

    const prepared = prepareMcpToolCallArgs(args);

    expect(prepared.truncated).toBe(true);
    expect(
      Buffer.byteLength(prepared.transcriptText, "utf8"),
    ).toBeLessThanOrEqual(MCP_RESULT_MAX_BYTES);
    expect(prepared.consentPreview).toBe(
      "x".repeat(MCP_CONSENT_PREVIEW_MAX_CHARS),
    );
  });

  it("previews array arguments like join without joining every item", () => {
    const args = ["ls", null, "-la", "y".repeat(10_000), "never-reached"];

    expect(prepareMcpToolCallArgs(args).consentPreview).toBe(
      args.join(" ").slice(0, MCP_CONSENT_PREVIEW_MAX_CHARS),
    );
  });
});
