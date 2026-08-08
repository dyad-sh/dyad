import { describe, expect, it, vi } from "vitest";

import {
  newCorrelationId,
  PipelineEventBus,
  ProgressSampler,
  REDACTED,
  sanitiseMetadata,
  sanitiseUrl,
  sanitiseValue,
  WITHHELD,
} from "@/ipc/utils/pipeline_events";

describe("sanitising secrets", () => {
  it("redacts a credential nested inside a request", () => {
    // The realistic shape: the key is two levels down, in a header.
    const cleaned = sanitiseMetadata({
      request: {
        url: "http://127.0.0.1:11434/api/embed",
        headers: { Authorization: "Bearer sk-live-abcdef123456" },
      },
    }) as any;
    expect(cleaned.request.headers.Authorization).toBe(REDACTED);
    expect(JSON.stringify(cleaned)).not.toContain("sk-live-abcdef123456");
  });

  it("catches every spelling of a key name", () => {
    const cleaned = sanitiseMetadata({
      apiKey: "a",
      api_key: "b",
      "API-KEY": "c",
      accessToken: "d",
      refresh_token: "e",
      password: "f",
      Cookie: "g",
      sessionId: "h",
      credential: "i",
    }) as Record<string, unknown>;
    for (const value of Object.values(cleaned)) {
      expect(value).toBe(REDACTED);
    }
  });

  it("strips a key out of a URL query string", () => {
    const cleaned = sanitiseUrl(
      "https://api.example.com/v1/embed?api_key=sk-secret-value&model=nomic",
    );
    expect(cleaned).not.toContain("sk-secret-value");
    expect(cleaned).toContain("model=nomic");
  });

  it("strips credentials from a URL's userinfo", () => {
    const cleaned = sanitiseUrl("http://user:hunter2@localhost:11434/api");
    expect(cleaned).not.toContain("hunter2");
  });

  it("masks a long token in a non-URL string", () => {
    expect(sanitiseUrl("Bearer abcdefghijklmnopqrstuvwxyz123456")).toContain(
      REDACTED,
    );
  });

  it("keeps ordinary diagnostic values readable", () => {
    const cleaned = sanitiseMetadata({
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 768,
      durationMs: 42,
      results: 12,
    }) as Record<string, unknown>;
    expect(cleaned).toEqual({
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 768,
      durationMs: 42,
      results: 12,
    });
  });
});

describe("withholding prompts and reasoning", () => {
  it("never shows the system prompt", () => {
    const cleaned = sanitiseMetadata({
      systemPrompt: "You are the Chat Agent for Meta Human OS…",
    }) as any;
    expect(cleaned.systemPrompt).toBe(WITHHELD);
  });

  it("never shows developer instructions or reasoning", () => {
    const cleaned = sanitiseMetadata({
      developer_prompt: "internal",
      chainOfThought: "step 1…",
      reasoning: "because…",
      thinking: "hmm",
    }) as Record<string, unknown>;
    for (const value of Object.values(cleaned)) {
      expect(value).toBe(WITHHELD);
    }
  });

  it("never shows raw retrieved memory content", () => {
    // Source paths are useful; the private contents are not the viewer's job.
    const cleaned = sanitiseMetadata({
      sourcePaths: ["Memory/Projects/App.md"],
      memoryContent: "The user's private note",
    }) as any;
    expect(cleaned.memoryContent).toBe(WITHHELD);
    expect(cleaned.sourcePaths).toEqual(["Memory/Projects/App.md"]);
  });
});

describe("bounding output", () => {
  it("truncates a long string rather than dumping a prompt", () => {
    const cleaned = sanitiseValue("x".repeat(5_000)) as string;
    expect(cleaned.length).toBeLessThan(400);
    expect(cleaned).toContain("5000 chars");
  });

  it("summarises a long array", () => {
    const cleaned = sanitiseValue(
      Array.from({ length: 100 }, (_, i) => i),
    ) as unknown[];
    expect(cleaned.length).toBeLessThanOrEqual(21);
    expect(String(cleaned.at(-1))).toContain("more");
  });

  it("stops at a sane depth", () => {
    let nested: any = "deep";
    for (let i = 0; i < 30; i += 1) nested = { nested };
    expect(JSON.stringify(sanitiseValue(nested))).toContain("truncated");
  });
});

describe("PipelineEventBus", () => {
  const base = {
    category: "chat" as const,
    operation: "stream",
    status: "started" as const,
  };

  it("stamps an id and timestamp", () => {
    const bus = new PipelineEventBus();
    const event = bus.emit(base);
    expect(event.id).toBeTruthy();
    expect(Date.parse(event.timestamp)).not.toBeNaN();
  });

  it("sanitises on the only path that creates an event", () => {
    // There is deliberately no way to add an unsanitised event.
    const bus = new PipelineEventBus();
    const event = bus.emit({
      ...base,
      metadata: { headers: { authorization: "Bearer sk-123456789012345" } },
    });
    expect(JSON.stringify(event)).not.toContain("sk-123456789012345");
  });

  it("keeps events in order", () => {
    const bus = new PipelineEventBus();
    for (const operation of ["save", "retrieve", "stream"]) {
      bus.emit({ ...base, operation });
    }
    expect(bus.recent().map((e) => e.operation)).toEqual([
      "save",
      "retrieve",
      "stream",
    ]);
  });

  it("bounds the buffer so a long session cannot grow without limit", () => {
    const bus = new PipelineEventBus(10);
    for (let index = 0; index < 100; index += 1) {
      bus.emit({ ...base, operation: `op-${index}` });
    }
    expect(bus.size).toBe(10);
    // The newest are the ones kept.
    expect(bus.recent().at(-1)!.operation).toBe("op-99");
  });

  it("groups a whole interaction under one correlation id", () => {
    const bus = new PipelineEventBus();
    const correlationId = newCorrelationId();
    for (const [category, operation] of [
      ["files", "save-conversation"],
      ["memory", "recall"],
      ["embedding", "embed-query"],
      ["qdrant", "search"],
      ["chat", "stream"],
      ["jobs", "enqueue"],
    ] as const) {
      bus.emit({ category, operation, status: "completed", correlationId });
    }
    bus.emit({ ...base, correlationId: "other" });

    const chain = bus.byCorrelation(correlationId);
    expect(chain).toHaveLength(6);
    expect(chain.map((e) => e.operation)).toEqual([
      "save-conversation",
      "recall",
      "embed-query",
      "search",
      "stream",
      "enqueue",
    ]);
  });

  it("delivers to subscribers", () => {
    const bus = new PipelineEventBus();
    const seen: string[] = [];
    bus.subscribe((event) => seen.push(event.operation));
    bus.emit({ ...base, operation: "one" });
    expect(seen).toEqual(["one"]);
  });

  it("disposes a listener when unsubscribed", () => {
    const bus = new PipelineEventBus();
    const listener = vi.fn();
    const dispose = bus.subscribe(listener);
    bus.emit(base);
    dispose();
    bus.emit(base);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount).toBe(0);
  });

  it("survives a listener that throws", () => {
    // A broken viewer must never break the pipeline it is watching.
    const bus = new PipelineEventBus();
    bus.subscribe(() => {
      throw new Error("viewer exploded");
    });
    const good = vi.fn();
    bus.subscribe(good);

    expect(() => bus.emit(base)).not.toThrow();
    expect(good).toHaveBeenCalled();
  });

  it("clears the view without touching anything durable", () => {
    const bus = new PipelineEventBus();
    bus.emit(base);
    bus.clear();
    expect(bus.size).toBe(0);
  });
});

describe("ProgressSampler", () => {
  it("emits at most once per interval", () => {
    // One event per token would flood the bus and slow what it watches.
    const sampler = new ProgressSampler(250);
    expect(sampler.shouldEmit(1_000)).toBe(true);
    expect(sampler.shouldEmit(1_100)).toBe(false);
    expect(sampler.shouldEmit(1_200)).toBe(false);
    expect(sampler.shouldEmit(1_300)).toBe(true);
  });
});
