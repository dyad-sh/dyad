import { describe, expect, it } from "vitest";
import type { Message } from "@/ipc/types";
import {
  extractSuggestedPrompts,
  selectSuggestedPrompts,
} from "./suggestedPrompts";

function assistant(content: string, overrides: Partial<Message> = {}): Message {
  return { id: 2, role: "assistant", content, ...overrides };
}

const user: Message = { id: 1, role: "user", content: "Build a todo app" };

describe("extractSuggestedPrompts", () => {
  it("returns one prompt per line from the tag body", () => {
    const content = `Done!\n<dyad-suggested-prompts>\nAdd a dark mode toggle\nMake the header responsive\n</dyad-suggested-prompts>`;
    expect(extractSuggestedPrompts(content)).toEqual([
      "Add a dark mode toggle",
      "Make the header responsive",
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

1. Make the header responsive
* add a dark mode toggle
• Connect a database
2) Add user accounts
Add tests
</dyad-suggested-prompts>`;
    expect(extractSuggestedPrompts(content)).toEqual([
      "Add a dark mode toggle",
      "Make the header responsive",
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
