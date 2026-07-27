import { describe, expect, it } from "vitest";
import {
  MAX_PROJECTION_CHARS,
  projectChatMessageForSearch,
} from "./chat_search_text";

function projectAssistant(content: string) {
  return projectChatMessageForSearch({
    role: "assistant",
    content,
    isCompactionSummary: false,
  });
}

describe("projectChatMessageForSearch", () => {
  it("preserves user-authored tag examples as text", () => {
    const result = projectChatMessageForSearch({
      role: "user",
      content: "How do I use <dyad-write> tags?",
      isCompactionSummary: false,
    });

    expect(result.text).toContain("<dyad-write>");
  });

  it("keeps assistant prose and metadata without secret payload bodies", () => {
    const result = projectAssistant(
      'Starting now. <think>private reasoning</think><dyad-write path="src/Login.tsx" description="Login form">const SECRET_BODY = 1;</dyad-write>Done.',
    );

    expect(result.text).toContain("Starting now.");
    expect(result.text).toContain("src/Login.tsx");
    expect(result.text).toContain("Login form");
    expect(result.text).toContain("Done.");
    expect(result.text).not.toContain("private reasoning");
    expect(result.text).not.toContain("SECRET_BODY");
  });

  it("preserves compaction summaries but drops recursive chat retrieval", () => {
    const result = projectAssistant(
      "<dyad-compaction>Use magic-link authentication.</dyad-compaction>" +
        '<dyad-search-chats query="auth">untrusted old prompt</dyad-search-chats>',
    );

    expect(result.text).toContain("Use magic-link authentication.");
    expect(result.text).not.toContain("untrusted old prompt");
  });

  it("fails closed for unrecognized and unclosed Dyad payload tags", () => {
    const result = projectAssistant(
      "Visible <dyad-future-tool>HIDDEN</dyad-future-tool> tail " +
        "<dyad-another-tool>UNFINISHED",
    );

    expect(result.text).toContain("Visible");
    expect(result.text).toContain("tail");
    expect(result.text).not.toContain("HIDDEN");
    expect(result.text).not.toContain("UNFINISHED");
  });

  it("bounds pathological messages while retaining the head and tail", () => {
    const result = projectChatMessageForSearch({
      role: "user",
      content: "START " + "x".repeat(MAX_PROJECTION_CHARS * 2) + " END",
      isCompactionSummary: false,
    });

    expect(result.truncated).toBe(true);
    expect(result.text).toContain("START");
    expect(result.text).toContain("END");
    expect(result.text.length).toBeLessThan(MAX_PROJECTION_CHARS + 100);
  });
});
