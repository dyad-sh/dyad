import { describe, expect, it } from "vitest";
import { planFileName } from "./planFileName";

const legacyPlan = {
  id: "chat-1-20260101",
  chatId: 1,
  content: "Implementation steps",
};

describe("planFileName", () => {
  it("uses the saved slug, so a legacy file shows its real name", () => {
    expect(planFileName(1, legacyPlan, "Implementation steps")).toBe(
      "chat-1-20260101.md",
    );
  });

  it("uses the canonical name when the plan on screen is newer than the saved plan", () => {
    expect(planFileName(1, legacyPlan, "Newer steps")).toBe("chat-1-plan.md");
    expect(planFileName(1, legacyPlan, undefined)).toBe("chat-1-plan.md");
  });

  it("falls back to the canonical name without a saved plan for this chat", () => {
    expect(planFileName(7, null, "Steps")).toBe("chat-7-plan.md");
    expect(
      planFileName(
        7,
        { id: "chat-3-plan", chatId: 3, content: "Steps" },
        "Steps",
      ),
    ).toBe("chat-7-plan.md");
  });
});
