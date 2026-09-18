import { expect, it } from "vitest";
import {
  claudeCodeModelId,
  claudeCodeModelIdentity,
  claudeCodeDisplayName,
  withClaudeCodeModels,
} from "./claudeCodeModels";

const suggestions = [
  {
    value: "claude-fable-5-1[1m]",
    resolvedModel: "claude-fable-5-1",
    displayName: "Fable",
    description: "Fable 5.1",
  },
];
const catalog = {
  anthropic: [
    {
      apiName: "claude-fable-5",
      displayName: "Claude Fable 5",
      dollarSigns: 5,
    },
    {
      apiName: "claude-fable-5-1",
      displayName: "Claude Fable 5.1",
      dollarSigns: 3,
    },
  ],
};

it("preserves both exact Fable versions even when the CLI only suggests 5.1", () => {
  expect(withClaudeCodeModels(catalog, suggestions)).toEqual({
    anthropic: catalog.anthropic,
    "claude-code": catalog.anthropic,
  });
  expect(withClaudeCodeModels(catalog, [])["claude-code"]).toEqual(
    catalog.anthropic,
  );
  expect(claudeCodeDisplayName("claude-fable-5", suggestions, catalog)).toBe(
    "Fable 5",
  );
});

it("deduplicates reseller IDs, aliases and Default without changing the selected version", () => {
  const result = withClaudeCodeModels(
    {
      openrouter: [
        {
          apiName: "anthropic/claude-fable-5.1",
          displayName: "Reseller Fable",
        },
      ],
      ...catalog,
    },
    [
      ...suggestions,
      {
        value: "default",
        resolvedModel: "claude-fable-5-1",
        displayName: "Default",
        description: "",
      },
    ],
  );
  expect(result["claude-code"]).toEqual(catalog.anthropic);
  expect(result.openrouter).toEqual([
    { apiName: "anthropic/claude-fable-5.1", displayName: "Reseller Fable" },
  ]);
});

it("adds CLI-only models and keeps their executable values", () => {
  expect(withClaudeCodeModels(undefined, suggestions)["claude-code"]).toEqual([
    {
      apiName: "claude-fable-5-1[1m]",
      displayName: "Fable",
      description: "Fable 5.1",
      type: "cloud",
    },
  ]);
});

it("preserves dated model versions and does not equate them to a different snapshot", () => {
  expect(
    claudeCodeModelId("anthropic", {
      apiName: "claude-haiku-4-5-20251001",
      displayName: "Haiku",
    }),
  ).toBe("claude-haiku-4-5-20251001");
  expect(claudeCodeModelIdentity("claude-haiku-4-5-20251001", [])).not.toBe(
    "claude-haiku-4-5",
  );
});

it.each([
  ["custom-provider", "claude-fable-5", undefined],
  ["bedrock", "us.anthropic.claude-fable-5-v1:0", undefined],
  ["anthropic", "claude-fable-5", "custom"],
  ["openrouter", "anthropic/claude-fable-5:beta", undefined],
  ["openai", "gpt-5", undefined],
] as const)(
  "does not reroute custom, provider-specific or non-Claude entries: %s %s",
  (provider, apiName, type) => {
    const model = { apiName, displayName: "Model", type };
    expect(claudeCodeModelId(provider, model)).toBeUndefined();
    expect(withClaudeCodeModels({ [provider]: [model] }, [])[provider]).toEqual(
      [model],
    );
  },
);
