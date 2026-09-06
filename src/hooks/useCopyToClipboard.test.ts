import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";

// Mirror of writeFileTool.buildXml (write_file.ts). The real module imports
// Electron transitively and cannot load in the unit-test env, so these
// builders construct tags that byte-match the producer's output exactly:
// an opening tag, a leading "\n", the raw content, and a trailing "\n"
// before the closing tag.
function buildWriteXml(args: {
  path: string;
  description?: string;
  content: string;
}): string {
  return `<dyad-write path="${args.path}" description="${args.description ?? ""}">\n${args.content}\n</dyad-write>`;
}

function buildEditXml(args: {
  path: string;
  description?: string;
  content: string;
}): string {
  return `<dyad-edit path="${args.path}" description="${args.description ?? ""}">\n${args.content}\n</dyad-edit>`;
}

function buildExecuteSqlXml(args: {
  description?: string;
  content: string;
}): string {
  return `<dyad-execute-sql description="${args.description ?? ""}">\n${args.content}\n</dyad-execute-sql>`;
}

function buildCodebaseContextXml(args: {
  files?: string;
  content: string;
}): string {
  return `<dyad-codebase-context files="${args.files ?? ""}">\n${args.content}\n</dyad-codebase-context>`;
}

function buildScriptXml(args: {
  description?: string;
  script?: string;
  output?: string;
}): string {
  const payload = JSON.stringify({ script: args.script, output: args.output });
  return `<dyad-script description="${args.description ?? "Script"}">\n${payload}\n</dyad-script>`;
}

// Extract the interior of a fenced code block from the clipboard text.
// `lang` is the info string after the opening ``` ("" for a language-less
// fence). Asserts the fence exists.
function extractFence(text: string, lang: string): string {
  const re = new RegExp("```" + lang + "\\n([\\s\\S]*?)\\n```");
  const m = text.match(re);
  expect(m, `clipboard must contain a \`\`\`${lang} fence`).not.toBeNull();
  return m![1];
}

describe("useCopyToClipboard", () => {
  let clipboardText: string;

  beforeEach(() => {
    clipboardText = "";
    const writeText = vi.fn(async (text: string) => {
      clipboardText = text;
      return Promise.resolve();
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Render the real hook, copy `message` via the real `copyMessageContent`,
  // unmount (to clear the 2s copied-state timeout) and return what was
  // written to the clipboard.
  async function copy(message: string): Promise<string> {
    const { result, unmount } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copyMessageContent(message);
    });
    unmount();
    return clipboardText;
  }

  describe("code-fence fidelity — newlines inside ``` are verbatim", () => {
    it("preserves 2 PEP-8 blank lines (3 consecutive newlines) inside a dyad-write code fence", async () => {
      const fileContent =
        "def add(a, b):\n    return a + b\n\n\ndef sub(a, b):\n    return a - b\n";
      const out = await copy(
        buildWriteXml({
          path: "math_utils.py",
          description: "basic math helpers",
          content: fileContent,
        }),
      );

      const fence = extractFence(out, "python");
      expect(fence, "3 newlines between defs must NOT collapse to 2").toContain(
        "a + b\n\n\ndef sub",
      );
      expect(
        fence,
        "must NOT contain the collapsed 2-newline form",
      ).not.toContain("a + b\n\ndef sub");
    });

    it("preserves 3+ consecutive newlines for non-Python files (markdown)", async () => {
      const md = "# Title\n\nText before break.\n\n\n\n---\n\n\nAfter break.";
      const out = await copy(
        buildWriteXml({ path: "doc.md", description: "doc", content: md }),
      );

      const fence = extractFence(out, "markdown");
      expect(fence).toContain("before break.\n\n\n\n---");
      expect(fence).toContain("---\n\n\nAfter break.");
      expect(fence, "must NOT contain a collapsed seam").not.toContain(
        "before break.\n\n---",
      );
    });

    it("preserves blank lines inside a dyad-edit fence", async () => {
      const content = "function a() {}\n\n\nfunction b() {}";
      const out = await copy(
        buildEditXml({ path: "fns.ts", description: "ed", content }),
      );

      const fence = extractFence(out, "typescript");
      expect(fence).toContain("a() {}\n\n\nfunction b()");
      expect(fence).not.toContain("a() {}\n\nfunction b()");
    });

    it("preserves blank lines inside a dyad-execute-sql fence", async () => {
      const sql = "SELECT 1;\n\n\nSELECT 2;";
      const out = await copy(
        buildExecuteSqlXml({ description: "q", content: sql }),
      );

      const fence = extractFence(out, "sql");
      expect(fence).toContain("SELECT 1;\n\n\nSELECT 2;");
      expect(fence).not.toContain("SELECT 1;\n\nSELECT 2;");
    });

    it("preserves blank lines inside a language-less dyad-codebase-context fence", async () => {
      const content = "fileA\n\n\nfileB";
      const out = await copy(
        buildCodebaseContextXml({ files: "a.ts", content }),
      );

      const fence = extractFence(out, "");
      expect(fence).toContain("fileA\n\n\nfileB");
      expect(fence).not.toContain("fileA\n\nfileB");
    });

    it("preserves blank lines inside BOTH the js and text fences of a dyad-script", async () => {
      const out = await copy(
        buildScriptXml({
          description: "run",
          script: "console.log(1)\n\n\nconsole.log(2)",
          output: "1\n\n\n2",
        }),
      );

      const jsFence = extractFence(out, "js");
      const textFence = extractFence(out, "text");
      expect(jsFence).toContain("log(1)\n\n\nconsole.log(2)");
      expect(jsFence).not.toContain("log(1)\n\nconsole.log(2)");
      expect(textFence).toContain("1\n\n\n2");
      expect(textFence).not.toContain("1\n\n2");
    });

    it("leaves a single newline inside a fence untouched", async () => {
      const out = await copy(
        buildWriteXml({
          path: "one.py",
          description: "",
          content: "x = 1\ny = 2",
        }),
      );

      const fence = extractFence(out, "python");
      expect(fence).toContain("x = 1\ny = 2");
    });
  });

  describe("prose normalization — runs of newlines outside ``` still collapse", () => {
    it("collapses 3+ consecutive newlines in plain markdown prose", async () => {
      const out = await copy("Para 1\n\n\n\n\nPara 2");
      expect(out).toBe("Para 1\n\nPara 2");
    });

    it("collapses a multi-newline seam between a converted tag and following markdown", async () => {
      // dyad-rename ends with "\n\n"; the following markdown starts with
      // "\n\n\n\n" → a 6-newline seam that must collapse to exactly 2.
      const message = `<dyad-rename from="old.txt" to="new.txt"></dyad-rename>\n\n\n\nTail para.`;
      const out = await copy(message);
      expect(out).toBe("### Rename: old.txt → new.txt\n\nTail para.");
    });

    it("still collapses newlines inside single-backtick inline code (not a fence)", async () => {
      const out = await copy("Before `inline\n\n\n\nmulti` After");
      expect(out).toBe("Before `inline\n\nmulti` After");
    });

    it("collapses the seam between prose and a following fence while preserving the fence interior", async () => {
      const message =
        buildWriteXml({
          path: "f.py",
          description: "d",
          content: "x = 1\n\n\ny = 2",
        }) + "\n\n\n\nTail para.";
      const out = await copy(message);

      // code-fence interior preserved
      expect(out).toContain("x = 1\n\n\ny = 2");
      expect(out).not.toContain("x = 1\n\ny = 2");
      // prose seam collapsed to exactly 2 newlines
      expect(out).toContain("```\n\nTail para.");
      expect(out).not.toContain("```\n\n\nTail para.");
    });
  });
});
