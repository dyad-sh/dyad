import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    const longContent = "x".repeat(TOOL_RESULT_TRUNCATION_LIMIT + 100);
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
    expect(result).toMatchInlineSnapshot(`
      "<transcript chatId="5" messageCount="2" compactedAt="2026-02-05T14:30:00.000Z">

      <msg role="user">
      Hello
      </msg>

      <msg role="assistant">
      Hi there!
      </msg>

      </transcript>"
    `);
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
    expect(result).toMatchInlineSnapshot(`
      "<transcript chatId="1" messageCount="2" compactedAt="2026-02-05T14:30:00.000Z">

      <msg role="user">
      Read my file
      </msg>

      <msg role="assistant">
      Sure.
      <tool-use name="read_file" server="fs">
      {"path": "/a.ts"}
      </tool-use>
      <tool-result name="read_file" server="fs" chars="5">
      short
      </tool-result>
      </msg>

      </transcript>"
    `);
  });

  it("truncates large tool results inside transcript messages", () => {
    const largeResult = "A".repeat(TOOL_RESULT_TRUNCATION_LIMIT + 100);
    const messages: CompactionMessage[] = [
      { role: "user", content: "Read the big file" },
      {
        role: "assistant",
        content: `Here it is.\n<dyad-mcp-tool-call server="fs" tool="read_file">\n{"path": "/big.ts"}\n</dyad-mcp-tool-call>\n<dyad-mcp-tool-result server="fs" tool="read_file">\n${largeResult}\n</dyad-mcp-tool-result>\nThat's a lot of content.`,
      },
    ];

    const result = formatAsTranscript(messages, 10);
    // Truncated to TOOL_RESULT_TRUNCATION_LIMIT with "..." appended
    expect(result).toContain(`chars="${largeResult.length}"`);
    expect(result).toContain('truncated="true"');
    expect(result).toContain("A".repeat(TOOL_RESULT_TRUNCATION_LIMIT));
    expect(result).not.toContain("A".repeat(TOOL_RESULT_TRUNCATION_LIMIT + 1));
    expect(result).toContain("\n...");
    // Text around the tool block is preserved
    expect(result).toContain("Here it is.");
    expect(result).toContain("That's a lot of content.");
  });

  it("handles multi-turn conversation with interleaved tool use", () => {
    const messages: CompactionMessage[] = [
      { role: "user", content: "What's in index.ts?" },
      {
        role: "assistant",
        content: `Let me check.\n<dyad-mcp-tool-call server="fs" tool="read_file">\n{"path": "/src/index.ts"}\n</dyad-mcp-tool-call>\n<dyad-mcp-tool-result server="fs" tool="read_file">\nexport default App;\n</dyad-mcp-tool-result>\nIt exports App.`,
      },
      { role: "user", content: "Now rename App to Main everywhere." },
      {
        role: "assistant",
        content: `I'll update both files.\n<dyad-mcp-tool-call server="fs" tool="write_file">\n{"path": "/src/index.ts", "content": "export default Main;"}\n</dyad-mcp-tool-call>\n<dyad-mcp-tool-result server="fs" tool="write_file">\nsuccess\n</dyad-mcp-tool-result>\n<dyad-mcp-tool-call server="fs" tool="write_file">\n{"path": "/src/app.ts", "content": "const Main = () => {};"}\n</dyad-mcp-tool-call>\n<dyad-mcp-tool-result server="fs" tool="write_file">\nsuccess\n</dyad-mcp-tool-result>\nDone, renamed in both files.`,
      },
      { role: "user", content: "Thanks!" },
    ];

    const result = formatAsTranscript(messages, 42);
    // Correct metadata
    expect(result).toContain('chatId="42"');
    expect(result).toContain('messageCount="5"');
    // All 5 messages present
    expect(result.match(/<msg role="/g)).toHaveLength(5);
    // 3 tool-use and 3 tool-result (one in first assistant, two in second)
    expect(result.match(/<tool-use /g)).toHaveLength(3);
    expect(result.match(/<tool-result /g)).toHaveLength(3);
    // No original dyad tags remain
    expect(result).not.toContain("dyad-mcp");
    // Plain-text user messages are untouched
    expect(result).toContain("What's in index.ts?");
    expect(result).toContain("Now rename App to Main everywhere.");
    expect(result).toContain("Thanks!");
    // Interleaved assistant prose is preserved
    expect(result).toContain("Let me check.");
    expect(result).toContain("It exports App.");
    expect(result).toContain("I'll update both files.");
    expect(result).toContain("Done, renamed in both files.");
  });

  it("handles assistant messages mixing multiple servers", () => {
    const messages: CompactionMessage[] = [
      { role: "user", content: "Search and then write a file" },
      {
        role: "assistant",
        content: [
          "I'll search first.",
          '<dyad-mcp-tool-call server="search" tool="grep">',
          '{"pattern": "TODO"}',
          "</dyad-mcp-tool-call>",
          '<dyad-mcp-tool-result server="search" tool="grep">',
          "src/a.ts:3: // TODO fix",
          "</dyad-mcp-tool-result>",
          "Found one. Now writing the fix.",
          '<dyad-mcp-tool-call server="filesystem" tool="write_file">',
          '{"path": "/src/a.ts", "content": "fixed"}',
          "</dyad-mcp-tool-call>",
          '<dyad-mcp-tool-result server="filesystem" tool="write_file">',
          "ok",
          "</dyad-mcp-tool-result>",
        ].join("\n"),
      },
    ];

    const result = formatAsTranscript(messages, 7);
    // Different servers are preserved on the right tags
    expect(result).toContain('<tool-use name="grep" server="search">');
    expect(result).toContain('<tool-result name="grep" server="search"');
    expect(result).toContain(
      '<tool-use name="write_file" server="filesystem">',
    );
    expect(result).toContain(
      '<tool-result name="write_file" server="filesystem"',
    );
    // Prose between tool blocks is retained
    expect(result).toContain("I'll search first.");
    expect(result).toContain("Found one. Now writing the fix.");
  });

  it("preserves messages that contain XML-like content but not tool tags", () => {
    const messages: CompactionMessage[] = [
      {
        role: "user",
        content:
          'My component renders <div className="app"> and I see a <span> tag.',
      },
      {
        role: "assistant",
        content:
          'Yes, the JSX <div className="app"> is valid. You could also use <Fragment>.',
      },
    ];

    const result = formatAsTranscript(messages, 3);
    expect(result).toContain('<div className="app">');
    expect(result).toContain("<span>");
    expect(result).toContain("<Fragment>");
    // No tool tags should appear
    expect(result).not.toContain("<tool-use");
    expect(result).not.toContain("<tool-result");
  });

  it("handles a long conversation with some messages having no tools", () => {
    const messages: CompactionMessage[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello! How can I help?" },
      { role: "user", content: "What frameworks do you recommend?" },
      {
        role: "assistant",
        content: "I recommend React or Vue. Want me to check your setup?",
      },
      { role: "user", content: "Yes, check package.json" },
      {
        role: "assistant",
        content: `Sure.\n<dyad-mcp-tool-call server="fs" tool="read_file">\n{"path": "/package.json"}\n</dyad-mcp-tool-call>\n<dyad-mcp-tool-result server="fs" tool="read_file">\n{"dependencies":{"react":"^18"}}\n</dyad-mcp-tool-result>\nYou already have React 18!`,
      },
      { role: "user", content: "Great, that's all I needed." },
      { role: "assistant", content: "Happy to help!" },
    ];

    const result = formatAsTranscript(messages, 100);
    expect(result).toContain('messageCount="8"');
    expect(result.match(/<msg role="user">/g)).toHaveLength(4);
    expect(result.match(/<msg role="assistant">/g)).toHaveLength(4);
    // Only one tool exchange in the entire conversation
    expect(result.match(/<tool-use /g)).toHaveLength(1);
    expect(result.match(/<tool-result /g)).toHaveLength(1);
    // First and last messages are simple text
    expect(result).toContain('<msg role="user">\nHi\n</msg>');
    expect(result).toContain('<msg role="assistant">\nHappy to help!\n</msg>');
  });

  it("produces valid structure for empty message list", () => {
    const result = formatAsTranscript([], 99);
    expect(result).toMatchInlineSnapshot(`
      "<transcript chatId="99" messageCount="0" compactedAt="2026-02-05T14:30:00.000Z">



      </transcript>"
    `);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
