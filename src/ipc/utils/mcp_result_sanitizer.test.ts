import { describe, expect, it } from "vitest";
import {
  MCP_RESULT_MAX_BYTES,
  MCP_RESULT_MAX_EMBEDDED_MEDIA_BYTES,
  MCP_RESULT_MAX_ITEMS,
  sanitizeMcpToolResult,
} from "./mcp_result_sanitizer";

describe("sanitizeMcpToolResult", () => {
  it("preserves ordinary text and structured MCP results", () => {
    expect(sanitizeMcpToolResult("hello")).toEqual({
      value: "hello",
      serialized: "hello",
      truncated: false,
    });

    const input = {
      content: [{ type: "text", text: "hello" }],
      structuredContent: { count: 2, names: ["a", "b"] },
      isError: false,
    };
    const result = sanitizeMcpToolResult(input);
    expect(result.value).toEqual(input);
    expect(JSON.parse(result.serialized)).toEqual(input);
    expect(result.truncated).toBe(false);
  });

  it("caps huge strings at the hard UTF-8 byte budget", () => {
    const result = sanitizeMcpToolResult("x".repeat(MCP_RESULT_MAX_BYTES * 4));

    expect(result.truncated).toBe(true);
    expect(result.serialized).toContain("Dyad truncated MCP result");
    expect(Buffer.byteLength(result.serialized, "utf8")).toBeLessThanOrEqual(
      MCP_RESULT_MAX_BYTES,
    );
  });

  it("never splits a multi-byte character or surrogate pair", () => {
    const result = sanitizeMcpToolResult("🧠".repeat(MCP_RESULT_MAX_BYTES));

    expect(result.truncated).toBe(true);
    expect(result.serialized).not.toContain("�");
    expect(result.serialized).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u,
    );
    expect(result.serialized).not.toMatch(
      /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
    );
    expect(Buffer.byteLength(result.serialized, "utf8")).toBeLessThanOrEqual(
      MCP_RESULT_MAX_BYTES,
    );
  });

  it("bounds nested JSON by depth and aggregate item count", () => {
    const nested: Record<string, unknown> = {};
    let cursor = nested;
    for (let i = 0; i < 30; i += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    nested.rows = Array.from({ length: MCP_RESULT_MAX_ITEMS * 3 }, (_, i) => ({
      id: i,
    }));

    const result = sanitizeMcpToolResult(nested);
    const parsed = JSON.parse(result.serialized);
    expect(result.truncated).toBe(true);
    expect(parsed._dyadMcpTruncation.reasons).toEqual(
      expect.arrayContaining(["depth-limit", "item-limit"]),
    );
    expect(Buffer.byteLength(result.serialized, "utf8")).toBeLessThanOrEqual(
      MCP_RESULT_MAX_BYTES,
    );
  });

  it("replaces oversized image and resource blobs while retaining metadata references", () => {
    const hugeBase64 = "A".repeat(
      Math.ceil((MCP_RESULT_MAX_EMBEDDED_MEDIA_BYTES * 8) / 3) * 4,
    );
    const input = {
      content: [
        { type: "image", data: hugeBase64, mimeType: "image/png" },
        {
          type: "resource",
          resource: {
            uri: "file:///report.bin",
            mimeType: "application/octet-stream",
            blob: hugeBase64,
          },
        },
      ],
    };

    const result = sanitizeMcpToolResult(input);
    const parsed = JSON.parse(result.serialized);
    expect(result.truncated).toBe(true);
    expect(result.serialized).not.toContain(hugeBase64);
    expect(parsed.content[0]).toMatchObject({
      type: "image",
      data: "",
      mimeType: "image/png",
      _dyadOmittedMedia: { omitted: true, kind: "image" },
    });
    expect(parsed.content[1].resource).toMatchObject({
      uri: "file:///report.bin",
      blob: "",
      _dyadOmittedMedia: { omitted: true, kind: "resource-blob" },
    });
  });

  it("replaces oversized base64 fields inside arbitrary structured content", () => {
    const hugeBase64 = "B".repeat(
      Math.ceil((MCP_RESULT_MAX_EMBEDDED_MEDIA_BYTES * 8) / 3) * 4,
    );
    const result = sanitizeMcpToolResult({
      structuredContent: { nested: { blob: hugeBase64 } },
    });
    const parsed = JSON.parse(result.serialized);

    expect(result.truncated).toBe(true);
    expect(result.serialized).not.toContain(hugeBase64);
    expect(parsed.structuredContent.nested.blob).toMatchObject({
      _dyadOmittedMedia: { omitted: true, kind: "blob" },
    });
  });

  it("enforces the aggregate media item limit without reprocessing summaries", () => {
    const tinyBlob = "AAAA";
    const result = sanitizeMcpToolResult({
      content: Array.from({ length: 6 }, (_, index) => ({
        type: "resource",
        resource: {
          uri: `file:///resource-${index}.bin`,
          blob: tinyBlob,
        },
      })),
    });
    const parsed = JSON.parse(result.serialized);

    expect(result.truncated).toBe(true);
    expect(parsed._dyadMcpTruncation.reasons).toContain("media-item-limit");
    expect(parsed.content[4].resource._dyadOmittedMedia.reason).toBe(
      "media-item-limit",
    );
    expect(parsed.content[5].resource._dyadOmittedMedia.reason).toBe(
      "media-item-limit",
    );
  });

  it("does not count ordinary data and blob strings as embedded media", () => {
    const input = {
      rows: Array.from({ length: 8 }, (_, index) => ({
        data: index % 2 === 0 ? "success" : "pending",
        blob: `record-${index}`,
      })),
    };

    const result = sanitizeMcpToolResult(input);

    expect(result).toEqual({
      value: input,
      serialized: JSON.stringify(input),
      truncated: false,
    });
  });

  it("counts discarded overlong keys against the aggregate item limit", () => {
    const input = Object.fromEntries(
      Array.from({ length: MCP_RESULT_MAX_ITEMS * 2 }, (_, index) => [
        `${index}-${"k".repeat(600)}`,
        index,
      ]),
    );

    const result = sanitizeMcpToolResult(input);
    const parsed = JSON.parse(result.serialized);

    expect(result.truncated).toBe(true);
    expect(parsed._dyadMcpTruncation.reasons).toEqual(
      expect.arrayContaining(["byte-budget", "item-limit"]),
    );
    expect(parsed._dyadMcpTruncation.omittedItems).toBeGreaterThanOrEqual(
      MCP_RESULT_MAX_ITEMS,
    );
  });

  it("preserves __proto__ as an own data property without mutating prototypes", () => {
    const input = JSON.parse(
      '{"__proto__":{"polluted":true},"safe":"value"}',
    ) as Record<string, unknown>;

    const result = sanitizeMcpToolResult(input);
    const value = result.value as Record<string, unknown>;
    const parsed = JSON.parse(result.serialized);

    expect(result.truncated).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(value, "__proto__")).toBe(true);
    expect(value.__proto__).toEqual({ polluted: true });
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(parsed).toEqual(input);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("handles circular structures and binary values without serializing their contents", () => {
    const input: Record<string, unknown> = {
      bytes: new Uint8Array(MCP_RESULT_MAX_BYTES * 2),
    };
    input.self = input;

    const result = sanitizeMcpToolResult(input);
    const parsed = JSON.parse(result.serialized);
    expect(result.truncated).toBe(true);
    expect(parsed.bytes._dyadOmittedBinary.bytes).toBe(
      MCP_RESULT_MAX_BYTES * 2,
    );
    expect(parsed.self).toContain("circular");
    expect(Buffer.byteLength(result.serialized, "utf8")).toBeLessThanOrEqual(
      MCP_RESULT_MAX_BYTES,
    );
  });
});
