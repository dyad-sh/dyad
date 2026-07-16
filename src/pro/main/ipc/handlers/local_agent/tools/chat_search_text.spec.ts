import { describe, expect, it } from "vitest";
import {
  MAX_PROJECTION_CHARS,
  projectChatMessageForSearch,
} from "./chat_search_text";

function assistant(content: string) {
  return projectChatMessageForSearch({
    role: "assistant",
    content,
    isCompactionSummary: false,
  });
}

function user(content: string) {
  return projectChatMessageForSearch({
    role: "user",
    content,
    isCompactionSummary: false,
  });
}

describe("projectChatMessageForSearch", () => {
  describe("user messages", () => {
    it("preserves user text as-is, including literal dyad-tag examples", () => {
      const result = user(
        "How do I use <dyad-write> tags? Please fix the login form.",
      );
      expect(result.text).toContain("<dyad-write>");
      expect(result.text).toContain("fix the login form");
      expect(result.truncated).toBe(false);
    });

    it("does not strip payload-looking content from user messages", () => {
      const result = user(
        '<dyad-write path="a.ts">const secret = "user pasted this";</dyad-write>',
      );
      expect(result.text).toContain("user pasted this");
    });
  });

  describe("assistant messages", () => {
    it("preserves prose and drops think bodies", () => {
      const result = assistant(
        "Adding the form now.\n<think>hidden reasoning</think>\nDone with the form.",
      );
      expect(result.text).toContain("Adding the form now.");
      expect(result.text).toContain("Done with the form.");
      expect(result.text).not.toContain("hidden reasoning");
    });

    it("reduces file writes to path metadata without the body", () => {
      const result = assistant(
        '<dyad-write path="src/Login.tsx" description="Login form">const SECRET_BODY = 1;</dyad-write>',
      );
      expect(result.text).toContain("src/Login.tsx");
      expect(result.text).toContain("Login form");
      expect(result.text).not.toContain("SECRET_BODY");
    });

    it("omits bulky tool-output bodies while keeping the query", () => {
      const result = assistant(
        '<dyad-grep query="login">src/a.ts:1: SECRET_MATCH</dyad-grep>',
      );
      expect(result.text).toContain("login");
      expect(result.text).not.toContain("SECRET_MATCH");
    });

    it("omits SQL bodies but keeps the description", () => {
      const result = assistant(
        '<dyad-execute-sql description="Add users table">CREATE TABLE users (secret_col TEXT);</dyad-execute-sql>',
      );
      expect(result.text).toContain("Add users table");
      expect(result.text).not.toContain("secret_col");
    });

    it("preserves compaction summary bodies", () => {
      const result = projectChatMessageForSearch({
        role: "assistant",
        content:
          "<dyad-compaction>We decided to use Supabase auth with magic links.</dyad-compaction>",
        isCompactionSummary: true,
      });
      expect(result.text).toContain("Supabase auth with magic links");
    });

    it("preserves plans, findings, and output summaries", () => {
      const result = assistant(
        "<dyad-write-plan>1. Add auth 2. Add tests</dyad-write-plan>" +
          '<dyad-security-finding title="XSS">Unescaped output in Header</dyad-security-finding>' +
          '<dyad-output type="warning">Deploy skipped: shared module changed</dyad-output>',
      );
      expect(result.text).toContain("Add auth");
      expect(result.text).toContain("Unescaped output in Header");
      expect(result.text).toContain("Deploy skipped");
    });

    it("drops chat-search and read-chat bodies to prevent recursive retrieval", () => {
      const result = assistant(
        '<dyad-search-chats query="auth">RETRIEVED_HISTORY excerpt</dyad-search-chats>' +
          '<dyad-read-chat chat-id="3">RETRIEVED_MESSAGES text</dyad-read-chat>',
      );
      expect(result.text).not.toContain("RETRIEVED_HISTORY");
      expect(result.text).not.toContain("RETRIEVED_MESSAGES");
    });

    it("fails closed for unrecognized dyad tags", () => {
      const result = assistant(
        "Before text <dyad-future-tool foo='bar'>HUGE_PAYLOAD</dyad-future-tool> after text",
      );
      expect(result.text).toContain("Before text");
      expect(result.text).toContain("after text");
      expect(result.text).not.toContain("HUGE_PAYLOAD");
    });

    it("fails closed for an unclosed unrecognized tag", () => {
      const result = assistant(
        "Intro prose <dyad-future-tool>PAYLOAD_WITHOUT_CLOSE and more",
      );
      expect(result.text).toContain("Intro prose");
      expect(result.text).not.toContain("PAYLOAD_WITHOUT_CLOSE");
    });

    it("does not leak the body of an unclosed recognized payload tag", () => {
      const result = assistant(
        'Working on it.\n<dyad-write path="src/a.ts">UNFINISHED_BODY',
      );
      expect(result.text).toContain("Working on it.");
      expect(result.text).toContain("src/a.ts");
      expect(result.text).not.toContain("UNFINISHED_BODY");
    });

    it("keeps only allowlisted, length-capped attributes", () => {
      const longAttr = "x".repeat(1000);
      const result = assistant(
        `<dyad-grep query="${longAttr}" internal_secret="hidden-attr">body</dyad-grep>`,
      );
      expect(result.text).not.toContain("hidden-attr");
      expect(result.text.length).toBeLessThan(500);
    });
  });

  describe("bounds", () => {
    it("truncates pathological input deterministically, keeping head and tail", () => {
      const head = "START_MARKER ";
      const tail = " END_MARKER";
      const content = head + "z".repeat(MAX_PROJECTION_CHARS * 2) + tail;
      const first = user(content);
      const second = user(content);
      expect(first.truncated).toBe(true);
      expect(first.text).toEqual(second.text);
      expect(first.text).toContain("START_MARKER");
      expect(first.text).toContain("END_MARKER");
      expect(first.text.length).toBeLessThan(MAX_PROJECTION_CHARS + 100);
    });

    it("does not truncate normal messages", () => {
      const result = assistant("A normal sized reply about the login form.");
      expect(result.truncated).toBe(false);
    });
  });
});
