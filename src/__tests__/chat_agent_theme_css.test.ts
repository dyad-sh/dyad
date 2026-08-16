import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Chat Agent plain-theme contrast", () => {
  it("replaces holographic literals with semantic reading and control colors", () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/styles/globals.css"),
      "utf8",
    );
    const start = css.indexOf(
      "/* Chat Agent carries a complete holographic palette in literal rgba values.",
    );
    const block = css.slice(start, start + 7_000);

    expect(start).toBeGreaterThan(0);
    expect(block).toContain(".chat-agent-markdown");
    expect(block).toContain("color: var(--foreground)");
    expect(block).toContain(".chat-agent-message-action-btn");
    expect(block).toContain("color: var(--muted-foreground)");
    expect(block).toContain(".chat-agent-composer-shortcuts");
    expect(block).toContain("background: var(--popover)");
  });
});
