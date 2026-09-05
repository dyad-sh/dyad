import { describe, expect, it } from "vitest";
import { calculateSubscriptionCharge } from "./subscriptionUsage";

describe("subscription pricing contract", () => {
  it("charges 25% of each category's API list price", () => {
    expect(
      calculateSubscriptionCharge(
        {
          input: 1_000_000,
          cacheRead: 2_000_000,
          cacheWrite: 1_000_000,
          output: 1_000_000,
        },
        { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 8 },
      ),
    ).toBeCloseTo(3.225);
  });
  it("charges unknown models 10 cents/million for every token, without another discount", () => {
    expect(
      calculateSubscriptionCharge(
        {
          input: 250_000,
          cacheRead: 250_000,
          cacheWrite: 250_000,
          output: 250_000,
        },
        null,
      ),
    ).toBeCloseTo(0.1);
  });
  it("rejects invalid usage and incomplete known pricing", () => {
    expect(() =>
      calculateSubscriptionCharge(
        { input: -1, cacheRead: 0, cacheWrite: 0, output: 0 },
        null,
      ),
    ).toThrow();
    expect(() =>
      calculateSubscriptionCharge(
        { input: 1, cacheRead: 0, cacheWrite: 0, output: 0 },
        { input: NaN, cacheRead: 0, cacheWrite: 0, output: 0 },
      ),
    ).toThrow();
  });
});
