import { describe, expect, it } from "vitest";
import { pickPromoMessage, PROMO_MESSAGES } from "./PromoMessage";

describe("pickPromoMessage", () => {
  it("always returns a configured message", () => {
    for (let seed = 0; seed < 500; seed++) {
      expect(PROMO_MESSAGES).toContain(pickPromoMessage(seed));
    }
  });

  it("is deterministic for a given seed", () => {
    expect(pickPromoMessage(42)).toBe(pickPromoMessage(42));
  });

  it("weights Pro promos above community tips", () => {
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 3000; seed++) {
      const message = pickPromoMessage(seed);
      counts.set(message.id, (counts.get(message.id) ?? 0) + 1);
    }

    let proCount = 0;
    let communityCount = 0;
    for (const message of PROMO_MESSAGES) {
      const count = counts.get(message.id) ?? 0;
      expect(count).toBeGreaterThan(0);
      if (message.target.type === "trial-dialog") {
        proCount += count;
      } else {
        communityCount += count;
      }
    }
    // Pro promos carry 12 of 15 weight → ~80% of impressions.
    expect(proCount / (proCount + communityCount)).toBeGreaterThan(0.7);
  });
});
