// Migrated from e2e-tests/copy_chat.spec.ts.
//
// The e2e drove the copy-message button in the UI; the actual behavior under
// test is pure logic in useCopyToClipboard: converting a dyad-tagged assistant
// message into clean markdown before writing it to the clipboard. We exercise
// the hook directly and assert on what gets written to the clipboard.
//
// The e2e's third test ("copy button tooltip states") was already skipped as
// flaky and is tooltip-UI-only; it is intentionally dropped.
import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";

describe("useCopyToClipboard (copy chat)", () => {
  let writeTextMock: ReturnType<typeof vi.fn>;
  let written: string[];

  beforeEach(() => {
    written = [];
    writeTextMock = vi.fn(async (text: string) => {
      written.push(text);
    });
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies message content without any dyad tags (basic functionality)", async () => {
    // Mirrors the fake LLM's canned response the e2e copied: a dyad-write plus
    // surrounding plain text and a chat summary tag.
    const messageContent = `
  <dyad-write path="file1.txt">
  A file (2)
  </dyad-write>
  More
  EOM
<dyad-chat-summary>Saying hello</dyad-chat-summary>`;

    const { result } = renderHook(() => useCopyToClipboard());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.copyMessageContent(messageContent);
    });

    expect(success).toBe(true);
    expect(writeTextMock).toHaveBeenCalledTimes(1);

    const clipboardContent = written[0];
    // Same assertions as the e2e: something was copied, and no raw dyad tags
    // survive the conversion (dyad-chat-summary is dropped entirely).
    expect(clipboardContent.length).toBeGreaterThan(0);
    expect(clipboardContent).not.toContain("<dyad-");
    expect(clipboardContent).toContain("More");
    expect(clipboardContent).not.toContain("Saying hello");

    // The hook reports the copied state (drives the "Copied!" tooltip).
    await waitFor(() => {
      expect(result.current.copied).toBe(true);
    });
  });

  it("converts dyad-write tags to markdown file blocks", async () => {
    const componentSource = [
      "const Button = () => {",
      "  return <button>Click me</button>;",
      "};",
      "",
      "export default Button;",
    ].join("\n");
    const messageContent = `Sure, here is a simple React component.
<dyad-write path="src/components/Button.tsx" description="Create a simple Button component.">
${componentSource}
</dyad-write>
All done!`;

    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copyMessageContent(messageContent);
    });

    const clipboardContent = written[0];
    // Same assertions as the e2e...
    expect(clipboardContent).toContain("### File:");
    expect(clipboardContent).toContain("```");
    expect(clipboardContent).not.toContain("<dyad-write");
    // ...plus targeted checks on the converted block shape.
    expect(clipboardContent).toContain("### File: src/components/Button.tsx");
    expect(clipboardContent).toContain("Create a simple Button component.");
    expect(clipboardContent).toContain("```typescript");
    expect(clipboardContent).toContain(componentSource);
    expect(clipboardContent).toContain("All done!");
  });

  it("closes unclosed dyad tags from an in-flight stream before converting", async () => {
    const messageContent = `Working on it.
<dyad-write path="src/foo.ts" description="Write foo.">
export const foo = 1;`;

    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copyMessageContent(messageContent);
    });

    const clipboardContent = written[0];
    expect(clipboardContent).toContain("### File: src/foo.ts");
    expect(clipboardContent).toContain("export const foo = 1;");
    expect(clipboardContent).not.toContain("<dyad-write");
  });
});
