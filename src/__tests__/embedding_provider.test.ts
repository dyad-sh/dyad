import { describe, expect, it, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: vi.fn(), log: vi.fn(), error: vi.fn() }) },
}));

const {
  batches,
  candidateEndpoints,
  DEFAULT_EMBEDDING_CONFIG,
  detectEmbedder,
  embedTexts,
  embeddingVersion,
  hashContent,
  isLoopback,
  LEXICAL_EMBEDDER,
  lexicalEmbed,
  vectorIdentity,
} = await import("@/ipc/utils/embedding_provider");

/** A stand-in provider, so no test needs a live model server. */
function fakeServer(options: {
  shape: "ollama" | "openai";
  dimensions?: number;
  failTimes?: number;
  vectorFor?: (text: string) => number[];
}) {
  const dimensions = options.dimensions ?? 768;
  let failuresLeft = options.failTimes ?? 0;
  const calls: { url: string; body: any }[] = [];

  const fetcher = (async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body });

    if (failuresLeft > 0) {
      failuresLeft -= 1;
      return { ok: false, status: 503, json: async () => ({}) } as any;
    }

    const inputs: string[] = Array.isArray(body.input)
      ? body.input
      : [body.input];
    const vectors = inputs.map(
      (text) =>
        options.vectorFor?.(text) ??
        Array.from({ length: dimensions }, (_, i) => (i % 7) / 7),
    );

    const isOllama = String(url).includes("/api/embed");
    if (options.shape === "ollama" && !isOllama) {
      return { ok: false, status: 404, json: async () => ({}) } as any;
    }
    if (options.shape === "openai" && isOllama) {
      return { ok: false, status: 404, json: async () => ({}) } as any;
    }

    return {
      ok: true,
      status: 200,
      json: async () =>
        isOllama
          ? { embeddings: vectors }
          : { data: vectors.map((embedding) => ({ embedding })) },
    } as any;
  }) as unknown as typeof fetch;

  return { fetcher, calls };
}

describe("vector identity", () => {
  it("distinguishes the same text embedded by different models", () => {
    // The whole point: a content hash alone would reuse an incompatible vector.
    const contentHash = hashContent("the user prefers local models");
    const a = vectorIdentity({
      contentHash,
      embeddingVersion: embeddingVersion("ollama", "nomic-embed-text", 768),
    });
    const b = vectorIdentity({
      contentHash,
      embeddingVersion: embeddingVersion("ollama", "bge-m3", 1024),
    });
    expect(a).not.toBe(b);
  });

  it("is stable for the same text and model", () => {
    const version = embeddingVersion("ollama", "nomic-embed-text", 768);
    expect(
      vectorIdentity({
        contentHash: hashContent("x"),
        embeddingVersion: version,
      }),
    ).toBe(
      vectorIdentity({
        contentHash: hashContent("x"),
        embeddingVersion: version,
      }),
    );
  });

  it("records provider, model and dimensions", () => {
    expect(embeddingVersion("ollama", "nomic-embed-text", 768)).toBe(
      "ollama:nomic-embed-text:768",
    );
  });
});

describe("candidateEndpoints", () => {
  it("checks only loopback by default", () => {
    for (const endpoint of candidateEndpoints("")) {
      expect(isLoopback(endpoint)).toBe(true);
    }
  });

  it("includes an endpoint the user configured", () => {
    expect(candidateEndpoints("http://nas.local:11434")).toContain(
      "http://nas.local:11434",
    );
  });

  it("never probes an address the user did not name", () => {
    // Detection must not scan the network.
    const endpoints = candidateEndpoints("http://nas.local:11434");
    for (const endpoint of endpoints) {
      expect(
        isLoopback(endpoint) || endpoint === "http://nas.local:11434",
      ).toBe(true);
    }
  });
});

describe("detectEmbedder", () => {
  const config = { ...DEFAULT_EMBEDDING_CONFIG, model: "nomic-embed-text" };

  it("finds Ollama and learns its real dimension count", async () => {
    const { fetcher } = fakeServer({ shape: "ollama", dimensions: 768 });
    const embedder = await detectEmbedder(config, fetcher);
    expect(embedder.provider).toBe("ollama");
    expect(embedder.dimensions).toBe(768);
    expect(embedder.version).toBe("ollama:nomic-embed-text:768");
  });

  it("falls through to an OpenAI-compatible server", async () => {
    const { fetcher } = fakeServer({ shape: "openai", dimensions: 1024 });
    const embedder = await detectEmbedder(config, fetcher);
    expect(embedder.provider).toBe("openai-compatible");
    expect(embedder.dimensions).toBe(1024);
  });

  it("falls back to lexical when nothing answers", async () => {
    const dead = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const embedder = await detectEmbedder(config, dead);
    expect(embedder.provider).toBe("lexical-fallback");
    expect(embedder.dimensions).toBe(384);
  });

  it("refuses to fall back when the user turned fallback off", async () => {
    const dead = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    await expect(
      detectEmbedder(
        { ...config, provider: "ollama", enableFallback: false },
        dead,
      ),
    ).rejects.toThrow(/no embedding provider/i);
  });

  it("uses the lexical hash when explicitly chosen", async () => {
    const embedder = await detectEmbedder({
      ...config,
      provider: "lexical-fallback",
    });
    expect(embedder).toEqual(LEXICAL_EMBEDDER);
  });

  it("rejects a server that answers but returns no vector", async () => {
    // Reachable is not the same as supporting embeddings.
    const empty = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ embeddings: [[]] }),
    })) as unknown as typeof fetch;
    const embedder = await detectEmbedder(config, empty);
    expect(embedder.provider).toBe("lexical-fallback");
  });
});

describe("embedTexts", () => {
  const config = { ...DEFAULT_EMBEDDING_CONFIG, batchSize: 2 };

  it("sends texts in batches of the configured size", async () => {
    const { fetcher, calls } = fakeServer({ shape: "ollama" });
    const embedder = await detectEmbedder(config, fetcher);
    calls.length = 0;

    await embedTexts(["a", "b", "c", "d", "e"], embedder, config, { fetcher });

    expect(calls).toHaveLength(3);
    expect(calls[0]!.body.input).toEqual(["a", "b"]);
    expect(calls[2]!.body.input).toEqual(["e"]);
  });

  it("returns one vector per input", async () => {
    const { fetcher } = fakeServer({ shape: "ollama" });
    const embedder = await detectEmbedder(config, fetcher);
    const vectors = await embedTexts(["a", "b", "c"], embedder, config, {
      fetcher,
    });
    expect(vectors).toHaveLength(3);
    expect(vectors[0]).toHaveLength(768);
  });

  it("retries a transient failure", async () => {
    const { fetcher } = fakeServer({ shape: "ollama", failTimes: 0 });
    const embedder = await detectEmbedder(config, fetcher);
    const flaky = fakeServer({ shape: "ollama", failTimes: 2 });
    const vectors = await embedTexts(["a"], embedder, config, {
      fetcher: flaky.fetcher,
    });
    expect(vectors).toHaveLength(1);
  });

  it("gives up rather than writing partial data", async () => {
    const { fetcher } = fakeServer({ shape: "ollama" });
    const embedder = await detectEmbedder(config, fetcher);
    const broken = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    await expect(
      embedTexts(["a"], embedder, config, { fetcher: broken, maxAttempts: 2 }),
    ).rejects.toThrow(/left unchanged/i);
  });

  it("refuses a vector of the wrong width", async () => {
    // Mixing widths would corrupt the collection silently.
    const { fetcher } = fakeServer({ shape: "ollama", dimensions: 768 });
    const embedder = await detectEmbedder(config, fetcher);
    const wrong = fakeServer({ shape: "ollama", dimensions: 512 });
    await expect(
      embedTexts(["a"], embedder, config, { fetcher: wrong.fetcher }),
    ).rejects.toThrow(/dimensions/i);
  });

  it("reports progress as batches complete", async () => {
    const { fetcher } = fakeServer({ shape: "ollama" });
    const embedder = await detectEmbedder(config, fetcher);
    const seen: number[] = [];
    await embedTexts(["a", "b", "c"], embedder, config, {
      fetcher,
      onProgress: (done) => seen.push(done),
    });
    expect(seen).toEqual([2, 3]);
  });

  it("stops when cancelled", async () => {
    const { fetcher } = fakeServer({ shape: "ollama" });
    const embedder = await detectEmbedder(config, fetcher);
    const signal = { aborted: true };
    expect(
      await embedTexts(["a", "b"], embedder, config, { fetcher, signal }),
    ).toEqual([]);
  });

  it("uses the hash directly for the lexical embedder", async () => {
    const vectors = await embedTexts(
      ["hello"],
      LEXICAL_EMBEDDER,
      DEFAULT_EMBEDDING_CONFIG,
    );
    expect(vectors[0]).toEqual(lexicalEmbed("hello"));
  });
});

describe("batches", () => {
  it("splits evenly and keeps the remainder", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("never produces a zero-sized batch", () => {
    expect(batches([1, 2], 0)).toEqual([[1], [2]]);
  });
});

describe("semantic retrieval beyond exact vocabulary", () => {
  /**
   * A stand-in "model" with a tiny hand-built meaning space. It proves the
   * retrieval path uses the provider's vectors rather than word overlap — the
   * real quality of a real model is its own concern, not this suite's.
   */
  const CONCEPTS: Record<string, number[]> = {
    vehicle: [1, 0, 0],
    localAi: [0, 1, 0],
    gymnastics: [0, 0, 1],
  };
  const meaningOf = (text: string): number[] => {
    const lower = text.toLowerCase();
    if (/automobile|car|tesla|vehicle/.test(lower)) return CONCEPTS.vehicle!;
    if (/artificial intelligence|llm|local model|own mac/.test(lower)) {
      return CONCEPTS.localAi!;
    }
    if (/gymnastic|trains|competes|level 5/.test(lower)) {
      return CONCEPTS.gymnastics!;
    }
    return [0, 0, 0];
  };

  const cosine = (a: number[], b: number[]) => {
    const dot = a.reduce((sum, value, i) => sum + value * b[i]!, 0);
    const mag = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    const denominator = mag(a) * mag(b);
    return denominator === 0 ? 0 : dot / denominator;
  };

  const cases = [
    {
      query: "automobile",
      memory: "The user is considering buying a second-hand Tesla.",
    },
    {
      query: "local artificial intelligence",
      memory:
        "The user prefers running LLMs on their own Mac instead of cloud services.",
    },
    {
      query: "daughter's gymnastics schedule",
      memory: "Tiffany trains and competes in Level 5 gymnastics.",
    },
  ];

  it("matches meaning where the lexical hash cannot", async () => {
    const { fetcher } = fakeServer({
      shape: "ollama",
      dimensions: 3,
      vectorFor: meaningOf,
    });
    const config = { ...DEFAULT_EMBEDDING_CONFIG, batchSize: 4 };
    const embedder = await detectEmbedder(config, fetcher);

    for (const { query, memory } of cases) {
      const [queryVector, memoryVector] = await embedTexts(
        [query, memory],
        embedder,
        config,
        { fetcher },
      );
      // Semantically related despite sharing no vocabulary.
      expect(cosine(queryVector!, memoryVector!)).toBeGreaterThan(0.9);

      // The lexical hash, on the same pair, finds nothing.
      expect(cosine(lexicalEmbed(query), lexicalEmbed(memory))).toBeLessThan(
        0.5,
      );
    }
  });
});
