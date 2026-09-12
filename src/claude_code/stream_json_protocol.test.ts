import { describe, expect, it } from "vitest";
import { parseCliLine, toolResultText } from "./stream_json_protocol";

describe("parseCliLine", () => {
  it("parses the events Dyad consumes from Claude Code 2.1.260", () => {
    const init = parseCliLine(
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "s1",
        tools: ["Read"],
        mcp_servers: [{ name: "dyad", status: "connected" }],
        model: "claude-sonnet-5",
        apiKeySource: "none",
        claude_code_version: "2.1.260",
      }),
    );
    expect(init).toMatchObject({
      kind: "event",
      event: { type: "system", subtype: "init", session_id: "s1" },
    });

    const delta = parseCliLine(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "hi" },
        },
        parent_tool_use_id: null,
      }),
    );
    expect(delta).toMatchObject({
      kind: "event",
      event: { type: "stream_event", event: { delta: { text: "hi" } } },
    });

    const permission = parseCliLine(
      JSON.stringify({
        type: "control_request",
        request_id: "r1",
        request: {
          subtype: "can_use_tool",
          tool_name: "Write",
          input: { file_path: "/x" },
          tool_use_id: "t1",
        },
      }),
    );
    expect(permission).toMatchObject({
      kind: "event",
      event: { type: "control_request", request: { subtype: "can_use_tool" } },
    });

    const result = parseCliLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "s1",
        modelUsage: {
          "claude-sonnet-5": { inputTokens: 1, outputTokens: 2 },
        },
      }),
    );
    expect(result).toMatchObject({ kind: "event", event: { type: "result" } });
  });

  it("surfaces unknown event shapes and non-JSON lines without throwing", () => {
    expect(parseCliLine("")).toBeNull();
    expect(parseCliLine("Not logged in")).toEqual({
      kind: "invalid",
      raw: "Not logged in",
    });
    expect(
      parseCliLine(JSON.stringify({ type: "future_event", x: 1 })),
    ).toMatchObject({
      kind: "unknown",
    });
  });
});

describe("toolResultText", () => {
  it("flattens string, block arrays, and other payloads", () => {
    expect(toolResultText("plain")).toBe("plain");
    expect(
      toolResultText([
        { type: "text", text: "a" },
        { type: "image", data: "..." },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\n\nb");
    expect(toolResultText(null)).toBe("");
    expect(toolResultText({ ok: true })).toBe('{"ok":true}');
  });
});
