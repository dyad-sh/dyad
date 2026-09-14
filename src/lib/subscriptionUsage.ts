/** Disjoint token counts. Cache writes are uncached input on the wire. */
export type SubscriptionTokens = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};
