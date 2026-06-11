import { describe, expect, it } from "vitest";
import { normalizeMessagesAriaSnapshot } from "../../e2e-tests/helpers/utils/stable-aria-snapshot";

describe("normalizeMessagesAriaSnapshot", () => {
  it("elides button descendants while preserving accessible names", () => {
    expect(
      normalizeMessagesAriaSnapshot(`- button "Copy Request ID":
  - img
  - text: Request ID
- button "Undo":
  - img
  - text: Undo
- button "Retry":
  - img
  - text: Retry
`),
    ).toBe(`- button "Copy Request ID"
- button "Undo"
- button "Retry"
`);
  });

  it("normalizes volatile durations in button accessible names", () => {
    expect(
      normalizeMessagesAriaSnapshot(
        `- button "Script Call calculator_add through MCP 12ms"\n`,
      ),
    ).toBe(`- button "Script Call calculator_add through MCP [[duration]]"\n`);
  });

  it("elides nested button-card descendants", () => {
    expect(
      normalizeMessagesAriaSnapshot(`- 'button "math.ts src/utils/math.ts Edit Summary: Create math utilities"':
  - img
  - text: math.ts src/utils/math.ts
  - button "Edit":
    - img
    - text: Edit
  - img
  - text: "Summary: Create math utilities"
`),
    ).toBe(
      `- 'button "math.ts src/utils/math.ts Edit Summary: Create math utilities"'\n`,
    );
  });

  it("elides expanded button descendants while preserving state", () => {
    expect(
      normalizeMessagesAriaSnapshot(`- 'button "GREP \\"createRoot\\" (2 matches) log Copy src/main.tsx:1: import { createRoot } from \\"react-dom/client\\";" [expanded]':
  - img
  - text: GREP "createRoot" (2 matches)
  - img
  - text: log
  - button "Copy":
    - img
    - text: Copy
  - code: "src/main.tsx:1: import { createRoot } from \\"react-dom/client\\";"
`),
    ).toBe(`- button "GREP \\"createRoot\\" (2 matches)" [expanded]\n`);
  });

  it("drops repeated chat metadata and nameless icons", () => {
    expect(
      normalizeMessagesAriaSnapshot(`- img
- text: Approved
- img
- text: claude-opus-4-5
- text: test-model
- text: gpt-5
- text: gemini-2.5-pro
- img
- text: less than a minute ago
- text: 1 minute ago
- text: 2 hours ago
- img "uploaded-file.png"
`),
    ).toBe(`- img "uploaded-file.png"\n`);
  });

  it("drops version file-count text", () => {
    expect(
      normalizeMessagesAriaSnapshot(`- text: "Version 2: (1 files changed)"
- text: "/Version 3: \\\\(\\\\d+ files changed\\\\)/"
- text: "Version 4: wrote 2 file(s)"
`),
    ).toBe(`\n`);
  });

  it("normalizes generated AI rules prompts", () => {
    expect(
      normalizeMessagesAriaSnapshot(`- paragraph: /Generate an AI_RULES\\.md file for this app\\. Describe the tech stack in 5-\\d+ bullet points and describe clear rules about what libraries to use for what\\./
- paragraph: Generate an AI_RULES.md file for this app. Describe the tech stack in 5-10 bullet points and describe clear rules about what libraries to use for what.
`),
    ).toBe(`- paragraph: "[[AI_RULES_GENERATION_PROMPT]]"
- paragraph: "[[AI_RULES_GENERATION_PROMPT]]"
`);
  });

  it("always returns exactly one trailing newline", () => {
    expect(normalizeMessagesAriaSnapshot("- paragraph: Done\n\n\n")).toBe(
      "- paragraph: Done\n",
    );
  });

  it("preserves YAML single-quote escaping in button names without doubling it", () => {
    const input = `- 'button "Error Tool ''add_dependency'' failed: User denied permission Copy Fix with AI"':
  - img
  - text: stuff
`;
    const expected = `- 'button "Error Tool ''add_dependency'' failed: User denied permission Copy Fix with AI"'\n`;
    expect(normalizeMessagesAriaSnapshot(input)).toBe(expected);
  });

  it("quotes button lines whose names contain single quotes but no colon", () => {
    expect(
      normalizeMessagesAriaSnapshot(`- 'button "Don''t stop"':
  - img
`),
    ).toBe(`- 'button "Don''t stop"'\n`);
  });

  it("is idempotent over its own output", () => {
    const input = `- 'button "Error Tool ''add_dependency'' failed: oops" [expanded]':
  - img
- button "Script Call calculator_add through MCP 12ms"
- text: Approved
- paragraph: Done
`;
    const once = normalizeMessagesAriaSnapshot(input);
    expect(normalizeMessagesAriaSnapshot(once)).toBe(once);
  });
});
