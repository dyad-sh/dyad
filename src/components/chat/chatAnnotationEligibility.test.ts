import { describe, expect, it } from "vitest";
import { isChatMessageAnnotatable } from "./chatAnnotationEligibility";

describe("isChatMessageAnnotatable", () => {
  it("only allows the latest completed assistant response", () => {
    expect(
      isChatMessageAnnotatable({
        role: "assistant",
        isLastMessage: true,
        isCancelled: false,
        isStreaming: false,
      }),
    ).toBe(true);
    expect(
      isChatMessageAnnotatable({
        role: "assistant",
        isLastMessage: false,
        isCancelled: false,
        isStreaming: false,
      }),
    ).toBe(false);
    expect(
      isChatMessageAnnotatable({
        role: "assistant",
        isLastMessage: true,
        isCancelled: false,
        isStreaming: true,
      }),
    ).toBe(false);
    expect(
      isChatMessageAnnotatable({
        role: "user",
        isLastMessage: true,
        isCancelled: false,
        isStreaming: false,
      }),
    ).toBe(false);
  });
});
