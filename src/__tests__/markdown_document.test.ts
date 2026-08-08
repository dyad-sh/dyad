import { describe, expect, it } from "vitest";
import {
  buildMarkdownDocument,
  markdownIndexableText,
  parseMarkdownDocument,
  yamlScalar,
} from "@/ipc/utils/markdown_document";

describe("buildMarkdownDocument", () => {
  it("writes a frontmatter block followed by the body", () => {
    const output = buildMarkdownDocument({
      frontmatter: { type: "note", title: "Weekly review" },
      body: "# Weekly review\n\nShipped the indexer.",
    });
    expect(output).toBe(
      "---\ntype: note\ntitle: Weekly review\n---\n\n# Weekly review\n\nShipped the indexer.\n",
    );
  });

  it("renders arrays as YAML lists", () => {
    const output = buildMarkdownDocument({
      frontmatter: { tags: ["meta-human", "notes"] },
      body: "Body",
    });
    expect(output).toContain("tags:\n  - meta-human\n  - notes");
  });

  it("omits empty values so the block stays clean", () => {
    const output = buildMarkdownDocument({
      frontmatter: {
        type: "note",
        model: undefined,
        source: null,
        note: "",
        tags: [],
      },
      body: "Body",
    });
    expect(output).toBe("---\ntype: note\n---\n\nBody\n");
  });

  it("writes only the body when there is no frontmatter", () => {
    expect(buildMarkdownDocument({ frontmatter: {}, body: "Just text" })).toBe(
      "Just text\n",
    );
  });
});

describe("yamlScalar", () => {
  it("leaves simple values unquoted", () => {
    expect(yamlScalar("conversation")).toBe("conversation");
    expect(yamlScalar("Chat Agent")).toBe("Chat Agent");
  });

  it("quotes values that would break YAML", () => {
    expect(yamlScalar("a: b")).toBe('"a: b"');
    expect(yamlScalar('say "hi"')).toBe('"say \\"hi\\""');
    expect(yamlScalar("")).toBe('""');
  });
});

describe("parseMarkdownDocument", () => {
  it("round-trips what the writer produces", () => {
    const source = buildMarkdownDocument({
      frontmatter: {
        type: "conversation",
        title: "Deploy notes",
        tags: ["meta-human", "conversation"],
      },
      body: "# Deploy notes\n\nRolled back the release.",
    });

    const parsed = parseMarkdownDocument(source);
    expect(parsed.frontmatter.type).toBe("conversation");
    expect(parsed.frontmatter.title).toBe("Deploy notes");
    expect(parsed.frontmatter.tags).toEqual(["meta-human", "conversation"]);
    expect(parsed.body).toBe("# Deploy notes\n\nRolled back the release.");
    expect(parsed.title).toBe("Deploy notes");
  });

  it("reads the vault files the app already writes", () => {
    // Matches the existing conversation writer's output shape.
    const raw =
      '---\ntype: conversation\nsource: "Chat Agent"\nconversation_id: "42"\nupdated: 2026-07-30T04:00:00.000Z\ntags:\n  - meta-human\n  - conversation\n---\n\n# Standup\n\n## You\n\nHello\n';
    const parsed = parseMarkdownDocument(raw);

    expect(parsed.frontmatter.source).toBe("Chat Agent");
    expect(parsed.frontmatter.conversation_id).toBe("42");
    expect(parsed.frontmatter.tags).toEqual(["meta-human", "conversation"]);
    expect(parsed.title).toBe("Standup");
    expect(parsed.body.startsWith("# Standup")).toBe(true);
  });

  it("treats a file without frontmatter as all body", () => {
    const parsed = parseMarkdownDocument("# Plain\n\nNo metadata here.");
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe("# Plain\n\nNo metadata here.");
    expect(parsed.title).toBe("Plain");
  });

  it("does not mistake a horizontal rule for frontmatter", () => {
    const parsed = parseMarkdownDocument("Intro\n\n---\n\nAfter the rule");
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toContain("Intro");
    expect(parsed.body).toContain("After the rule");
  });

  it("survives a malformed block instead of throwing", () => {
    const parsed = parseMarkdownDocument("---\nnot: [valid\n---\n\nBody text");
    expect(parsed.body).toBe("Body text");
    expect(parsed.frontmatter.not).toBe("[valid");
  });

  it("handles CRLF line endings", () => {
    const parsed = parseMarkdownDocument(
      "---\r\ntype: note\r\n---\r\n\r\n# Title\r\n\r\nBody",
    );
    expect(parsed.frontmatter.type).toBe("note");
    expect(parsed.title).toBe("Title");
  });

  it("falls back to the frontmatter title when there is no heading", () => {
    const parsed = parseMarkdownDocument(
      "---\ntitle: From metadata\n---\n\nNo heading in the body.",
    );
    expect(parsed.title).toBe("From metadata");
  });
});

describe("markdownIndexableText", () => {
  it("drops the YAML block so it never reaches the embeddings", () => {
    const text = markdownIndexableText(
      "---\ntype: conversation\nconversation_id: abc123\ntags:\n  - meta-human\n---\n\n# Expense policy\n\nSubmit receipts within thirty days.",
    );
    expect(text).not.toContain("conversation_id");
    expect(text).not.toContain("---");
    expect(text).toContain("Submit receipts within thirty days.");
  });

  it("keeps the title and tags so documents stay findable by name", () => {
    const text = markdownIndexableText(
      "---\ntags:\n  - onboarding\n  - handbook\n---\n\n# Onboarding handbook\n\nBody.",
    );
    expect(text).toContain("Onboarding handbook");
    expect(text).toContain("onboarding");
    expect(text).toContain("handbook");
  });

  it("returns plain markdown unchanged", () => {
    expect(markdownIndexableText("# Notes\n\nJust text.")).toBe(
      "Notes\n\n# Notes\n\nJust text.",
    );
  });
});
