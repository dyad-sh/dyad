/** Local contract-compatible TEST engine. Synthetic rates, no live debit.
 * Never use this catalog or balance store for production charging. */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  referencePricePicoUsd,
  type UsageEvent,
  type TokenCategories,
} from "../src/ipc/services/claude_code/usage";

export async function startClaudeBillingFixture() {
  const reservations = new Map<string, { chatId: number; turnId: string }>();
  const receipts = new Map<
    string,
    { payload: string; receipt: Record<string, unknown> }
  >();
  const events: UsageEvent[] = [];
  const server = createServer(async (req, res) => {
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 100_000) throw new Error("Too large");
      }
      const input = JSON.parse(body);
      if (req.url === "/authorize-usage") {
        const reservationId = randomUUID();
        reservations.set(reservationId, {
          chatId: input.chatId,
          turnId: input.turnId,
        });
        reply(200, {
          reservationId,
          pricingSnapshotId: "synthetic-test-v1",
          testMode: true,
        });
        return;
      }
      if (req.url !== "/track-usage") {
        reply(404, {});
        return;
      }
      const existing = receipts.get(input.eventId);
      if (existing) {
        reply(existing.payload === body ? 200 : 409, existing.receipt);
        return;
      }
      const reservation = reservations.get(input.reservationId);
      if (
        !reservation ||
        input.chatId !== reservation.chatId ||
        input.turnId !== reservation.turnId
      ) {
        reply(409, { error: "reservation_invalid" });
        return;
      }
      let picoUsd = 0n;
      let complete = input.coverage === "complete";
      try {
        for (const model of input.models) {
          const {
            actualModelId,
            reportedCanonicalModelId: _canonical,
            ...tokens
          } = model;
          // Known-model branch intentionally uses synthetic, versioned rates.
          const rates = actualModelId.startsWith("claude-")
            ? {
                uncachedInputTokens: 3_000_000,
                cacheReadInputTokens: 300_000,
                cacheWrite5mInputTokens: 3_750_000,
                cacheWrite1hInputTokens: 6_000_000,
                outputTokens: 15_000_000,
              }
            : "unknown";
          picoUsd += referencePricePicoUsd(tokens as TokenCategories, rates);
        }
      } catch {
        complete = false;
      }
      const receipt = {
        eventId: input.eventId,
        status: complete ? "test-settled" : "reconciliation",
        chargeUsd: (Number(picoUsd) / 1e12).toFixed(12),
        pricingSnapshotId: "synthetic-test-v1",
      };
      receipts.set(input.eventId, { payload: body, receipt });
      events.push(input);
      reply(200, receipt);
    } catch {
      reply(400, { error: "invalid_event" });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture failed");
  return {
    url: `http://127.0.0.1:${address.port}`,
    events,
    receipts,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
