/** Test-only engine contract: flat rates, no live debit. */
import { createServer } from "node:http";
import { z } from "zod";
const count = z.number().int().nonnegative().max(1_000_000_000_000);
export const UsageReport = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    connection: z.literal("subscription"),
    modelProvider: z.literal("anthropic"),
    modelId: z.string().min(1),
    createdAt: z.string().datetime(),
    totalTokens: count,
    cachedInputTokens: count,
    uncachedInputTokens: count,
    outputTokens: count,
  })
  .strict();
export async function startClaudeBillingFixture() {
  const events: z.infer<typeof UsageReport>[] = [];
  const receipts = new Map<
    string,
    { payload: string; receipt: { id: string; chargedUsd: number } }
  >();
  const server = createServer(async (req, res) => {
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.method !== "POST" || req.url !== "/track-usage")
        return reply(404, {});
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 100_000) throw new Error("Too large");
      }
      const input = UsageReport.parse(JSON.parse(body));
      if (
        input.totalTokens !==
        input.cachedInputTokens + input.uncachedInputTokens + input.outputTokens
      )
        return reply(400, {});
      const existing = receipts.get(input.id);
      if (existing)
        return reply(existing.payload === body ? 200 : 409, existing.receipt);
      const rate = ["-luna", "-mini", "-nano"].some((part) =>
        input.modelId.includes(part),
      )
        ? 0.02
        : 0.1;
      const receipt = {
        id: input.id,
        chargedUsd: (input.totalTokens * rate) / 1_000_000,
      };
      events.push(input);
      receipts.set(input.id, { payload: body, receipt });
      reply(200, receipt);
    } catch {
      reply(400, { error: "invalid_usage" });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    events,
    receipts,
    close: () => server.close(),
  };
}
