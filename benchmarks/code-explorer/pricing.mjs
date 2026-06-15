export const MODEL_PRICING = {
  primary: {
    model: "gpt-5.5",
    label: "Primary dyad/auto as GPT-5.5",
    inputPerMillion: 5,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 30,
  },
  value: {
    model: "gpt-5.4-mini",
    label: "Value dyad/value as GPT-5.4 mini",
    inputPerMillion: 0.75,
    cachedInputPerMillion: 0.075,
    outputPerMillion: 4.5,
  },
};

export function usageCost(usage, pricing) {
  return (
    ((usage.uncachedInputTokens ?? 0) * pricing.inputPerMillion +
      (usage.cachedInputTokens ?? 0) * pricing.cachedInputPerMillion +
      (usage.outputTokens ?? 0) * pricing.outputPerMillion) /
    1_000_000
  );
}

export function formatDollars(value) {
  return `$${Number(value ?? 0).toFixed(4)}`;
}
