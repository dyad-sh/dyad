import { describe, expect, it } from "vitest";

import { prepareCanvaGenerateDesignInput } from "./canva_mcp_generation";

describe("Canva MCP generation input", () => {
  it("keeps the slide plan while removing talk tracks and timings", () => {
    const result = prepareCanvaGenerateDesignInput(
      {
        query: [
          "Create a 10-slide presentation for hardcore bodybuilders.",
          "Slide 1 — More Muscle, Less Guesswork (0:45)",
          "- Strong opening title",
          "Talk track: Explain the complete training feedback loop in detail.",
          "This presenter-only paragraph should not reach Canva.",
          "Slide 2 — Why Growth Stalls (1:00)",
          "- Random volume",
        ].join("\n"),
      },
      1,
    ) as Record<string, unknown>;

    expect(result.design_type).toBe("presentation");
    expect(result.query).toContain("Slide 1 — More Muscle, Less Guesswork");
    expect(result.query).toContain("Slide 2 — Why Growth Stalls");
    expect(result.query).not.toContain("Talk track");
    expect(result.query).not.toContain("presenter-only");
    expect(result.query).not.toContain("(0:45)");
  });

  it("uses a smaller bounded prompt for an automatic retry", () => {
    const result = prepareCanvaGenerateDesignInput(
      {
        query: `Create a presentation. ${"Detailed visual direction. ".repeat(400)}`,
      },
      2,
    ) as Record<string, unknown>;

    expect(String(result.query).length).toBeLessThanOrEqual(2_400);
    expect(result.design_type).toBe("presentation");
  });

  it("does not alter unrelated or malformed tool input", () => {
    expect(
      prepareCanvaGenerateDesignInput({ design_id: "design-1" }, 1),
    ).toEqual({ design_id: "design-1" });
  });
});
