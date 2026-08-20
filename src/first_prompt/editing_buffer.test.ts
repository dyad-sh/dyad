import { describe, expect, it } from "vitest";
import {
  mergeRejectedPromptIntoChatDraft,
  removeSubmittedFirstPromptAttachments,
} from "./editing_buffer";

describe("first prompt editing buffer", () => {
  it("keeps a newer destination draft alongside the rejected prompt", () => {
    const current = new Map([[7, "new destination draft"]]);

    expect(
      mergeRejectedPromptIntoChatDraft(current, 7, "rejected first prompt").get(
        7,
      ),
    ).toBe("rejected first prompt\n\nnew destination draft");
  });

  it("removes accepted attachments while retaining newer attachments", () => {
    const acceptedFile = new File(["accepted"], "accepted.txt");
    const newerFile = new File(["newer"], "newer.txt");
    const acceptedAttachment = {
      file: acceptedFile,
      type: "chat-context" as const,
    };
    const newerAttachment = {
      file: newerFile,
      type: "chat-context" as const,
    };

    expect(
      removeSubmittedFirstPromptAttachments(
        [acceptedAttachment, newerAttachment],
        [acceptedAttachment],
      ),
    ).toEqual([newerAttachment]);
  });
});
