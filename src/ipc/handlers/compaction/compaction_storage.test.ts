import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatAsTranscript,
  type CompactionMessage,
} from "@/ipc/handlers/compaction/compaction_storage";

describe("formatAsTranscript", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-05T14:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves messages in a timestamped transcript", () => {
    const messages: CompactionMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    expect(formatAsTranscript(messages, 5)).toMatchInlineSnapshot(`
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

  it("keeps XML-like message content unchanged", () => {
    const content =
      '<dyad-read path="src/App.tsx">result</dyad-read>\n<div>Preview</div>';

    expect(formatAsTranscript([{ role: "assistant", content }], 3)).toContain(
      content,
    );
  });

  it("preserves message order across a conversation", () => {
    const result = formatAsTranscript(
      [
        { role: "user", content: "First" },
        { role: "assistant", content: "Second" },
        { role: "user", content: "Third" },
      ],
      42,
    );

    expect(result.indexOf("First")).toBeLessThan(result.indexOf("Second"));
    expect(result.indexOf("Second")).toBeLessThan(result.indexOf("Third"));
  });

  it("supports an empty transcript", () => {
    expect(formatAsTranscript([], 99)).toContain(
      '<transcript chatId="99" messageCount="0"',
    );
  });
});
