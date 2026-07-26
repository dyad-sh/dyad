import { describe, expect, it } from "vitest";
import { constructDesignModePrompt } from "./design_mode_prompt";

describe("constructDesignModePrompt", () => {
  it("tells the agent to generate imagery when the toggle is on", () => {
    const prompt = constructDesignModePrompt(undefined, undefined, {
      imageGenerationEnabled: true,
    });

    expect(prompt).toContain("generate_image");
    expect(prompt).toContain("Konva.Image");
    expect(prompt).not.toContain("[[IMAGE_GENERATION]]");
    expect(prompt).not.toContain("You cannot generate images in this session");
  });

  it("keeps placeholder rects when the toggle is off", () => {
    const prompt = constructDesignModePrompt(undefined, undefined);

    expect(prompt).toContain("You cannot generate images in this session");
    expect(prompt).not.toContain("[[IMAGE_GENERATION]]");
    // The image tool isn't in the tool set, so the prompt must not name it as
    // something to call.
    expect(prompt).not.toContain("Call generate_image");
  });

  it("still substitutes AI rules and the theme prompt", () => {
    const prompt = constructDesignModePrompt("MY RULES", "MY THEME", {
      imageGenerationEnabled: true,
    });

    expect(prompt).toContain("MY RULES");
    expect(prompt).toContain("MY THEME");
    expect(prompt).not.toContain("[[AI_RULES]]");
  });
});
