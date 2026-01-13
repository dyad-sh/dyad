import { describe, it, expect } from "vitest";
import {
  generateContractPrompt,
  isGenerationSupported,
  GENERATION_TARGETS,
  SUI_MOVE_GENERATION_PROMPT,
} from "../prompts/generation_prompts";

describe("Sui Move Generation Flow", () => {
  it("should include sui_move in GENERATION_TARGETS", () => {
    expect(GENERATION_TARGETS).toContain("sui_move");
  });

  it("should support generation for sui_move", () => {
    expect(isGenerationSupported("sui_move")).toBe(true);
  });

  it("should generate a valid prompt for a counter contract", () => {
    const prompt = generateContractPrompt(
      "sui_move",
      "Create a simple counter contract"
    );

    // Check prompt structure
    expect(prompt).toContain("Sui Move");
    expect(prompt).toContain("Create a simple counter contract");
    expect(prompt).toContain("Generate a smart contract");
  });

  it("should include counter example in SUI_MOVE_GENERATION_PROMPT", () => {
    expect(SUI_MOVE_GENERATION_PROMPT).toContain("counter.move");
    expect(SUI_MOVE_GENERATION_PROMPT).toContain("Move.toml");
    expect(SUI_MOVE_GENERATION_PROMPT).toContain("dyad-write");
  });

  it("should include proper file structure paths in the prompt", () => {
    expect(SUI_MOVE_GENERATION_PROMPT).toContain(
      "src/<package-name>/Move.toml"
    );
    expect(SUI_MOVE_GENERATION_PROMPT).toContain(
      "src/<package-name>/sources/<module>.move"
    );
  });

  it("should include Sui Move fundamentals in the prompt", () => {
    expect(SUI_MOVE_GENERATION_PROMPT).toContain("Object-Centric Model");
    expect(SUI_MOVE_GENERATION_PROMPT).toContain("UID");
    expect(SUI_MOVE_GENERATION_PROMPT).toContain("Capability Pattern");
    expect(SUI_MOVE_GENERATION_PROMPT).toContain("transfer::share_object");
  });
});
