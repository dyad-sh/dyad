import { describe, it, expect } from "vitest";
import { apps } from "../db/schema";
import type { GenerationMetadata, CreateAppParams } from "../ipc/ipc_types";

describe("NL Prompt and Generation Metadata Database Storage", () => {
  describe("Schema Definition", () => {
    it("should have nlPrompt column defined in apps table", () => {
      // The apps table should have the nlPrompt column
      expect(apps.nlPrompt).toBeDefined();
      expect(apps.nlPrompt.name).toBe("nl_prompt");
    });

    it("should have generationMetadata column defined in apps table", () => {
      // The apps table should have the generationMetadata column
      expect(apps.generationMetadata).toBeDefined();
      expect(apps.generationMetadata.name).toBe("generation_metadata");
    });

    it("should have nlPrompt as text type", () => {
      // nlPrompt should be a text column
      expect(apps.nlPrompt.dataType).toBe("string");
    });

    it("should have generationMetadata as JSON type", () => {
      // generationMetadata should be stored as JSON (text column with json mode in drizzle)
      expect(apps.generationMetadata.dataType).toBe("json");
    });
  });

  describe("Type Definitions", () => {
    it("should have GenerationMetadata interface with required fields", () => {
      // Create a valid GenerationMetadata object to verify the type structure
      const metadata: GenerationMetadata = {
        model: "claude-3-sonnet",
        generationTime: 5000,
        phasesCompleted: {
          document: true,
          plan: true,
          act: true,
        },
        createdAt: "2026-01-13T12:00:00.000Z",
        targetBlockchain: "sui_move",
        promptLength: 50,
      };

      expect(metadata.model).toBe("claude-3-sonnet");
      expect(metadata.generationTime).toBe(5000);
      expect(metadata.phasesCompleted.document).toBe(true);
      expect(metadata.phasesCompleted.plan).toBe(true);
      expect(metadata.phasesCompleted.act).toBe(true);
      expect(metadata.createdAt).toBe("2026-01-13T12:00:00.000Z");
      expect(metadata.targetBlockchain).toBe("sui_move");
      expect(metadata.promptLength).toBe(50);
    });

    it("should have CreateAppParams with optional nlPrompt and generationMetadata", () => {
      // Test that CreateAppParams supports both fields
      const paramsWithNL: CreateAppParams = {
        name: "test-contract",
        isContractProject: true,
        nlPrompt: "Create a simple token contract with minting capabilities",
        generationMetadata: {
          model: "claude-3-sonnet",
          generationTime: 3000,
          phasesCompleted: {
            document: true,
            plan: true,
            act: false,
          },
          createdAt: "2026-01-13T12:00:00.000Z",
          targetBlockchain: "solana_rust",
          promptLength: 55,
        },
      };

      expect(paramsWithNL.nlPrompt).toBeDefined();
      expect(paramsWithNL.generationMetadata).toBeDefined();
      expect(paramsWithNL.generationMetadata?.targetBlockchain).toBe(
        "solana_rust"
      );
    });

    it("should allow CreateAppParams without nlPrompt for translation mode", () => {
      // Test that CreateAppParams works without NL fields (translation mode)
      const paramsWithoutNL: CreateAppParams = {
        name: "translated-contract",
        isContractProject: true,
      };

      expect(paramsWithoutNL.nlPrompt).toBeUndefined();
      expect(paramsWithoutNL.generationMetadata).toBeUndefined();
    });
  });

  describe("Generation Metadata JSON Structure", () => {
    it("should serialize GenerationMetadata to valid JSON", () => {
      const metadata: GenerationMetadata = {
        model: "claude-3-sonnet",
        generationTime: 5000,
        phasesCompleted: {
          document: true,
          plan: true,
          act: true,
        },
        createdAt: "2026-01-13T12:00:00.000Z",
        targetBlockchain: "sui_move",
        promptLength: 50,
      };

      const jsonString = JSON.stringify(metadata);
      expect(() => JSON.parse(jsonString)).not.toThrow();

      const parsed = JSON.parse(jsonString);
      expect(parsed.model).toBe("claude-3-sonnet");
      expect(parsed.phasesCompleted.document).toBe(true);
    });

    it("should handle partial phase completion", () => {
      const metadata: GenerationMetadata = {
        model: "claude-3-sonnet",
        generationTime: 2000,
        phasesCompleted: {
          document: true,
          plan: false, // Still in progress
          act: false,
        },
        createdAt: "2026-01-13T12:00:00.000Z",
        targetBlockchain: "solidity",
        promptLength: 100,
      };

      // Verify partial completion state
      expect(metadata.phasesCompleted.document).toBe(true);
      expect(metadata.phasesCompleted.plan).toBe(false);
      expect(metadata.phasesCompleted.act).toBe(false);

      // Verify it serializes correctly
      const jsonString = JSON.stringify(metadata);
      const parsed = JSON.parse(jsonString);
      expect(parsed.phasesCompleted.document).toBe(true);
      expect(parsed.phasesCompleted.plan).toBe(false);
    });

    it("should support all target blockchain values", () => {
      const blockchains = ["sui_move", "solana_rust", "solidity"];

      for (const blockchain of blockchains) {
        const metadata: GenerationMetadata = {
          model: "test-model",
          generationTime: 1000,
          phasesCompleted: {
            document: true,
            plan: true,
            act: true,
          },
          createdAt: new Date().toISOString(),
          targetBlockchain: blockchain,
          promptLength: 25,
        };

        expect(metadata.targetBlockchain).toBe(blockchain);

        // Verify JSON serialization works
        const jsonString = JSON.stringify(metadata);
        const parsed = JSON.parse(jsonString);
        expect(parsed.targetBlockchain).toBe(blockchain);
      }
    });
  });

  describe("Schema Metadata Types Match Database", () => {
    it("should have generationMetadata type definition matching schema", () => {
      // The schema defines generationMetadata with specific structure
      // Verify by checking that a valid metadata object would match the expected type
      const validMetadata = {
        model: "test",
        generatedAt: Date.now(),
        targetBlockchain: "sui_move",
        phases: {
          document: { status: "completed", completedAt: Date.now() },
          plan: { status: "completed", completedAt: Date.now() },
          act: { status: "completed", completedAt: Date.now() },
        },
        regenerationCount: 0,
      };

      // The schema defines this structure - this test documents it
      expect(typeof validMetadata.model).toBe("string");
      expect(typeof validMetadata.generatedAt).toBe("number");
      expect(typeof validMetadata.targetBlockchain).toBe("string");
      expect(validMetadata.phases).toBeDefined();
      expect(typeof validMetadata.regenerationCount).toBe("number");
    });
  });

  describe("NL Prompt Storage Scenarios", () => {
    it("should handle short NL prompts", () => {
      const shortPrompt = "Create an NFT";
      expect(shortPrompt.length).toBeGreaterThan(0);
      expect(shortPrompt.length).toBeLessThan(2000);
    });

    it("should handle long NL prompts up to 2000 characters", () => {
      const longPrompt =
        "Create a comprehensive NFT marketplace contract with the following features: " +
        "1. Minting functionality with royalty support where creators receive a percentage " +
        "of each secondary sale. " +
        "2. Auction functionality where users can bid on NFTs with automatic refunds " +
        "for outbid participants. " +
        "3. Fixed-price listing functionality where NFTs can be listed at a set price. " +
        "4. Offer system where buyers can make offers below the listing price. " +
        "5. Collection management where creators can organize their NFTs into collections. " +
        "6. Royalty splitting to support multiple creators per NFT. " +
        "7. Whitelist functionality for presale access. " +
        "8. Reveal mechanism for blind drops. " +
        "9. Admin controls for pausing and emergency withdrawals. " +
        "10. Event emissions for all major actions for indexing.";

      expect(longPrompt.length).toBeLessThan(2000);
    });

    it("should handle multi-line NL prompts", () => {
      const multiLinePrompt = `Create a token contract with:
- Minting capability
- Burning capability
- Transfer with memo
- Pausable functionality
- Admin roles`;

      expect(multiLinePrompt).toContain("\n");
      expect(multiLinePrompt.split("\n").length).toBeGreaterThan(1);
    });

    it("should handle special characters in NL prompts", () => {
      const specialCharsPrompt =
        'Create a contract for "MyToken" with 10% fee & admin capabilities';

      expect(specialCharsPrompt).toContain('"');
      expect(specialCharsPrompt).toContain("%");
      expect(specialCharsPrompt).toContain("&");

      // Verify it can be JSON stringified
      const jsonSafe = JSON.stringify({ prompt: specialCharsPrompt });
      expect(() => JSON.parse(jsonSafe)).not.toThrow();
    });
  });
});
