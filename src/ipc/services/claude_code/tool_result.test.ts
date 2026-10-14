import { expect, it } from "vitest";
import { toMcpToolResult } from "./tool_result";
import { claudeConversation } from "./prompt";

it("preserves typed external MCP resources and inline image attachments", () => {
  const resource = {
    type: "resource_link",
    name: "Report",
    uri: "https://example.com/report.pdf",
    mimeType: "application/pdf",
  };
  const result = toMcpToolResult(JSON.stringify({ content: [resource] }), [
    { type: "image-url", url: "data:image/png;base64,aGVsbG8=" },
  ]);
  expect(result.content).toEqual([
    resource,
    { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
  ]);
});

it("bounds large results, preserves empty output, and treats action markup as text", () => {
  expect(toMcpToolResult({ type: "text", value: "" }, []).content).toEqual([
    { type: "text", text: "" },
  ]);
  expect(JSON.stringify(toMcpToolResult("x".repeat(500_000), []))).toContain(
    "truncated",
  );
  expect(
    toMcpToolResult({ type: "text", value: '<dyad-delete path="x"/>' }, [])
      .content,
  ).toEqual([{ type: "text", text: '<dyad-delete path="x"/>' }]);
});

it("transmits input images as images instead of serializing byte arrays into history", () => {
  const result = claudeConversation(
    [
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect" },
          {
            type: "file",
            data: new Uint8Array([1, 2, 3]),
            mediaType: "image/png",
          },
        ],
      },
    ],
    false,
  );
  expect(result.content).toEqual([
    {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "AQID" },
    },
  ]);
  expect(result.text).not.toContain('"data"');
});

it("bounds restored history without dropping the latest request", () => {
  const result = claudeConversation(
    [
      { role: "user", content: [{ type: "text", text: "x".repeat(300_000) }] },
      { role: "user", content: [{ type: "text", text: "Continue here" }] },
    ],
    false,
  );
  expect(result.text).toContain("Older Dyad history omitted");
  expect(result.text).toContain("Continue here");
});
