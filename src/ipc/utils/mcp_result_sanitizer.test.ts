import { describe, expect, it } from "vitest";
import {
  MCP_RESULT_MAX_BYTES,
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

  it("does not impose depth or item-count limits", () => {
    const nested: Record<string, unknown> = {};
    let cursor = nested;
    for (let i = 0; i < 30; i += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    cursor.rows = Array.from({ length: 300 }, (_, i) => ({ id: i }));

    const result = sanitizeMcpToolResult(nested);
    expect(result.truncated).toBe(false);
    expect(JSON.parse(result.serialized)).toEqual(nested);
  });

  it("does not impose a separate embedded-media limit", () => {
    const base64 = "A".repeat(32 * 1024);
    const input = {
      content: [
        { type: "image", data: base64, mimeType: "image/png" },
        {
          type: "resource",
          resource: {
            uri: "file:///report.bin",
            mimeType: "application/octet-stream",
            blob: base64,
          },
        },
      ],
    };

    const result = sanitizeMcpToolResult(input);
    expect(result).toEqual({
      value: input,
      serialized: JSON.stringify(input),
      truncated: false,
    });
  });

  it("bounds results with keys that exhaust the byte budget", () => {
    const input = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [
        `${index}-${"k".repeat(1024)}`,
        index,
      ]),
    );

    const result = sanitizeMcpToolResult(input);
    const parsed = JSON.parse(result.serialized);

    expect(result.truncated).toBe(true);
    expect(parsed._dyadMcpTruncation.reasons).toEqual(["byte-budget"]);
    expect(parsed._dyadMcpTruncation.limits).toEqual({
      maxBytes: MCP_RESULT_MAX_BYTES,
    });
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
