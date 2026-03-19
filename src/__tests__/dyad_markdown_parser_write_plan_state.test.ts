import { describe, expect, it } from "vitest";
import { getWritePlanTagState } from "@/components/chat/DyadMarkdownParser";

describe("getWritePlanTagState", () => {
  it("returns pending while a write_plan tag with complete=false is actively streaming", () => {
    expect(
      getWritePlanTagState({
        complete: "false",
        isStreaming: true,
      }),
    ).toBe("pending");
  });

  it("returns finished for complete=false once that message is no longer streaming", () => {
    expect(
      getWritePlanTagState({
        complete: "false",
        isStreaming: false,
      }),
    ).toBe("finished");
  });

  it("returns pending for parser-detected in-progress tags while streaming", () => {
    expect(
      getWritePlanTagState({
        complete: "true",
        isStreaming: true,
        inProgress: true,
      }),
    ).toBe("pending");
  });

  it("returns aborted for parser-detected in-progress tags after stream stop", () => {
    expect(
      getWritePlanTagState({
        complete: "true",
        isStreaming: false,
        inProgress: true,
      }),
    ).toBe("aborted");
  });
});
