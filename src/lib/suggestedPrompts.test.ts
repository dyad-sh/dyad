import { describe, expect, it } from "vitest";
import type { Message } from "@/ipc/types";
import {
  extractSuggestedPrompts,
  MAX_SUGGESTED_PROMPT_CHARS,
  selectSuggestedPrompts,
} from "./suggestedPrompts";

function assistant(content: string, overrides: Partial<Message> = {}): Message {
  return { id: 2, role: "assistant", content, ...overrides };
}

const user: Message = { id: 1, role: "user", content: "Build a todo app" };

describe("extractSuggestedPrompts", () => {
  it("returns one prompt per line from the tag body", () => {
    const content = `Done!\n<dyad-suggested-prompts>\nAdd a dark mode toggle\nMake the homepage text friendlier\n</dyad-suggested-prompts>`;
    expect(extractSuggestedPrompts(content)).toEqual([
      "Add a dark mode toggle",
      "Make the homepage text friendlier",
    ]);
  });

  it("returns nothing without a closed tag", () => {
    expect(extractSuggestedPrompts("Done!")).toEqual([]);
    expect(
      extractSuggestedPrompts(
        "Done!\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n",
      ),
    ).toEqual([]);
  });

  it("strips list markers, blank lines, duplicates and caps at three", () => {
    const content = `<dyad-suggested-prompts>
- Add a dark mode toggle

1. Make the homepage text friendlier
* add a dark mode toggle
• Connect a database
2) Add user accounts
Add tests
</dyad-suggested-prompts>`;
    expect(extractSuggestedPrompts(content)).toEqual([
      "Add a dark mode toggle",
      "Make the homepage text friendlier",
      "Connect a database",
    ]);
  });

  it("returns nothing when an error block follows the tag", () => {
    const content = `Done!\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>\n<dyad-output type="error" message="Failed to deploy Supabase functions">boom</dyad-output>`;
    expect(extractSuggestedPrompts(content)).toEqual([]);
  });

  it("returns nothing when the step limit paused the turn", () => {
    const content = `Done!\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>\n\n<dyad-step-limit steps="50" limit="50">Automatically paused after 50 tool calls.</dyad-step-limit>`;
    expect(extractSuggestedPrompts(content)).toEqual([]);
  });

  it("returns nothing when an Implementer stopped early or was cancelled", () => {
    for (const title of ["Implementer step limit", "Implementer cancelled"]) {
      const content = `Done!\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>\n\n<dyad-status title="${title}" state="warning">Partial changes were preserved.</dyad-status>`;
      expect(extractSuggestedPrompts(content)).toEqual([]);
    }
  });

  it("ignores error blocks from earlier in the turn", () => {
    const content = `<dyad-output type="error" message="Tool failed">retrying</dyad-output>\nDone!\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>\n<dyad-output type="warning" message="Deploy warning">slow</dyad-output>`;
    expect(extractSuggestedPrompts(content)).toEqual([
      "Add a dark mode toggle",
    ]);
  });

  it("ignores a suggestions draft inside the model reasoning", () => {
    const content = `<think>I will end with\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>\n</think>\nWhich color scheme do you want?`;
    expect(extractSuggestedPrompts(content)).toEqual([]);
  });

  it("uses the top-level block when the reasoning also has a draft", () => {
    const content = `<think>Draft:\n<dyad-suggested-prompts>\nDraft idea\n</dyad-suggested-prompts>\n</think>\nDone!\n<dyad-suggested-prompts>\nLet users save their favorites\n</dyad-suggested-prompts>`;
    expect(extractSuggestedPrompts(content)).toEqual([
      "Let users save their favorites",
    ]);
  });

  it("returns nothing when visible text follows the tag", () => {
    const question = `Done!\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>\nWhich option do you prefer?`;
    expect(extractSuggestedPrompts(question)).toEqual([]);

    const laterStep = `<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>\nNow let me check the build.\n<dyad-read path="src/App.tsx"></dyad-read>\nAll good.`;
    expect(extractSuggestedPrompts(laterStep)).toEqual([]);
  });

  it("returns nothing when an error status follows the tag", () => {
    const content = `Done!\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>\n\n<dyad-status title="write_file failed" state="error">Invalid arguments</dyad-status>`;
    expect(extractSuggestedPrompts(content)).toEqual([]);
  });

  it("returns nothing when tool work or reasoning follows the tag", () => {
    const tag = `Done!\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>\n`;
    for (const after of [
      `<dyad-write path="src/App.tsx" description="x">code</dyad-write>`,
      `<dyad-read path="src/App.tsx"></dyad-read>`,
      `<think>Let me also check the build.</think>`,
    ]) {
      expect(extractSuggestedPrompts(tag + after)).toEqual([]);
    }
  });

  it("returns nothing after an aborted status or an unfinished notice", () => {
    const tag = `Done!\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>\n\n`;
    expect(
      extractSuggestedPrompts(
        `${tag}<dyad-status title="Tool" state="aborted">Stopped</dyad-status>`,
      ),
    ).toEqual([]);
    expect(
      extractSuggestedPrompts(
        `${tag}<dyad-output type="warning" message="Deploy">partial`,
      ),
    ).toEqual([]);
  });

  it("still offers prompts after a non-error output notice", () => {
    const content = `Done!\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>\n\n<dyad-output type="warning" message="Supabase function deploy warning">slow</dyad-output>`;
    expect(extractSuggestedPrompts(content)).toEqual([
      "Add a dark mode toggle",
    ]);
  });

  it("still offers prompts when only host notices follow the tag", () => {
    const content = `Done!\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>\n\n<dyad-status title="Checks passed" state="finished">All checks passed.</dyad-status>\n`;
    expect(extractSuggestedPrompts(content)).toEqual([
      "Add a dark mode toggle",
    ]);
  });

  it("returns nothing for an unclosed tag followed by a host notice", () => {
    const content = `Done!\n<dyad-suggested-prompts>\nAdd a dark\n\n<dyad-step-limit steps="50" limit="50">Paused.</dyad-step-limit>`;
    expect(extractSuggestedPrompts(content)).toEqual([]);
  });

  it("drops prompts longer than the chip limit", () => {
    const long = "Add a feature ".repeat(10).trim();
    expect(long.length).toBeGreaterThan(MAX_SUGGESTED_PROMPT_CHARS);
    const content = `<dyad-suggested-prompts>\n${long}\nAdd a dark mode toggle\n</dyad-suggested-prompts>`;
    expect(extractSuggestedPrompts(content)).toEqual([
      "Add a dark mode toggle",
    ]);
  });

  it("uses the last closed tag and unescapes XML entities", () => {
    const content = `<dyad-suggested-prompts>\nOld idea\n</dyad-suggested-prompts>\nMore work...\n<dyad-suggested-prompts>\nAdd search &amp; filters\n</dyad-suggested-prompts>`;
    expect(extractSuggestedPrompts(content)).toEqual(["Add search & filters"]);
  });
});

describe("selectSuggestedPrompts", () => {
  const withPrompts = assistant(
    "Done\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>",
  );

  it("offers the prompts from a settled trailing assistant message", () => {
    expect(
      selectSuggestedPrompts({
        messages: [user, withPrompts],
        isStreaming: false,
      }),
    ).toEqual({ messageId: 2, prompts: ["Add a dark mode toggle"] });
  });

  it("offers nothing while streaming", () => {
    expect(
      selectSuggestedPrompts({
        messages: [user, withPrompts],
        isStreaming: true,
      }),
    ).toBeNull();
  });

  it("offers nothing once the user has replied", () => {
    expect(
      selectSuggestedPrompts({
        messages: [user, withPrompts, { ...user, id: 3 }],
        isStreaming: false,
      }),
    ).toBeNull();
  });

  it("offers nothing while the composer has content", () => {
    expect(
      selectSuggestedPrompts({
        messages: [user, withPrompts],
        isStreaming: false,
        composerHasContent: true,
      }),
    ).toBeNull();
  });

  it("offers nothing when the last turn errored", () => {
    expect(
      selectSuggestedPrompts({
        messages: [user, withPrompts],
        isStreaming: false,
        hasError: true,
      }),
    ).toBeNull();
  });

  it("offers nothing for a cancelled turn", () => {
    expect(
      selectSuggestedPrompts({
        messages: [
          user,
          {
            ...withPrompts,
            content: `${withPrompts.content}\n\n[Response cancelled by user]`,
          },
        ],
        isStreaming: false,
      }),
    ).toBeNull();
  });

  it("offers nothing for a rejected message or one without the tag", () => {
    expect(
      selectSuggestedPrompts({
        messages: [user, { ...withPrompts, approvalState: "rejected" }],
        isStreaming: false,
      }),
    ).toBeNull();
    expect(
      selectSuggestedPrompts({
        messages: [user, assistant("Done")],
        isStreaming: false,
      }),
    ).toBeNull();
  });
});
