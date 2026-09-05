// @vitest-environment node
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { startClaudeBillingFixture } from "../../../../testing/claude-code-billing-fixture";

it("settles idempotently, rejects changed retries and correlates reservations", async () => {
  const engine = await startClaudeBillingFixture();
  const post = (route: string, body: unknown) =>
    fetch(`${engine.url}${route}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  try {
    const reservation = await (
      await post("/authorize-usage", { chatId: 1, turnId: "turn" })
    ).json();
    const event = {
      schemaVersion: 1,
      eventId: randomUUID(),
      backend: "claude-code",
      chatId: 1,
      turnId: "turn",
      sessionId: "session",
      reservationId: reservation.reservationId,
      pricingSnapshotId: reservation.pricingSnapshotId,
      coverage: "complete",
      outcome: "completed",
      models: [
        {
          actualModelId: "unknown",
          uncachedInputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 0,
          cacheWrite5mInputTokens: 0,
          cacheWrite1hInputTokens: 0,
          cacheWriteUnclassifiedInputTokens: 0,
        },
      ],
    };
    const first = await (await post("/track-usage", event)).json();
    expect(first.status).toBe("test-settled");
    expect(first.chargeUsd).toBe("0.000015000000");
    expect(await (await post("/track-usage", event)).json()).toEqual(first);
    expect(engine.events).toHaveLength(1);
    expect((await post("/track-usage", { ...event, chatId: 2 })).status).toBe(
      409,
    );
    expect(
      (
        await post("/track-usage", {
          ...event,
          eventId: randomUUID(),
          chatId: 2,
        })
      ).status,
    ).toBe(409);
    const incomplete = await (
      await post("/track-usage", {
        ...event,
        eventId: randomUUID(),
        coverage: "incomplete",
      })
    ).json();
    expect(incomplete.status).toBe("reconciliation");
  } finally {
    engine.close();
  }
});
