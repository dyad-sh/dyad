import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatAgentMarkdown } from "./ChatAgentMarkdown";

// Stub the Shiki-backed highlighter so the test doesn't depend on the async
// highlighter loading. We only care that a fenced code block is routed to the
// code component (rather than rendered as literal text).
vi.mock("../chat/CodeHighlight", () => ({
  CodeHighlight: ({ className, children }: any) => (
    <pre data-testid="code-block" data-lang={className}>
      {children}
    </pre>
  ),
}));

afterEach(() => cleanup());

describe("ChatAgentMarkdown", () => {
  it("renders a fenced code block instead of literal markdown text", () => {
    const content =
      "Here is a boilerplate:\n\n```html\n<!DOCTYPE html>\n<title>Hi</title>\n```";

    render(<ChatAgentMarkdown content={content} />);

    const block = screen.getByTestId("code-block");
    expect(block.getAttribute("data-lang")).toContain("language-html");
    expect(block.textContent).toContain("<!DOCTYPE html>");

    // The raw fence markers must not survive as visible text.
    expect(document.body.textContent).not.toContain("```");
  });

  it("renders inline markdown formatting", () => {
    render(<ChatAgentMarkdown content={"Some **bold** text."} />);

    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });
});
