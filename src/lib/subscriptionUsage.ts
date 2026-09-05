export type SubscriptionTokens = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};
export type SubscriptionRates = SubscriptionTokens;

/** Rates are USD/million. Categories are disjoint; output includes reasoning. */
export function calculateSubscriptionCharge(
  tokens: SubscriptionTokens,
  rates: SubscriptionRates | null,
): number {
  for (const count of Object.values(tokens)) {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error("Invalid subscription token count");
  }
  if (rates === null)
    return (Object.values(tokens).reduce((a, b) => a + b, 0) * 0.1) / 1_000_000;
  for (const rate of Object.values(rates)) {
    if (!Number.isFinite(rate) || rate < 0)
      throw new Error("Missing or invalid API list price");
  }
  return (
    ((tokens.input * rates.input +
      tokens.cacheRead * rates.cacheRead +
      tokens.cacheWrite * rates.cacheWrite +
      tokens.output * rates.output) *
      0.25) /
    1_000_000
  );
}
