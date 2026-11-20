import { describe, expect, it } from "vitest";
import { planFileName } from "./planFileName";

describe("planFileName", () => {
  it("uses the saved slug, so a legacy file shows its real name", () => {
    expect(planFileName(1, { id: "chat-1-20260101", chatId: 1 })).toBe(
      "chat-1-20260101.md",
    );
  });

  it("falls back to the canonical name without a saved plan for this chat", () => {
    expect(planFileName(7)).toBe("chat-7-plan.md");
    expect(planFileName(7, null)).toBe("chat-7-plan.md");
    expect(planFileName(7, { id: "chat-3-plan", chatId: 3 })).toBe(
      "chat-7-plan.md",
    );
  });
});
