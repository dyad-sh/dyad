import { describe, it, expect } from "vitest";
import { getPostCompactionMessages } from "../ipc/handlers/compaction/compaction_utils";

type Msg = { id: number; role: string; isCompactionSummary: boolean | null };

function msg(
  id: number,
  role: string,
  isCompactionSummary: boolean | null = null,
): Msg {
  return { id, role, isCompactionSummary };
}

describe("getPostCompactionMessages", () => {
  it("returns all messages when there is no compaction summary", () => {
    const messages = [
      msg(1, "user"),
      msg(2, "assistant"),
      msg(3, "user"),
      msg(4, "assistant"),
    ];
    expect(getPostCompactionMessages(messages)).toEqual(messages);
  });

  it("returns empty array when given empty input", () => {
    expect(getPostCompactionMessages([])).toEqual([]);
  });

  it("filters pre-compaction messages and keeps summary + triggering user message + subsequent", () => {
    // Scenario: messages 1-4 are pre-compaction, 5 is the triggering user msg,
    // 6 is the placeholder assistant, 7 is the compaction summary (highest ID)
    const messages = [
      msg(1, "user"),
      msg(2, "assistant"),
      msg(3, "user"),
      msg(4, "assistant"),
      msg(5, "user"), // triggering user message
      msg(6, "assistant"), // placeholder
      msg(7, "assistant", true), // compaction summary
    ];
    const result = getPostCompactionMessages(messages);
    expect(result).toEqual([
      msg(5, "user"),
      msg(6, "assistant"),
      msg(7, "assistant", true),
    ]);
  });

  it("includes messages after the compaction summary", () => {
    const messages = [
      msg(1, "user"),
      msg(2, "assistant"),
      msg(3, "user"), // triggering user message
      msg(4, "assistant"), // placeholder
      msg(5, "assistant", true), // compaction summary
      msg(6, "user"), // new message after compaction
      msg(7, "assistant"), // response after compaction
    ];
    const result = getPostCompactionMessages(messages);
    expect(result).toEqual([
      msg(3, "user"),
      msg(4, "assistant"),
      msg(5, "assistant", true),
      msg(6, "user"),
      msg(7, "assistant"),
    ]);
  });

  it("handles re-compaction: uses latest summary and excludes older summaries", () => {
    // First compaction produced summary at id=5, second compaction at id=10
    const messages = [
      msg(1, "user"),
      msg(2, "assistant"),
      msg(3, "user"),
      msg(4, "assistant"),
      msg(5, "assistant", true), // first compaction summary
      msg(6, "user"),
      msg(7, "assistant"),
      msg(8, "user"), // triggering user message for second compaction
      msg(9, "assistant"), // placeholder
      msg(10, "assistant", true), // second compaction summary (latest)
    ];
    const result = getPostCompactionMessages(messages);
    // Should use id=10 as latest summary, id=8 as triggering user msg
    // Excludes id=5 (older compaction summary)
    expect(result).toEqual([
      msg(8, "user"),
      msg(9, "assistant"),
      msg(10, "assistant", true),
    ]);
  });

  it("handles compaction summary with no preceding user message", () => {
    // Edge case: compaction summary is the first message (shouldn't happen in
    // practice, but the function handles it gracefully)
    const messages = [
      msg(1, "assistant", true), // compaction summary
      msg(2, "user"),
      msg(3, "assistant"),
    ];
    const result = getPostCompactionMessages(messages);
    expect(result).toEqual([
      msg(1, "assistant", true),
      msg(2, "user"),
      msg(3, "assistant"),
    ]);
  });

  it("handles compaction summary as the only message", () => {
    const messages = [msg(1, "assistant", true)];
    const result = getPostCompactionMessages(messages);
    expect(result).toEqual([msg(1, "assistant", true)]);
  });

  it("treats isCompactionSummary: null and false the same (not a summary)", () => {
    const messages = [
      msg(1, "user"),
      msg(2, "assistant"),
      msg(3, "user"),
      { id: 4, role: "assistant", isCompactionSummary: false },
      msg(5, "assistant", true), // compaction summary
    ];
    const result = getPostCompactionMessages(messages);
    // id=3 is the triggering user message
    expect(result).toEqual([
      msg(3, "user"),
      { id: 4, role: "assistant", isCompactionSummary: false },
      msg(5, "assistant", true),
    ]);
  });

  it("excludes all older compaction summaries in multi-compaction scenario", () => {
    // Three compactions have occurred
    const messages = [
      msg(1, "user"),
      msg(2, "assistant", true), // 1st compaction
      msg(3, "user"),
      msg(4, "assistant"),
      msg(5, "assistant", true), // 2nd compaction
      msg(6, "user"),
      msg(7, "assistant"),
      msg(8, "user"), // triggering user message
      msg(9, "assistant"), // placeholder
      msg(10, "assistant", true), // 3rd compaction (latest)
      msg(11, "user"),
      msg(12, "assistant"),
    ];
    const result = getPostCompactionMessages(messages);
    expect(result).toEqual([
      msg(8, "user"),
      msg(9, "assistant"),
      msg(10, "assistant", true),
      msg(11, "user"),
      msg(12, "assistant"),
    ]);
    // Verify older summaries are excluded
    expect(result.find((m) => m.id === 2)).toBeUndefined();
    expect(result.find((m) => m.id === 5)).toBeUndefined();
  });

  it("handles non-contiguous IDs", () => {
    const messages = [
      msg(10, "user"),
      msg(20, "assistant"),
      msg(30, "user"),
      msg(40, "assistant"),
      msg(50, "user"), // triggering user message
      msg(60, "assistant"), // placeholder
      msg(70, "assistant", true), // compaction summary
      msg(80, "user"),
    ];
    const result = getPostCompactionMessages(messages);
    expect(result).toEqual([
      msg(50, "user"),
      msg(60, "assistant"),
      msg(70, "assistant", true),
      msg(80, "user"),
    ]);
  });
});
