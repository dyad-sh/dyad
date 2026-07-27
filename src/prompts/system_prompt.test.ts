import { describe, expect, it } from "vitest";

import { constructSystemPrompt } from "@/prompts/system_prompt";

describe("constructSystemPrompt", () => {
  it("uses the read-only agent prompt for Ask mode", () => {
    const prompt = constructSystemPrompt({
      aiRules: "# Project rules",
      chatMode: "ask",
    });

    expect(prompt).toContain("READ-ONLY mode");
    expect(prompt).toContain("# Project rules");
  });

  it("uses the planning prompt for Plan mode", () => {
    const prompt = constructSystemPrompt({
      aiRules: "# Project rules",
      chatMode: "plan",
    });

    expect(prompt).toContain("Dyad Plan Mode");
    expect(prompt).toContain("# Project rules");
  });
});
