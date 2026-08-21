import { describe, expect, it } from "vitest";
import { getVisibleMessageApprovalState } from "./messageApprovalStatus";

describe("getVisibleMessageApprovalState", () => {
  it("hides approved message states", () => {
    expect(getVisibleMessageApprovalState("approved")).toBeNull();
  });

  it("keeps rejected message states visible", () => {
    expect(getVisibleMessageApprovalState("rejected")).toBe("rejected");
  });
});
