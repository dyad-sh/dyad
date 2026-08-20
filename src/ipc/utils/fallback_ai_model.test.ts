import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import { createFallback } from "./fallback_ai_model";

/**
 * The regression under test: call options (temperature) are resolved for the
 * PRIMARY model before the request; forwarding them verbatim to a fallback of
 * a different provider produced a hard 400 (Anthropic rejects an explicit
 * temperature for thinking models), turning a recoverable stream blip into a
 * fatal error. On any non-primary model the fallback wrapper must drop
 * `temperature` and let the provider default apply.
 */

function textStream(): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] } as any);
      controller.enqueue({ type: "text-delta", id: "1", delta: "ok" } as any);
      controller.close();
    },
  });
}

function fakeModel(params: {
  modelId: string;
  behavior: "succeed" | "reject-retryable";
  seen: LanguageModelV3CallOptions[];
}): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "fake",
    modelId: params.modelId,
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not used");
    },
    async doStream(options: LanguageModelV3CallOptions) {
      params.seen.push(options);
      if (params.behavior === "reject-retryable") {
        // Matches RETRYABLE_ERROR_PATTERNS ("service unavailable").
        throw new Error("service unavailable");
      }
      return { stream: textStream() };
    },
  } as unknown as LanguageModelV3;
}

async function drain(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // consume
  }
}

describe("fallback model call options", () => {
  it("passes temperature to the primary model untouched", async () => {
    const seen: LanguageModelV3CallOptions[] = [];
    const model = createFallback({
      models: [fakeModel({ modelId: "primary", behavior: "succeed", seen })],
    }) as unknown as LanguageModelV3;

    const result = await model.doStream({
      prompt: [],
      temperature: 1,
    } as unknown as LanguageModelV3CallOptions);
    await drain(result.stream);

    expect(seen).toHaveLength(1);
    expect(seen[0].temperature).toBe(1);
  });

  it("drops temperature when failing over to a non-primary model", async () => {
    const primarySeen: LanguageModelV3CallOptions[] = [];
    const fallbackSeen: LanguageModelV3CallOptions[] = [];
    const model = createFallback({
      models: [
        fakeModel({
          modelId: "primary",
          behavior: "reject-retryable",
          seen: primarySeen,
        }),
        fakeModel({
          modelId: "fallback",
          behavior: "succeed",
          seen: fallbackSeen,
        }),
      ],
    }) as unknown as LanguageModelV3;

    const result = await model.doStream({
      prompt: [],
      temperature: 1,
    } as unknown as LanguageModelV3CallOptions);
    await drain(result.stream);

    // Primary was tried with the caller's options...
    expect(primarySeen.length).toBeGreaterThanOrEqual(1);
    expect(primarySeen[0].temperature).toBe(1);
    // ...the fallback's provider default must apply instead.
    expect(fallbackSeen).toHaveLength(1);
    expect(fallbackSeen[0].temperature).toBeUndefined();
    // Everything else survives the strip.
    expect(fallbackSeen[0].prompt).toEqual([]);
  });

  it("drops temperature on a sticky non-primary index without a same-request failover", async () => {
    // After a failover the index stays on the fallback for modelResetInterval;
    // a FRESH request's first call then already targets the fallback while its
    // options were still computed for the primary selection.
    const primarySeen: LanguageModelV3CallOptions[] = [];
    const fallbackSeen: LanguageModelV3CallOptions[] = [];
    const model = createFallback({
      models: [
        fakeModel({
          modelId: "primary",
          behavior: "reject-retryable",
          seen: primarySeen,
        }),
        fakeModel({
          modelId: "fallback",
          behavior: "succeed",
          seen: fallbackSeen,
        }),
      ],
    }) as unknown as LanguageModelV3;

    // First request fails over primary -> fallback.
    const first = await model.doStream({
      prompt: [],
      temperature: 1,
    } as unknown as LanguageModelV3CallOptions);
    await drain(first.stream);

    // Second request starts on the sticky fallback index.
    const second = await model.doStream({
      prompt: [],
      temperature: 1,
    } as unknown as LanguageModelV3CallOptions);
    await drain(second.stream);

    expect(fallbackSeen).toHaveLength(2);
    expect(fallbackSeen[1].temperature).toBeUndefined();
    // The primary saw only the first request's attempt.
    expect(primarySeen.every((o) => o.temperature === 1)).toBe(true);
  });
});
