import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFallback,
  formatFallbackErrorForLog,
  getFallbackFailureAction,
  getFallbackRetryDelayMs,
} from "./fallback_ai_model";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logMocks = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: logMocks.warn,
      error: logMocks.error,
    }),
  },
}));

/**
 * The regression under test: call options (temperature) are resolved for the
 * PRIMARY model before the request; forwarding them verbatim to a fallback of
 * a different provider produced a hard 400 (Anthropic rejects an explicit
 * temperature for thinking models), turning a recoverable stream blip into a
 * fatal error. On any non-primary model the fallback wrapper must drop
 * `temperature` and let the provider default apply.
 */

function textStream(): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] } as any);
      controller.enqueue({ type: "text-delta", id: "1", delta: "ok" } as any);
      controller.close();
    },
  });
}

function errorStream(
  error: unknown,
): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.error(error);
    },
  });
}

function apiCallError(params: {
  message: string;
  statusCode?: number;
  isRetryable: boolean;
  responseHeaders?: Record<string, string>;
}): APICallError {
  return new APICallError({
    ...params,
    url: "https://engine.dyad.sh/v1/responses",
    requestBodyValues: {},
  });
}

type ModelOutcome =
  | { type: "succeed" }
  | { type: "throw"; error: unknown }
  | { type: "stream-error"; error: unknown }
  | { type: "metadata-stream-error"; error: unknown }
  | { type: "partial-stream-error"; error: unknown }
  | { type: "stream-error-event"; error: unknown };

function sequencedModel(params: {
  modelId: string;
  outcomes: ModelOutcome[];
  calls: string[];
}): LanguageModelV4 {
  let callIndex = 0;
  return {
    specificationVersion: "v4",
    provider: "fake",
    modelId: params.modelId,
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not used");
    },
    async doStream() {
      params.calls.push(params.modelId);
      const outcome = params.outcomes[callIndex++] ?? { type: "succeed" };
      if (outcome.type === "throw") throw outcome.error;
      if (outcome.type === "stream-error") {
        return { stream: errorStream(outcome.error) };
      }
      if (outcome.type === "metadata-stream-error") {
        let emittedMetadata = false;
        return {
          stream: new ReadableStream({
            pull(controller) {
              if (emittedMetadata) {
                controller.error(outcome.error);
              } else {
                emittedMetadata = true;
                controller.enqueue({
                  type: "response-metadata",
                  id: "provider-response-1",
                } as LanguageModelV4StreamPart);
              }
            },
          }),
        };
      }
      if (outcome.type === "partial-stream-error") {
        let emittedContent = false;
        return {
          stream: new ReadableStream({
            pull(controller) {
              if (emittedContent) {
                controller.error(outcome.error);
              } else {
                emittedContent = true;
                controller.enqueue({
                  type: "text-delta",
                  id: "1",
                  delta: "partial",
                } as LanguageModelV4StreamPart);
              }
            },
          }),
        };
      }
      if (outcome.type === "stream-error-event") {
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: "error",
                error: outcome.error,
              } as LanguageModelV4StreamPart);
              controller.close();
            },
          }),
        };
      }
      return { stream: textStream() };
    },
  } as unknown as LanguageModelV4;
}

function fakeModel(params: {
  modelId: string;
  provider?: string;
  behavior: "succeed" | "reject-retryable";
  seen: LanguageModelV4CallOptions[];
}): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: params.provider ?? "fake",
    modelId: params.modelId,
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not used");
    },
    async doStream(options: LanguageModelV4CallOptions) {
      params.seen.push(options);
      if (params.behavior === "reject-retryable") {
        // Matches RETRYABLE_ERROR_PATTERNS ("service unavailable").
        throw new Error("service unavailable");
      }
      return { stream: textStream() };
    },
  } as unknown as LanguageModelV4;
}

async function drain(stream: ReadableStream<LanguageModelV4StreamPart>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // consume
  }
}

describe("fallback failure policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies explicit SDK and provider failures into three actions", () => {
    expect(
      getFallbackFailureAction(
        apiCallError({
          message: "Cannot connect to API: socket hang up",
          isRetryable: true,
        }),
      ),
    ).toBe("retry-same");
    expect(
      getFallbackFailureAction(
        apiCallError({
          message: "model not found",
          statusCode: 404,
          isRetryable: true,
        }),
      ),
    ).toBe("fallback-next");
    expect(
      getFallbackFailureAction(
        apiCallError({
          message: "model_not_found in this region",
          statusCode: 403,
          isRetryable: false,
        }),
      ),
    ).toBe("fallback-next");
    expect(
      getFallbackFailureAction(
        apiCallError({
          message: "unexpected invalid temperature",
          statusCode: 400,
          isRetryable: false,
        }),
      ),
    ).toBe("fail");
    expect(getFallbackFailureAction(new Error("unexpected local error"))).toBe(
      "fail",
    );
    expect(
      getFallbackFailureAction({
        status: 400,
        message: "timeout must be less than 60 seconds",
      }),
    ).toBe("fail");
  });

  it("derives a bounded retry delay from provider headers", () => {
    expect(
      getFallbackRetryDelayMs(
        apiCallError({
          message: "rate limited",
          statusCode: 429,
          isRetryable: true,
          responseHeaders: { "Retry-After": "2" },
        }),
        1,
      ),
    ).toBe(2_000);
    expect(
      getFallbackRetryDelayMs(
        apiCallError({
          message: "service unavailable",
          statusCode: 503,
          isRetryable: true,
          responseHeaders: { "x-ratelimit-reset": "30" },
        }),
        1,
      ),
    ).toBe(10_000);
    expect(
      getFallbackRetryDelayMs(
        apiCallError({
          message: "retry immediately",
          statusCode: 429,
          isRetryable: true,
          responseHeaders: { "retry-after": "0" },
        }),
        1,
      ),
    ).toBe(0);
    expect(
      getFallbackRetryDelayMs(
        apiCallError({
          message: "retry after past date",
          statusCode: 503,
          isRetryable: true,
          responseHeaders: {
            "retry-after": "Wed, 21 Oct 2015 07:28:00 GMT",
          },
        }),
        1,
        Date.UTC(2026, 7, 27),
      ),
    ).toBe(0);
  });

  it("stops immediately when the request is aborted during backoff", async () => {
    const calls: string[] = [];
    const abortController = new AbortController();
    const transientError = apiCallError({
      message: "rate limited",
      statusCode: 429,
      isRetryable: true,
      responseHeaders: { "retry-after": "10" },
    });
    const model = createFallback({
      models: [
        sequencedModel({
          modelId: "gpt-5.6-sol",
          outcomes: [{ type: "throw", error: transientError }],
          calls,
        }),
      ],
    }) as unknown as LanguageModelV4;

    const streamPromise = model.doStream({
      prompt: [],
      abortSignal: abortController.signal,
    } as unknown as LanguageModelV4CallOptions);
    await vi.waitFor(() => expect(calls).toEqual(["gpt-5.6-sol"]));
    abortController.abort();

    await expect(streamPromise).rejects.toBe(abortController.signal.reason);
    expect(calls).toEqual(["gpt-5.6-sol"]);
  });

  it("retries a transient failure on the same model", async () => {
    const calls: string[] = [];
    const transientError = apiCallError({
      message: "Cannot connect to API: socket hang up",
      isRetryable: true,
    });
    const model = createFallback({
      models: [
        sequencedModel({
          modelId: "gpt-5.6-sol",
          outcomes: [
            { type: "throw", error: transientError },
            { type: "succeed" },
          ],
          calls,
        }),
        sequencedModel({
          modelId: "anthropic/claude-opus-5",
          outcomes: [{ type: "succeed" }],
          calls,
        }),
      ],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
      headers: { "x-dyad-internal-request-id": "request-123" },
    } as unknown as LanguageModelV4CallOptions);
    await drain(result.stream);

    expect(calls).toEqual(["gpt-5.6-sol", "gpt-5.6-sol"]);
    expect(logMocks.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Retrying model gpt-5.6-sol (requestId=request-123, stage=initial-request",
      ),
    );
  });

  it("falls back after the same-model transient retry is exhausted", async () => {
    const calls: string[] = [];
    const transientError = apiCallError({
      message: "service unavailable",
      statusCode: 503,
      isRetryable: true,
    });
    const model = createFallback({
      models: [
        sequencedModel({
          modelId: "gpt-5.6-sol",
          outcomes: [
            { type: "throw", error: transientError },
            { type: "throw", error: transientError },
          ],
          calls,
        }),
        sequencedModel({
          modelId: "anthropic/claude-opus-5",
          outcomes: [{ type: "succeed" }],
          calls,
        }),
      ],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
    } as unknown as LanguageModelV4CallOptions);
    await drain(result.stream);

    expect(calls).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-sol",
      "anthropic/claude-opus-5",
    ]);
    expect(logMocks.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Falling back from model gpt-5.6-sol to anthropic/claude-opus-5",
      ),
    );
  });

  it("falls back immediately for a permanent model-specific failure", async () => {
    const calls: string[] = [];
    const model = createFallback({
      models: [
        sequencedModel({
          modelId: "gpt-5.6-sol",
          outcomes: [
            {
              type: "throw",
              error: apiCallError({
                message: "model not found",
                statusCode: 404,
                isRetryable: false,
              }),
            },
          ],
          calls,
        }),
        sequencedModel({
          modelId: "anthropic/claude-opus-5",
          outcomes: [{ type: "succeed" }],
          calls,
        }),
      ],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
    } as unknown as LanguageModelV4CallOptions);
    await drain(result.stream);

    expect(calls).toEqual(["gpt-5.6-sol", "anthropic/claude-opus-5"]);
  });

  it("does not retry or fall back for a deterministic request error", async () => {
    const calls: string[] = [];
    const requestError = apiCallError({
      message: "temperature is invalid",
      statusCode: 400,
      isRetryable: false,
    });
    const model = createFallback({
      models: [
        sequencedModel({
          modelId: "gpt-5.6-sol",
          outcomes: [{ type: "throw", error: requestError }],
          calls,
        }),
        sequencedModel({
          modelId: "anthropic/claude-opus-5",
          outcomes: [{ type: "succeed" }],
          calls,
        }),
      ],
    }) as unknown as LanguageModelV4;

    await expect(
      model.doStream({ prompt: [] } as unknown as LanguageModelV4CallOptions),
    ).rejects.toBe(requestError);
    expect(calls).toEqual(["gpt-5.6-sol"]);
    expect(logMocks.warn).toHaveBeenCalledWith(
      expect.stringContaining("not retrying or falling back"),
    );
  });

  it("applies the same retry policy to mid-stream failures", async () => {
    const calls: string[] = [];
    const transientError = apiCallError({
      message: "stream connection reset",
      isRetryable: true,
    });
    const model = createFallback({
      models: [
        sequencedModel({
          modelId: "gpt-5.6-sol",
          outcomes: [
            { type: "stream-error", error: transientError },
            { type: "succeed" },
          ],
          calls,
        }),
        sequencedModel({
          modelId: "anthropic/claude-opus-5",
          outcomes: [{ type: "succeed" }],
          calls,
        }),
      ],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
      headers: { "x-dyad-internal-request-id": "request-stream" },
    } as unknown as LanguageModelV4CallOptions);
    await drain(result.stream);

    expect(calls).toEqual(["gpt-5.6-sol", "gpt-5.6-sol"]);
    expect(logMocks.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Retrying model gpt-5.6-sol (requestId=request-stream, stage=stream",
      ),
    );
  });

  it("stops a mid-stream retry when the request is aborted during backoff", async () => {
    const calls: string[] = [];
    const abortController = new AbortController();
    const transientError = apiCallError({
      message: "rate limited while streaming",
      statusCode: 429,
      isRetryable: true,
      responseHeaders: { "retry-after": "10" },
    });
    const model = createFallback({
      models: [
        sequencedModel({
          modelId: "gpt-5.6-sol",
          outcomes: [{ type: "stream-error", error: transientError }],
          calls,
        }),
      ],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
      abortSignal: abortController.signal,
    } as unknown as LanguageModelV4CallOptions);
    const drainPromise = drain(result.stream);
    await vi.waitFor(() =>
      expect(logMocks.warn).toHaveBeenCalledWith(
        expect.stringContaining("stage=stream"),
      ),
    );
    abortController.abort();

    await expect(drainPromise).rejects.toBe(abortController.signal.reason);
    expect(calls).toEqual(["gpt-5.6-sol"]);
  });

  it("recovers when only response metadata was emitted before a stream error", async () => {
    const calls: string[] = [];
    const transientError = apiCallError({
      message: "stream connection reset",
      isRetryable: true,
    });
    const model = createFallback({
      models: [
        sequencedModel({
          modelId: "gpt-5.6-sol",
          outcomes: [
            { type: "metadata-stream-error", error: transientError },
            { type: "succeed" },
          ],
          calls,
        }),
      ],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
    } as unknown as LanguageModelV4CallOptions);
    await drain(result.stream);

    expect(calls).toEqual(["gpt-5.6-sol", "gpt-5.6-sol"]);
  });

  it("passes through deterministic stream error events without falling back", async () => {
    const calls: string[] = [];
    const requestError = apiCallError({
      message: "invalid tool transcript",
      statusCode: 400,
      isRetryable: false,
    });
    const model = createFallback({
      models: [
        sequencedModel({
          modelId: "gpt-5.6-sol",
          outcomes: [{ type: "stream-error-event", error: requestError }],
          calls,
        }),
        sequencedModel({
          modelId: "anthropic/claude-opus-5",
          outcomes: [{ type: "succeed" }],
          calls,
        }),
      ],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
    } as unknown as LanguageModelV4CallOptions);
    await drain(result.stream);

    expect(calls).toEqual(["gpt-5.6-sol"]);
    expect(logMocks.warn).toHaveBeenCalledWith(
      expect.stringContaining("Stream error event from model gpt-5.6-sol"),
    );
  });

  it("does not retry after content has already been emitted", async () => {
    const calls: string[] = [];
    const transientError = apiCallError({
      message: "stream connection reset",
      isRetryable: true,
    });
    const model = createFallback({
      models: [
        sequencedModel({
          modelId: "gpt-5.6-sol",
          outcomes: [{ type: "partial-stream-error", error: transientError }],
          calls,
        }),
        sequencedModel({
          modelId: "anthropic/claude-opus-5",
          outcomes: [{ type: "succeed" }],
          calls,
        }),
      ],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
    } as unknown as LanguageModelV4CallOptions);
    await expect(drain(result.stream)).rejects.toBe(transientError);
    expect(calls).toEqual(["gpt-5.6-sol"]);
  });

  it("preserves an undefined stream failure without treating it as a sentinel", async () => {
    const calls: string[] = [];
    const model = createFallback({
      models: [
        sequencedModel({
          modelId: "gpt-5.6-sol",
          outcomes: [{ type: "stream-error", error: undefined }],
          calls,
        }),
      ],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
    } as unknown as LanguageModelV4CallOptions);
    let rejection: unknown = Symbol("not rejected");
    try {
      await drain(result.stream);
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeUndefined();
    expect(calls).toEqual(["gpt-5.6-sol"]);
  });

  it("classifies exhausted provider failures as external Dyad errors", async () => {
    const calls: string[] = [];
    const transientError = apiCallError({
      message: "service unavailable",
      statusCode: 503,
      isRetryable: true,
    });
    const model = createFallback({
      models: [
        sequencedModel({
          modelId: "gpt-5.6-sol",
          outcomes: [
            { type: "throw", error: transientError },
            { type: "throw", error: transientError },
          ],
          calls,
        }),
      ],
    }) as unknown as LanguageModelV4;

    await expect(
      model.doStream({ prompt: [] } as unknown as LanguageModelV4CallOptions),
    ).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.External,
    } satisfies Partial<DyadError>);
  });

  it("formats diagnostics without serializing request bodies or headers", () => {
    expect(
      formatFallbackErrorForLog({
        status: 503,
        request_id: "provider-request-456",
        message: "Gateway\n unavailable",
        cause: { code: "ECONNRESET", message: "socket hang up" },
        requestBody: "sensitive prompt",
        headers: { authorization: "secret-token" },
      }),
    ).toBe(
      "status=503 providerRequestId=provider-request-456 code=ECONNRESET message=Gateway unavailable cause=socket hang up",
    );
  });
});

describe("fallback model call options", () => {
  it("passes temperature to the primary model untouched", async () => {
    const seen: LanguageModelV4CallOptions[] = [];
    const model = createFallback({
      models: [fakeModel({ modelId: "primary", behavior: "succeed", seen })],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
      temperature: 1,
    } as unknown as LanguageModelV4CallOptions);
    await drain(result.stream);

    expect(seen).toHaveLength(1);
    expect(seen[0].temperature).toBe(1);
  });

  it("drops temperature when failing over to a non-primary model", async () => {
    const primarySeen: LanguageModelV4CallOptions[] = [];
    const fallbackSeen: LanguageModelV4CallOptions[] = [];
    const model = createFallback({
      models: [
        fakeModel({
          modelId: "primary",
          provider: "primary-provider",
          behavior: "reject-retryable",
          seen: primarySeen,
        }),
        fakeModel({
          modelId: "fallback",
          provider: "fallback-provider",
          behavior: "succeed",
          seen: fallbackSeen,
        }),
      ],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
      temperature: 1,
    } as unknown as LanguageModelV4CallOptions);
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

  it("keeps model-derived options on a same-provider fallback without overrides", async () => {
    const fallbackSeen: LanguageModelV4CallOptions[] = [];
    const model = createFallback({
      models: [
        fakeModel({
          modelId: "primary",
          provider: "openrouter",
          behavior: "reject-retryable",
          seen: [],
        }),
        fakeModel({
          modelId: "fallback",
          provider: "openrouter",
          behavior: "succeed",
          seen: fallbackSeen,
        }),
      ],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
      temperature: 0,
      maxOutputTokens: 32_000,
    } as unknown as LanguageModelV4CallOptions);
    await drain(result.stream);

    expect(fallbackSeen[0]).toMatchObject({
      temperature: 0,
      maxOutputTokens: 32_000,
    });
  });

  it("applies the primary chain entry's own options", async () => {
    const primarySeen: LanguageModelV4CallOptions[] = [];
    const model = createFallback({
      models: [
        fakeModel({
          modelId: "resolved-primary",
          behavior: "succeed",
          seen: primarySeen,
        }),
      ],
      modelCallOptions: [{ temperature: 1, maxOutputTokens: 64_000 }],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
      temperature: 0,
      maxOutputTokens: 32_000,
    } as unknown as LanguageModelV4CallOptions);
    await drain(result.stream);

    expect(primarySeen[0]).toMatchObject({
      temperature: 1,
      maxOutputTokens: 64_000,
    });
  });

  it("applies a fallback model's own call options as if it were primary", async () => {
    const primarySeen: LanguageModelV4CallOptions[] = [];
    const fallbackSeen: LanguageModelV4CallOptions[] = [];
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
      modelCallOptions: [
        undefined, // primary always gets the caller's options
        {
          temperature: 1,
          maxOutputTokens: 32_000,
          providerOptions: {
            anthropic: { thinking: { type: "adaptive" } },
          },
        },
      ],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
      temperature: 0.2,
      maxOutputTokens: 128_000,
      providerOptions: {
        "dyad-engine": { dyadRequestId: "req-1" },
        openai: { reasoningEffort: "medium" },
      },
    } as unknown as LanguageModelV4CallOptions);
    await drain(result.stream);

    expect(fallbackSeen).toHaveLength(1);
    const seen = fallbackSeen[0];
    // The model-derived subset is the fallback's own...
    expect(seen.temperature).toBe(1);
    expect(seen.maxOutputTokens).toBe(32_000);
    expect((seen.providerOptions as any).anthropic).toEqual({
      thinking: { type: "adaptive" },
    });
    // ...request-scoped options pass through untouched.
    expect((seen.providerOptions as any)["dyad-engine"]).toEqual({
      dyadRequestId: "req-1",
    });
    expect(seen.prompt).toEqual([]);
  });

  it("unsets scalar options when the fallback's own options have none", async () => {
    const fallbackSeen: LanguageModelV4CallOptions[] = [];
    const model = createFallback({
      models: [
        fakeModel({
          modelId: "primary",
          behavior: "reject-retryable",
          seen: [],
        }),
        fakeModel({
          modelId: "fallback",
          behavior: "succeed",
          seen: fallbackSeen,
        }),
      ],
      modelCallOptions: [
        undefined,
        // catalog had no temperature/cap for this model: undefined means
        // "unset", never "inherit the primary's"
        { providerOptions: { anthropic: { thinking: { type: "adaptive" } } } },
      ],
    }) as unknown as LanguageModelV4;

    const result = await model.doStream({
      prompt: [],
      temperature: 0.2,
      maxOutputTokens: 128_000,
    } as unknown as LanguageModelV4CallOptions);
    await drain(result.stream);

    expect(fallbackSeen).toHaveLength(1);
    expect(fallbackSeen[0].temperature).toBeUndefined();
    expect(fallbackSeen[0].maxOutputTokens).toBeUndefined();
  });

  it("drops temperature on a sticky non-primary index without a same-request failover", async () => {
    // After a failover the index stays on the fallback for modelResetInterval;
    // a FRESH request's first call then already targets the fallback while its
    // options were still computed for the primary selection.
    const primarySeen: LanguageModelV4CallOptions[] = [];
    const fallbackSeen: LanguageModelV4CallOptions[] = [];
    const model = createFallback({
      models: [
        fakeModel({
          modelId: "primary",
          provider: "primary-provider",
          behavior: "reject-retryable",
          seen: primarySeen,
        }),
        fakeModel({
          modelId: "fallback",
          provider: "fallback-provider",
          behavior: "succeed",
          seen: fallbackSeen,
        }),
      ],
    }) as unknown as LanguageModelV4;

    // First request fails over primary -> fallback.
    const first = await model.doStream({
      prompt: [],
      temperature: 1,
    } as unknown as LanguageModelV4CallOptions);
    await drain(first.stream);

    // Second request starts on the sticky fallback index.
    const second = await model.doStream({
      prompt: [],
      temperature: 1,
    } as unknown as LanguageModelV4CallOptions);
    await drain(second.stream);

    expect(fallbackSeen).toHaveLength(2);
    expect(fallbackSeen[1].temperature).toBeUndefined();
    // The primary saw only the first request's attempt.
    expect(primarySeen.every((o) => o.temperature === 1)).toBe(true);
  });
});
