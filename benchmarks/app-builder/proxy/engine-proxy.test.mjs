import assert from "node:assert/strict";
import {
  extractUsage,
  priceOf,
  normalizeRecordedUsage,
  createUsageCollector,
} from "./accounting.mjs";
import { test } from "node:test";
const sse = (events) =>
  events.map((e) => "data: " + JSON.stringify(e)).join("\n\n");
test("Anthropic cache counts survive engine message_stop summary", () => {
  const u = extractUsage(
    sse([
      {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 4,
            cache_read_input_tokens: 12000,
            cache_creation_input_tokens: 3000,
            output_tokens: 1,
          },
        },
      },
      { type: "message_delta", usage: { output_tokens: 500 } },
      { type: "message_stop", usage: { input_tokens: 4, output_tokens: 500 } },
    ]),
  );
  assert.equal(u.promptTokens, 15004);
  assert.equal(u.cachedTokens, 12000);
  assert.equal(u.cacheWriteTokens, 3000);
  assert.equal(u.completionTokens, 500);
  assert.equal(u.totalTokens, 15504);
});
test("OpenAI Responses usage remains supported", () => {
  const u = extractUsage(
    sse([
      {
        type: "response.completed",
        response: {
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            input_tokens_details: { cached_tokens: 80 },
          },
        },
      },
    ]),
  );
  assert.equal(u.promptTokens, 100);
  assert.equal(u.cachedTokens, 80);
  assert.equal(u.completionTokens, 20);
});
test("OpenAI Responses preserves cache-write tokens separately from cache reads", () => {
  const u = extractUsage(
    sse([
      {
        type: "response.completed",
        response: {
          usage: {
            input_tokens: 1000,
            output_tokens: 20,
            input_tokens_details: {
              cached_tokens: 600,
              cache_write_tokens: 300,
            },
          },
        },
      },
    ]),
  );
  assert.equal(u.promptTokens, 1000);
  assert.equal(u.cachedTokens, 600);
  assert.equal(u.cacheWriteTokens, 300);
});
test("cache writes use the long-context tier rate", () => {
  const pricing = {
    models: {
      "test-model": {
        input: 2,
        cachedInput: 0.1,
        cacheWrite: 2.5,
        output: 10,
        tiers: {
          threshold: 272000,
          input: 4,
          cachedInput: 0.2,
          cacheWrite: 5,
          output: 15,
        },
      },
    },
  };
  assert.equal(
    priceOf(
      "test-model",
      {
        promptTokens: 300000,
        cachedTokens: 100000,
        cacheWriteTokens: 100000,
        completionTokens: 1000,
      },
      pricing,
    ),
    0.935,
  );
});
test("chat-completions cache alias does not turn total prompt tokens into Anthropic uncached input", () => {
  const raw = {
    prompt_tokens: 1000,
    completion_tokens: 100,
    prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
    cache_read_input_tokens: 800,
  };
  const u = normalizeRecordedUsage({ raw });
  assert.equal(u.promptTokens, 1000);
  assert.equal(u.cachedTokens, 800);
  assert.equal(u.cacheWriteTokens, 100);
  assert.equal(u.completionTokens, 100);
});
test("usage collector survives >1MB between Anthropic start and delta and arbitrary chunk boundaries", () => {
  const events = sse([
    {
      type: "message_start",
      message: {
        usage: {
          input_tokens: 5,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 50,
        },
      },
    },
    { type: "content_block_delta", delta: { text: "x".repeat(1100000) } },
    { type: "message_delta", usage: { output_tokens: 20 } },
    { type: "message_stop", usage: { input_tokens: 5, output_tokens: 20 } },
  ]);
  const c = createUsageCollector();
  for (let i = 0; i < events.length; i += 997) c.push(events.slice(i, i + 997));
  const u = c.finish();
  assert.equal(u.promptTokens, 155);
  assert.equal(u.cacheWriteTokens, 50);
  assert.equal(u.completionTokens, 20);
});
test("collector accepts formatted nonstreaming JSON", () => {
  const c = createUsageCollector();
  c.push(
    JSON.stringify(
      { usage: { prompt_tokens: 100, completion_tokens: 20 } },
      null,
      2,
    ),
  );
  assert.equal(c.finish().promptTokens, 100);
});
test("longest model pin wins and unknown prices remain unknown", () => {
  const p = {
    models: {
      model: { input: 100, cachedInput: 10, output: 100 },
      "model-flash": { input: 1, cachedInput: 0.1, output: 2 },
    },
  };
  assert.equal(
    priceOf(
      "provider/model-flash",
      { promptTokens: 1000000, completionTokens: 1000000 },
      p,
    ),
    3,
  );
  assert.equal(priceOf("unknown", { promptTokens: 10 }, p), null);
});
test("nonstreaming Anthropic includes cached and written input in prompt total", () => {
  const u = extractUsage(
    JSON.stringify({
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 40,
        output_tokens: 20,
      },
    }),
  );
  assert.equal(u.promptTokens, 100);
  assert.equal(u.cacheWriteTokens, 40);
  assert.equal(u.totalTokens, 120);
});
test("missing or inconsistent usage is never priced as zero", () => {
  const pricing = {
    models: { model: { input: 1, cachedInput: 0.1, output: 2 } },
  };
  assert.equal(
    priceOf("model", { promptTokens: null, completionTokens: 20 }, pricing),
    null,
  );
  assert.equal(
    priceOf(
      "model",
      { promptTokens: 10, completionTokens: 20, cachedTokens: 15 },
      pricing,
    ),
    null,
  );
  assert.equal(
    extractUsage(
      JSON.stringify({ type: "message_delta", usage: { output_tokens: 12 } }),
    ),
    null,
  );
});
