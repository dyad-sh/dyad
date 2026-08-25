import { describe, expect, it } from "vitest";
import {
  getVisibleMessageApprovalState,
  shouldShowMessageFooter,
} from "./messageApprovalStatus";

describe("getVisibleMessageApprovalState", () => {
  it("hides approved message states", () => {
    expect(getVisibleMessageApprovalState("approved")).toBeNull();
  });

  it("keeps rejected message states visible", () => {
    expect(getVisibleMessageApprovalState("rejected")).toBe("rejected");
  });
});

describe("shouldShowMessageFooter", () => {
  it("keeps historical model metadata visible while another response streams", () => {
    expect(
      shouldShowMessageFooter({
        hasAssistantText: true,
        isStreaming: true,
        hasHistoricalAssistantModel: true,
        visibleApprovalState: null,
      }),
    ).toBe(true);
  });

  it("does not show the footer for the currently streaming response", () => {
    expect(
      shouldShowMessageFooter({
        hasAssistantText: true,
        isStreaming: true,
        hasHistoricalAssistantModel: false,
        visibleApprovalState: null,
      }),
    ).toBe(false);
  });
});
