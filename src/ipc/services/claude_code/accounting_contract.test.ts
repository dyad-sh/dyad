// @vitest-environment node
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { startClaudeBillingFixture } from "../../../../testing/claude-code-billing-fixture";
it("validates flat-rate token accounting and engine idempotency", async () => {
  const engine = await startClaudeBillingFixture();
  const post = (body: unknown) =>
    fetch(`${engine.url}/track-usage`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  try {
    const event = {
      version: 1,
      id: randomUUID(),
      connection: "subscription",
      modelProvider: "anthropic",
      modelId: "claude-sonnet",
      createdAt: new Date().toISOString(),
      totalTokens: 150,
      cachedInputTokens: 20,
      uncachedInputTokens: 80,
      outputTokens: 50,
    };
    const first = await (await post(event)).json();
    expect(first.chargedUsd).toBeCloseTo(0.000015, 12);
    expect(await (await post(event)).json()).toEqual(first);
    expect(engine.events).toHaveLength(1);
    expect((await post({ ...event, modelId: "other" })).status).toBe(409);
    expect(
      (await post({ ...event, id: randomUUID(), totalTokens: 200 })).status,
    ).toBe(400);
    for (const suffix of ["-mini", "-nano", "-luna"]) {
      const discounted = await (
        await post({ ...event, id: randomUUID(), modelId: `model${suffix}` })
      ).json();
      expect(discounted.chargedUsd).toBeCloseTo(0.000003, 12);
    }
  } finally {
    engine.close();
  }
});
