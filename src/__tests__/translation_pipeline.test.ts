/**
 * Unit tests for translation_pipeline.ts
 * Tests the document phase, fallback context, and MCP error handling
 */

import { describe, it, expect } from "vitest";
import {
  createFallbackContext,
  isMcpConnectionError,
  buildEnrichedPrompt,
  getContextSummary,
  generateAIRulesContent,
  type DocumentPhaseResult,
} from "../lib/translation_pipeline";

describe("Translation Pipeline - isMcpConnectionError", () => {
  it("should detect 'connection closed' error", () => {
    const error = new Error("MCP error -32000: Connection closed");
    expect(isMcpConnectionError(error)).toBe(true);
  });

  it("should detect 'mcp error' in message", () => {
    const error = new Error("[mcp:call-tool] McpError: something went wrong");
    expect(isMcpConnectionError(error)).toBe(true);
  });

  it("should detect connection refused errors", () => {
    const error = new Error("ECONNREFUSED: Connection refused");
    expect(isMcpConnectionError(error)).toBe(true);
  });

  it("should detect timeout errors", () => {
    const error = new Error("Operation timeout after 30000ms");
    expect(isMcpConnectionError(error)).toBe(true);
  });

  it("should return false for non-MCP errors", () => {
    const error = new Error("Something else went wrong");
    expect(isMcpConnectionError(error)).toBe(false);
  });

  it("should return false for non-Error objects", () => {
    expect(isMcpConnectionError("string error")).toBe(false);
    expect(isMcpConnectionError(null)).toBe(false);
    expect(isMcpConnectionError(undefined)).toBe(false);
    expect(isMcpConnectionError(123)).toBe(false);
  });
});

describe("Translation Pipeline - createFallbackContext", () => {
  it("should create fallback context for sui_move", () => {
    const context = createFallbackContext("sui_move");

    expect(context.ecosystem.docs).toContain("Sui Move Development Guide");
    expect(context.ecosystem.docs).toContain("https://docs.sui.io/");
    expect(context.ecosystem.size).toBeGreaterThan(0);
    expect(context.version.current).toBe("latest");
    expect(context.translation.guide).toContain("Sui Move");
    expect(context.translation.patterns).toBeDefined();
    expect(context.translation.patterns.mapping).toBeDefined();
  });

  it("should create fallback context for solana_rust (Anchor)", () => {
    const context = createFallbackContext("solana_rust");

    expect(context.ecosystem.docs).toContain("Solana/Anchor Development Guide");
    expect(context.ecosystem.docs).toContain("https://www.anchor-lang.com/docs/");
    expect(context.translation.guide).toContain("Solana/Anchor");
  });

  it("should create fallback context for unknown language", () => {
    const context = createFallbackContext("unknown_lang");

    expect(context.ecosystem.docs).toContain("Blockchain Development Guide");
    expect(context.version.current).toBe("latest");
    expect(context.translation.patterns).toBeDefined();
  });

  it("should include standard feature patterns in fallback", () => {
    const context = createFallbackContext("sui_move");

    expect(context.translation.patterns.mapping).toBeDefined();
    expect(context.translation.patterns.modifier).toBeDefined();
    expect(context.translation.patterns.event).toBeDefined();
    expect(context.translation.patterns.inheritance).toBeDefined();
    expect(context.translation.patterns.payable).toBeDefined();
    expect(context.translation.patterns.constructor).toBeDefined();
  });

  it("should indicate MCP unavailability in release notes", () => {
    const context = createFallbackContext("sui_move");

    expect(context.version.releaseNotes).toContain("MCP server not connected");
    expect(context.version.docLinks).toEqual([]);
  });
});

describe("Translation Pipeline - buildEnrichedPrompt", () => {
  const mockContext: DocumentPhaseResult = {
    ecosystem: {
      docs: "# Test Documentation\n\nSome docs here.",
      size: 50,
    },
    version: {
      current: "1.0.0",
      releaseNotes: "Version 1.0.0 release notes",
      docLinks: ["https://example.com/docs"],
    },
    translation: {
      guide: "Translation guide content",
      patterns: {
        mapping: "Mapping pattern",
        event: "Event pattern",
      },
    },
  };

  it("should include base prompt in enriched output", () => {
    const basePrompt = "Generate a counter contract";
    const enriched = buildEnrichedPrompt(basePrompt, mockContext);

    expect(enriched).toContain(basePrompt);
  });

  it("should include version information", () => {
    const enriched = buildEnrichedPrompt("Base prompt", mockContext);

    expect(enriched).toContain("1.0.0");
    expect(enriched).toContain("Current Version:");
  });

  it("should include documentation links", () => {
    const enriched = buildEnrichedPrompt("Base prompt", mockContext);

    expect(enriched).toContain("https://example.com/docs");
    expect(enriched).toContain("Official Documentation Links");
  });

  it("should include translation guide", () => {
    const enriched = buildEnrichedPrompt("Base prompt", mockContext);

    expect(enriched).toContain("Translation guide content");
    expect(enriched).toContain("Translation Guide");
  });

  it("should include feature mapping patterns", () => {
    const enriched = buildEnrichedPrompt("Base prompt", mockContext);

    expect(enriched).toContain("Mapping pattern");
    expect(enriched).toContain("Event pattern");
    expect(enriched).toContain("Feature Mapping Reference");
  });

  it("should truncate docs when includeFullDocs is false", () => {
    const largeContext: DocumentPhaseResult = {
      ...mockContext,
      ecosystem: {
        docs: "x".repeat(100000),
        size: 100000,
      },
    };

    const enriched = buildEnrichedPrompt("Base prompt", largeContext, {
      includeFullDocs: false,
      docsPreviewSize: 1000,
    });

    expect(enriched).toContain("[...Documentation truncated");
    expect(enriched.length).toBeLessThan(110000);
  });

  it("should include full docs when includeFullDocs is true", () => {
    const enriched = buildEnrichedPrompt("Base prompt", mockContext, {
      includeFullDocs: true,
    });

    expect(enriched).not.toContain("[...Documentation truncated");
    expect(enriched).toContain("# Test Documentation");
  });
});

describe("Translation Pipeline - getContextSummary", () => {
  const mockContext: DocumentPhaseResult = {
    ecosystem: {
      docs: "x".repeat(50000),
      size: 50000,
    },
    version: {
      current: "2.0.0",
      releaseNotes: "Release notes",
      docLinks: ["https://link1.com", "https://link2.com"],
    },
    translation: {
      guide: "Guide",
      patterns: {
        mapping: "Pattern 1",
        event: "Pattern 2",
        modifier: "Pattern 3",
      },
    },
  };

  it("should include docs size in KB", () => {
    const summary = getContextSummary(mockContext);

    // 50000 bytes / 1024 = 48.828 which rounds to 49KB
    expect(summary).toContain("49KB");
    expect(summary).toContain("Ecosystem docs:");
  });

  it("should include current version", () => {
    const summary = getContextSummary(mockContext);

    expect(summary).toContain("2.0.0");
    expect(summary).toContain("Current version:");
  });

  it("should include pattern names", () => {
    const summary = getContextSummary(mockContext);

    expect(summary).toContain("mapping");
    expect(summary).toContain("event");
    expect(summary).toContain("modifier");
  });

  it("should include documentation link count", () => {
    const summary = getContextSummary(mockContext);

    expect(summary).toContain("2 found");
    expect(summary).toContain("Documentation links:");
  });
});

describe("Translation Pipeline - generateAIRulesContent", () => {
  const mockContext: DocumentPhaseResult = {
    ecosystem: {
      docs: "# Ecosystem Docs\n\nTest content here.",
      size: 100,
    },
    version: {
      current: "3.0.0",
      releaseNotes: "Version 3.0.0 released with new features",
      docLinks: ["https://docs.example.com/v3"],
    },
    translation: {
      guide: "Translation guide for this ecosystem",
      patterns: {
        mapping: "Use objects instead of mappings",
        event: "Use events module for event emission",
      },
    },
  };

  it("should generate AI rules for Sui Move", () => {
    const rules = generateAIRulesContent(mockContext, "sui_move", "solidity");

    expect(rules).toContain("AI Translation Rules");
    expect(rules).toContain("Sui Move");
    expect(rules).toContain("SOLIDITY");
  });

  it("should generate AI rules for Solana Anchor", () => {
    const rules = generateAIRulesContent(
      mockContext,
      "solana_rust",
      "solidity"
    );

    expect(rules).toContain("Solana (Anchor)");
  });

  it("should include version information", () => {
    const rules = generateAIRulesContent(mockContext, "sui_move");

    expect(rules).toContain("3.0.0");
    expect(rules).toContain("Current Version");
    expect(rules).toContain("Latest Release Notes");
  });

  it("should include documentation links", () => {
    const rules = generateAIRulesContent(mockContext, "sui_move");

    expect(rules).toContain("https://docs.example.com/v3");
    expect(rules).toContain("Official Documentation");
  });

  it("should include translation guide", () => {
    const rules = generateAIRulesContent(mockContext, "sui_move");

    expect(rules).toContain("Translation guide for this ecosystem");
  });

  it("should include feature compatibility matrix", () => {
    const rules = generateAIRulesContent(mockContext, "sui_move");

    expect(rules).toContain("Feature Compatibility Matrix");
    expect(rules).toContain("Mapping");
    expect(rules).toContain("Event");
    expect(rules).toContain("Use objects instead of mappings");
  });

  it("should include translation checklist", () => {
    const rules = generateAIRulesContent(mockContext, "sui_move");

    expect(rules).toContain("Translation Checklist");
    expect(rules).toContain("Use Current Syntax");
    expect(rules).toContain("Apply Feature Mappings");
    expect(rules).toContain("Follow Best Practices");
  });

  it("should include documentation size summary", () => {
    const rules = generateAIRulesContent(mockContext, "sui_move");

    expect(rules).toContain("Total Documentation Size:");
  });

  it("should include current date", () => {
    const rules = generateAIRulesContent(mockContext, "sui_move");
    const currentDate = new Date().toISOString().split("T")[0];

    expect(rules).toContain(currentDate);
  });

  it("should handle natural_language as source", () => {
    const rules = generateAIRulesContent(
      mockContext,
      "sui_move",
      "natural_language"
    );

    expect(rules).toContain("NATURAL_LANGUAGE");
    expect(rules).toContain("Sui Move");
  });
});

describe("Translation Pipeline - Fallback Context Integration", () => {
  it("should create valid context that works with buildEnrichedPrompt", () => {
    const fallback = createFallbackContext("sui_move");
    const enriched = buildEnrichedPrompt("Generate a contract", fallback);

    expect(enriched).toContain("Generate a contract");
    expect(enriched).toContain("latest");
    expect(enriched).toContain("Sui Move");
  });

  it("should create valid context that works with getContextSummary", () => {
    const fallback = createFallbackContext("solana_rust");
    const summary = getContextSummary(fallback);

    expect(summary).toContain("latest");
    expect(summary).toContain("mapping");
    expect(summary).toContain("Ecosystem docs:");
  });

  it("should create valid context that works with generateAIRulesContent", () => {
    const fallback = createFallbackContext("sui_move");
    const rules = generateAIRulesContent(fallback, "sui_move");

    expect(rules).toContain("AI Translation Rules");
    expect(rules).toContain("Sui Move");
    expect(rules).toContain("MCP server not connected");
  });
});
