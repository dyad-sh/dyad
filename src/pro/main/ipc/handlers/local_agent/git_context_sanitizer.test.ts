import { describe, expect, it } from "vitest";

import {
  GitContextEchoSanitizer,
  stripGitContextEchoes,
  stripGitContextEchoesFromAssistantMessages,
} from "./git_context_sanitizer";

describe("GitContextEchoSanitizer", () => {
  it("strips an echoed Git-context tag split across stream chunks", () => {
    const sanitizer = new GitContextEchoSanitizer();

    const output = [
      sanitizer.push("Done.<dyad-git-con"),
      sanitizer.push('text commit="fake">'),
      sanitizer.push("</dyad-git-context>"),
      sanitizer.finish(),
    ].join("");

    expect(output).toBe("Done.");
  });

  it("preserves ordinary text around internal tag markup", () => {
    expect(
      stripGitContextEchoes(
        'Before <dyad-git-context commit="fake">unexpected</dyad-git-context> after',
      ),
    ).toBe("Before unexpected after");
  });

  it("does not strip similarly named user text", () => {
    expect(stripGitContextEchoes("Use <dyad-git-contextual> here.")).toBe(
      "Use <dyad-git-contextual> here.",
    );
  });

  it("drops a distinctive internal tag fragment if the stream ends", () => {
    const sanitizer = new GitContextEchoSanitizer();

    expect(sanitizer.push("Done.<dyad-git-con")).toBe("Done.");
    expect(sanitizer.finish()).toBe("");
  });

  it("removes echoes from assistant message text only", () => {
    const tag = '<dyad-git-context commit="fake"></dyad-git-context>';
    const messages = stripGitContextEchoesFromAssistantMessages([
      { role: "user", content: `User literal: ${tag}` },
      {
        role: "assistant",
        content: [
          { type: "text", text: `Finished.${tag}` },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "read_file",
            input: {},
          },
        ],
      },
    ]);

    expect(messages[0]).toEqual({
      role: "user",
      content: `User literal: ${tag}`,
    });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: [
        { type: "text", text: "Finished." },
        { type: "tool-call", toolCallId: "call-1" },
      ],
    });
  });
});
