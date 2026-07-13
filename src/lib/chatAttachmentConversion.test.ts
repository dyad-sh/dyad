import { describe, expect, it } from "vitest";

import { convertFileAttachmentsToChatAttachments } from "./chatAttachmentConversion";

describe("convertFileAttachmentsToChatAttachments", () => {
  it("reads files sequentially and preserves their order", async () => {
    const files = ["first.txt", "second.txt", "third.txt"].map(
      (name) => new File([name], name, { type: "text/plain" }),
    );
    let activeReaders = 0;
    let maxActiveReaders = 0;

    const converted = await convertFileAttachmentsToChatAttachments(
      files.map((file) => ({ file, type: "chat-context" })),
      async (file) => {
        activeReaders += 1;
        maxActiveReaders = Math.max(maxActiveReaders, activeReaders);
        await new Promise((resolve) => setTimeout(resolve, 0));
        activeReaders -= 1;
        return `data:${file.type};base64,${file.name}`;
      },
    );

    expect(maxActiveReaders).toBe(1);
    expect(converted.map(({ name }) => name)).toEqual([
      "first.txt",
      "second.txt",
      "third.txt",
    ]);
  });
});
