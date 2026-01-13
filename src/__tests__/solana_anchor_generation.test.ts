import { describe, it, expect } from "vitest";
import {
  generateContractPrompt,
  isGenerationSupported,
  GENERATION_TARGETS,
  SOLANA_GENERATION_PROMPT,
} from "../prompts/generation_prompts";

describe("Solana/Anchor Generation Flow", () => {
  it("should include solana_rust in GENERATION_TARGETS", () => {
    expect(GENERATION_TARGETS).toContain("solana_rust");
  });

  it("should support generation for solana_rust", () => {
    expect(isGenerationSupported("solana_rust")).toBe(true);
  });

  it("should generate a valid prompt for a token contract", () => {
    const prompt = generateContractPrompt(
      "solana_rust",
      "Create a basic token contract"
    );

    // Check prompt structure
    expect(prompt).toContain("Solana");
    expect(prompt).toContain("Create a basic token contract");
    expect(prompt).toContain("Generate a smart contract");
  });

  it("should include counter example in SOLANA_GENERATION_PROMPT", () => {
    expect(SOLANA_GENERATION_PROMPT).toContain("counter");
    expect(SOLANA_GENERATION_PROMPT).toContain("lib.rs");
    expect(SOLANA_GENERATION_PROMPT).toContain("dyad-write");
  });

  it("should include proper file structure paths in the prompt", () => {
    expect(SOLANA_GENERATION_PROMPT).toContain(
      "src/<program-name>/programs/<program-name>/src/lib.rs"
    );
  });

  it("should include Anchor framework patterns in the prompt", () => {
    // Account patterns
    expect(SOLANA_GENERATION_PROMPT).toContain("#[account]");
    expect(SOLANA_GENERATION_PROMPT).toContain("#[derive(Accounts)]");
    expect(SOLANA_GENERATION_PROMPT).toContain("#[program]");

    // PDA patterns
    expect(SOLANA_GENERATION_PROMPT).toContain("seeds");
    expect(SOLANA_GENERATION_PROMPT).toContain("bump");
    expect(SOLANA_GENERATION_PROMPT).toContain("find_program_address");
  });

  it("should include account model fundamentals in the prompt", () => {
    expect(SOLANA_GENERATION_PROMPT).toContain("Account Model");
    expect(SOLANA_GENERATION_PROMPT).toContain("Programs are stateless");
    expect(SOLANA_GENERATION_PROMPT).toContain("Account<'info");
    expect(SOLANA_GENERATION_PROMPT).toContain("Signer<'info");
  });

  it("should include anchor_lang imports in the prompt", () => {
    expect(SOLANA_GENERATION_PROMPT).toContain("use anchor_lang::prelude::*");
    expect(SOLANA_GENERATION_PROMPT).toContain("declare_id!");
  });

  it("should include account validation patterns", () => {
    expect(SOLANA_GENERATION_PROMPT).toContain("init");
    expect(SOLANA_GENERATION_PROMPT).toContain("payer");
    expect(SOLANA_GENERATION_PROMPT).toContain("space");
    expect(SOLANA_GENERATION_PROMPT).toContain("has_one");
  });

  it("should include error handling patterns", () => {
    expect(SOLANA_GENERATION_PROMPT).toContain("#[error_code]");
    expect(SOLANA_GENERATION_PROMPT).toContain("ErrorCode");
    expect(SOLANA_GENERATION_PROMPT).toContain("Result<()>");
  });

  it("should include event emission patterns", () => {
    expect(SOLANA_GENERATION_PROMPT).toContain("#[event]");
    expect(SOLANA_GENERATION_PROMPT).toContain("emit!");
  });

  it("should include space calculation guidelines", () => {
    expect(SOLANA_GENERATION_PROMPT).toContain("Space Calculation");
    expect(SOLANA_GENERATION_PROMPT).toContain("INIT_SPACE");
    expect(SOLANA_GENERATION_PROMPT).toContain("8 +"); // discriminator
  });

  it("should include security considerations", () => {
    expect(SOLANA_GENERATION_PROMPT).toContain("Security");
    expect(SOLANA_GENERATION_PROMPT).toContain("checked_add");
    expect(SOLANA_GENERATION_PROMPT).toContain("Overflow");
  });

  it("should include CPI pattern", () => {
    expect(SOLANA_GENERATION_PROMPT).toContain("CPI");
    expect(SOLANA_GENERATION_PROMPT).toContain("CpiContext");
  });
});
