import { describe, expect, it, vi } from "vitest";

import {
  getCompactionThreshold,
  getTemperature,
  estimateToolResultTokens,
  shouldTriggerCompaction,
} from "@/ipc/utils/token_utils";
import { findLanguageModel } from "@/ipc/utils/findLanguageModel";

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(),
}));

vi.mock("@/ipc/utils/findLanguageModel", () => ({
  findLanguageModel: vi.fn(),
}));

const mockFindLanguageModel = vi.mocked(findLanguageModel);

describe("estimateToolResultTokens", () => {
  it("estimates provider-bound tool result envelopes without recounting input", () => {
    const toolResults = [
      {
        toolCallId: "call-1",
        toolName: "read_file",
        input: { path: "x".repeat(100_000) },
        output: "file contents",
      },
    ];
    const serializedResult = JSON.stringify([
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "read_file",
        output: "file contents",
      },
    ]);

    expect(estimateToolResultTokens(toolResults)).toBe(
      Math.ceil(serializedResult.length / 4),
    );
  });

  it("handles bigint values in structured tool output", () => {
    expect(
      estimateToolResultTokens([
        {
          toolCallId: "call-1",
          toolName: "query",
          output: { rows: [{ count: 42n }] },
        },
      ]),
    ).toBeGreaterThan(0);
  });

  it("includes failed tool output sent to the next model step", () => {
    const toolErrors = [
      {
        toolCallId: "call-1",
        toolName: "execute_command",
        error: { message: "x".repeat(40_000) },
      },
    ];

    expect(estimateToolResultTokens([], toolErrors)).toBeGreaterThan(10_000);
  });

  it("includes non-enumerable Error messages sent to the next model step", () => {
    const errorMessage = "x".repeat(40_000);
    const toolErrors = [
      {
        toolCallId: "call-1",
        toolName: "execute_command",
        error: new Error(errorMessage),
      },
    ];
    const serializedResult = JSON.stringify([
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "execute_command",
        output: { type: "error-text", value: errorMessage },
      },
    ]);

    expect(estimateToolResultTokens([], toolErrors)).toBe(
      Math.ceil(serializedResult.length / 4),
    );
  });
});

describe("getTemperature", () => {
  it("does not set a default temperature for models without metadata", async () => {
    mockFindLanguageModel.mockResolvedValueOnce({
      apiName: "cloud-model",
      displayName: "Cloud Model",
      type: "cloud",
    });

    await expect(
      getTemperature({ provider: "provider", name: "cloud-model" }),
    ).resolves.toBeUndefined();
  });

  it("uses configured model temperature metadata", async () => {
    mockFindLanguageModel.mockResolvedValueOnce({
      apiName: "cloud-model",
      displayName: "Cloud Model",
      type: "cloud",
      temperature: 0.7,
    });

    await expect(
      getTemperature({ provider: "provider", name: "cloud-model" }),
    ).resolves.toBe(0.7);
  });
});

describe("getCompactionThreshold", () => {
  describe("openai provider", () => {
    it("uses the 220k cap for large context windows", () => {
      expect(getCompactionThreshold(400_000, "openai")).toBe(220_000);
    });

    it("falls back to contextWindow - 25k when the cap is higher", () => {
      expect(getCompactionThreshold(200_000, "openai")).toBe(175_000);
    });
  });

  describe("other non-google providers", () => {
    it("uses the 250k cap for large context windows", () => {
      expect(getCompactionThreshold(1_000_000, "anthropic")).toBe(250_000);
    });

    it("falls back to contextWindow - 25k when the cap is higher", () => {
      expect(getCompactionThreshold(128_000, "anthropic")).toBe(103_000);
    });

    it("treats unknown providers like non-google providers", () => {
      expect(getCompactionThreshold(400_000, "vertex")).toBe(250_000);
      expect(getCompactionThreshold(400_000, "openrouter")).toBe(250_000);
    });

    it("leaves 25k headroom for the Auto model's configured context", () => {
      expect(getCompactionThreshold(250_000, "auto")).toBe(225_000);
    });
  });

  describe("google provider", () => {
    it("uses the 190k cap for large context windows", () => {
      expect(getCompactionThreshold(1_000_000, "google")).toBe(190_000);
      expect(getCompactionThreshold(400_000, "google")).toBe(190_000);
    });

    it("falls back to contextWindow - 25k when the cap is higher", () => {
      expect(getCompactionThreshold(200_000, "google")).toBe(175_000);
      expect(getCompactionThreshold(128_000, "google")).toBe(103_000);
    });
  });
});

describe("shouldTriggerCompaction", () => {
  it("triggers when token count meets the openai threshold", () => {
    expect(shouldTriggerCompaction(220_000, 400_000, "openai")).toBe(true);
    expect(shouldTriggerCompaction(219_999, 400_000, "openai")).toBe(false);
  });

  it("triggers earlier for google than for other providers", () => {
    expect(shouldTriggerCompaction(190_000, 1_000_000, "google")).toBe(true);
    expect(shouldTriggerCompaction(190_000, 1_000_000, "openai")).toBe(false);
  });

  it("respects the contextWindow - 25k floor when the cap is higher", () => {
    expect(shouldTriggerCompaction(175_000, 200_000, "openai")).toBe(true);
    expect(shouldTriggerCompaction(174_999, 200_000, "openai")).toBe(false);
    expect(shouldTriggerCompaction(175_000, 200_000, "google")).toBe(true);
  });
});
