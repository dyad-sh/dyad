import { describe, expect, it } from "vitest";
import { canonicalPlanSlug } from "./plan_slug";

describe("canonicalPlanSlug", () => {
  it("builds the per-chat slug that plan saves write", () => {
    expect(canonicalPlanSlug(7)).toBe("chat-7-plan");
  });
});
