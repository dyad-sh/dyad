/**
 * Model-free wiring guard for the chat-history benchmark harness: seeding,
 * FTS indexing, tool wrappers, observation recording, and cross-app
 * fail-closed behavior. Runs in every `npm run eval` invocation (no API key
 * needed) so harness regressions surface before a paid benchmark run.
 */
import { describe, it, expect } from "vitest";
import {
  seedWorld,
  makeEvalContext,
  buildHistoryToolSet,
  newToolRun,
  type ScenarioFile,
} from "./helpers/chat_history_harness";

const mini: ScenarioFile = {
  category: "plumbing",
  domain: "test app",
  app: { key: "main", name: "plumbing-test" },
  chats: [
    {
      key: "decision",
      title: "Payment provider talk",
      days_ago: 20,
      messages: [
        { role: "user", text: "which payment provider should we use?" },
        {
          role: "assistant",
          text: "After comparing options we will integrate PayLume for checkout because their flat 4.5% fee beats the alternatives for our volume.",
        },
      ],
    },
  ],
  queries: [],
};

describe("chat-history harness plumbing", () => {
  it("seeds, indexes, searches, and reads", async () => {
    const world = await seedWorld([mini]);
    try {
      const seeded = world.categories.get("plumbing")!;
      const ctx = makeEvalContext(seeded);
      const run = newToolRun();
      const tools = buildHistoryToolSet(ctx, run);

      const searchResult = await (tools.search_chats as any).execute({
        query: "PayLume checkout fee",
      });
      const parsed = JSON.parse(searchResult);
      expect(parsed.index_status).toBe("ready");
      expect(parsed.results.length).toBeGreaterThan(0);
      const hit = parsed.results[0];
      expect(hit.title).toBe("Payment provider talk");

      const readResult = await (tools.read_chat as any).execute({
        chat_id: hit.chat_id,
        around_message_id: hit.matches[0].message_id,
      });
      const read = JSON.parse(readResult);
      expect(read.messages.some((m: any) => m.text.includes("PayLume"))).toBe(
        true,
      );

      // Observations recorded for provenance validation.
      expect(run.observations.pairs.size).toBeGreaterThan(0);
      expect(run.log.length).toBe(2);

      // Cross-app isolation: reading a chat from another app must fail closed.
      const foreign = await (tools.read_chat as any).execute({
        chat_id: 999_999,
      });
      expect(foreign).toContain("failed");

      // Noise corpus present: a generic query should hit filler chats.
      const noise = JSON.parse(
        await (tools.search_chats as any).execute({ query: "dark mode" }),
      );
      expect(noise.results.length).toBeGreaterThan(0);
    } finally {
      world.dispose();
    }
  });
});
