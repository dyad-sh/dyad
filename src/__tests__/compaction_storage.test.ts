import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  transformToolTags,
  formatAsTranscript,
  TOOL_RESULT_TRUNCATION_LIMIT,
  type CompactionMessage,
} from "../ipc/handlers/compaction/compaction_storage";

describe("transformToolTags", () => {
  it("passes through content without tool tags unchanged", () => {
    const content = "Hello, can you help me with this code?";
    expect(transformToolTags(content)).toBe(content);
  });

  it("transforms tool-call tags to shorter tool-use tags", () => {
    const content = `Let me read that file.
<dyad-mcp-tool-call server="filesystem" tool="read_file">
{"path": "/src/index.ts"}
</dyad-mcp-tool-call>`;

    const result = transformToolTags(content);
    expect(result).toContain('<tool-use name="read_file" server="filesystem">');
    expect(result).toContain('{"path": "/src/index.ts"}');
    expect(result).toContain("</tool-use>");
    expect(result).not.toContain("dyad-mcp-tool-call");
  });

  it("transforms tool-result tags and includes char count", () => {
    const content = `<dyad-mcp-tool-result server="filesystem" tool="read_file">
short result
</dyad-mcp-tool-result>`;

    const result = transformToolTags(content);
    expect(result).toContain(
      '<tool-result name="read_file" server="filesystem"',
    );
    expect(result).toContain('chars="12"');
    expect(result).toContain("short result");
    expect(result).toContain("</tool-result>");
    expect(result).not.toContain("truncated");
  });

  it("truncates large tool results", () => {
    const longContent = "x".repeat(500);
    const content = `<dyad-mcp-tool-result server="filesystem" tool="read_file">
${longContent}
</dyad-mcp-tool-result>`;

    const result = transformToolTags(content);
    expect(result).toContain(`chars="${longContent.length}"`);
    expect(result).toContain('truncated="true"');
    expect(result).toContain("x".repeat(TOOL_RESULT_TRUNCATION_LIMIT));
    expect(result).toContain("\n...");
    expect(result).not.toContain("x".repeat(TOOL_RESULT_TRUNCATION_LIMIT + 1));
  });

  it("does not truncate results at exactly the limit", () => {
    const exactContent = "y".repeat(TOOL_RESULT_TRUNCATION_LIMIT);
    const content = `<dyad-mcp-tool-result server="fs" tool="read">
${exactContent}
</dyad-mcp-tool-result>`;

    const result = transformToolTags(content);
    expect(result).not.toContain("truncated");
    expect(result).toContain(exactContent);
  });

  it("handles multiple tool calls and results in one message", () => {
    const content = `I'll read both files.
<dyad-mcp-tool-call server="fs" tool="read_file">
{"path": "/a.ts"}
</dyad-mcp-tool-call>
<dyad-mcp-tool-result server="fs" tool="read_file">
contents of a
</dyad-mcp-tool-result>
<dyad-mcp-tool-call server="fs" tool="read_file">
{"path": "/b.ts"}
</dyad-mcp-tool-call>
<dyad-mcp-tool-result server="fs" tool="read_file">
contents of b
</dyad-mcp-tool-result>`;

    const result = transformToolTags(content);
    // Both tool calls transformed
    expect(result.match(/<tool-use /g)).toHaveLength(2);
    expect(result.match(/<tool-result /g)).toHaveLength(2);
    expect(result).not.toContain("dyad-mcp");
  });

  it("preserves text between tool calls", () => {
    const content = `First I'll check the file.
<dyad-mcp-tool-call server="fs" tool="read_file">
{"path": "/a.ts"}
</dyad-mcp-tool-call>
<dyad-mcp-tool-result server="fs" tool="read_file">
ok
</dyad-mcp-tool-result>
Now let me modify it.
<dyad-mcp-tool-call server="fs" tool="write_file">
{"path": "/a.ts", "content": "new"}
</dyad-mcp-tool-call>
<dyad-mcp-tool-result server="fs" tool="write_file">
success
</dyad-mcp-tool-result>`;

    const result = transformToolTags(content);
    expect(result).toContain("First I'll check the file.");
    expect(result).toContain("Now let me modify it.");
  });
});

describe("formatAsTranscript", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-05T14:30:00.000Z"));
  });

  it("wraps messages in transcript and msg tags", () => {
    const messages: CompactionMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    const result = formatAsTranscript(messages, 5);
    expect(result).toContain('<transcript chatId="5" messageCount="2"');
    expect(result).toContain('compactedAt="2026-02-05T14:30:00.000Z"');
    expect(result).toContain('<msg role="user">\nHello\n</msg>');
    expect(result).toContain('<msg role="assistant">\nHi there!\n</msg>');
    expect(result).toContain("</transcript>");
  });

  it("transforms tool tags inside messages", () => {
    const messages: CompactionMessage[] = [
      { role: "user", content: "Read my file" },
      {
        role: "assistant",
        content: `Sure.\n<dyad-mcp-tool-call server="fs" tool="read_file">\n{"path": "/a.ts"}\n</dyad-mcp-tool-call>\n<dyad-mcp-tool-result server="fs" tool="read_file">\nshort\n</dyad-mcp-tool-result>`,
      },
    ];

    const result = formatAsTranscript(messages, 1);
    expect(result).toContain("<tool-use");
    expect(result).toContain("<tool-result");
    expect(result).not.toContain("dyad-mcp");
  });

  it("produces valid structure for empty message list", () => {
    const result = formatAsTranscript([], 99);
    expect(result).toContain('messageCount="0"');
    expect(result).toContain("</transcript>");
  });

  vi.useRealTimers;
});
