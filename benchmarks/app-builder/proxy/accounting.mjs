export function priceOf(model, usage, pricing) {
  if (!pricing?.models || !usage) return null;
  const counts = [
    usage.promptTokens,
    usage.completionTokens,
    usage.cachedTokens ?? 0,
    usage.cacheWriteTokens ?? 0,
  ];
  if (
    counts.some((n) => !Number.isFinite(n) || n < 0) ||
    counts[2] + counts[3] > counts[0]
  )
    return null;
  // Longest match wins: "z-ai/glm-5.3" is a substring of "z-ai/glm-5.3-flash",
  // and first-match billed Flash at flagship rates (a 15x error).
  const key = Object.keys(pricing.models)
    .filter((k) => model?.includes(k))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return null;
  const p = pricing.models[key];
  const cached = usage.cachedTokens ?? 0;
  const writes = usage.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, (usage.promptTokens ?? 0) - cached - writes);
  const tier =
    p.tiers && (usage.promptTokens ?? 0) >= p.tiers.threshold ? p.tiers : p;
  // Cache writes bill at the provider's write rate when published (Anthropic
  // 1.25x input for 5-min TTL); otherwise at the plain input rate.
  const writeRate = tier.cacheWrite ?? p.cacheWrite ?? tier.input;
  return (
    (uncached * tier.input + cached * tier.cachedInput + writes * writeRate) /
      1e6 +
    ((usage.completionTokens ?? 0) * tier.output) / 1e6
  );
}

export function extractUsage(text) {
  let usage = null;
  let anthroIn = null;
  let anthroOut = null;
  const consider = (u) => {
    if (!u) return;
    if (u.prompt_tokens != null || u.completion_tokens != null) {
      usage = {
        promptTokens: u.prompt_tokens ?? null,
        completionTokens: u.completion_tokens ?? null,
        totalTokens: u.total_tokens ?? null,
        cachedTokens: u.prompt_tokens_details?.cached_tokens ?? null,
        cacheWriteTokens: u.prompt_tokens_details?.cache_write_tokens ?? null,
        reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? null,
        raw: u,
      };
    } else if (u.input_tokens != null || u.output_tokens != null) {
      const isAnthropic =
        u.input_tokens_details == null &&
        (u.cache_read_input_tokens != null ||
          u.cache_creation_input_tokens != null);
      const input =
        (u.input_tokens ?? 0) +
        (isAnthropic
          ? (u.cache_read_input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0)
          : 0);
      usage = {
        promptTokens: input,
        completionTokens: u.output_tokens ?? null,
        totalTokens: u.total_tokens ?? input + (u.output_tokens ?? 0),
        cachedTokens:
          u.input_tokens_details?.cached_tokens ??
          u.cache_read_input_tokens ??
          null,
        reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? null,
        cacheWriteTokens:
          u.input_tokens_details?.cache_write_tokens ??
          (isAnthropic ? (u.cache_creation_input_tokens ?? null) : null),
        raw: u,
      };
    }
  };
  for (const line of text.split("\n")) {
    const payload = line.startsWith("data:")
      ? line.slice(5).trim()
      : line.trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload);
      if (obj.type === "message_start" && obj.message?.usage) {
        anthroIn = obj.message.usage;
        continue;
      }
      if (obj.type === "message_delta" && obj.usage) {
        anthroOut = obj.usage;
        continue;
      }
      consider(obj.response?.usage ?? obj.usage);
    } catch {
      /* partial chunk fragments are expected in the tail */
    }
  }
  // Engine message_stop may repeat only uncached input/output. Prefer the
  // Anthropic start/delta pair, which retains cache read and creation usage.
  if (anthroOut && !anthroIn) return null;
  if (anthroIn || anthroOut) {
    const inU = anthroIn ?? {};
    const outU = anthroOut ?? {};
    const inputTokens =
      (inU.input_tokens ?? 0) +
      (inU.cache_read_input_tokens ?? 0) +
      (inU.cache_creation_input_tokens ?? 0);
    usage = {
      promptTokens: inputTokens,
      completionTokens: outU.output_tokens ?? inU.output_tokens ?? null,
      totalTokens: inputTokens + (outU.output_tokens ?? 0),
      cachedTokens: inU.cache_read_input_tokens ?? null,
      cacheWriteTokens: inU.cache_creation_input_tokens ?? null,
      reasoningTokens: null,
      raw: { message_start: anthroIn, message_delta: anthroOut },
    };
  }
  return usage;
}

// Historical rows retain raw usage even when an older normalizer dropped cache
// writes. Keep the original raw record; only reconstruct counts it actually has.
export function normalizeRecordedUsage(usage) {
  if (!usage?.raw) return usage;
  const raw = usage.raw;
  if (raw.message_start || raw.message_delta) {
    return extractUsage(
      [
        { type: "message_start", message: { usage: raw.message_start } },
        { type: "message_delta", usage: raw.message_delta },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
  }
  if (
    raw.prompt_tokens == null &&
    raw.input_tokens_details == null &&
    (raw.cache_creation_input_tokens != null ||
      raw.cache_read_input_tokens != null)
  ) {
    return extractUsage(
      [
        { type: "message_start", message: { usage: raw } },
        { type: "message_delta", usage: { output_tokens: raw.output_tokens } },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
  }
  return extractUsage(JSON.stringify({ usage: raw })) ?? usage;
}

// Retain usage events, not a rolling response tail: a large tool call can evict
// Anthropic's message_start (where its cache counts live) from a tail buffer.
export function createUsageCollector() {
  let buffer = "",
    sse = false;
  const events = new Map();
  const remember = (obj) => {
    if (obj.type === "message_start" && obj.message?.usage)
      events.set("start", {
        type: obj.type,
        message: { usage: obj.message.usage },
      });
    else if (obj.type === "message_delta" && obj.usage)
      events.set("delta", { type: obj.type, usage: obj.usage });
    else if (obj.response?.usage || obj.usage)
      events.set("last", { usage: obj.response?.usage ?? obj.usage });
  };
  return {
    push(text) {
      buffer += text;
      if (/^(?:\s*)(?:data:|event:|:)/.test(buffer)) sse = true;
      if (!sse) return;
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (!line.startsWith("data:")) continue;
        try {
          remember(JSON.parse(line.slice(5).trim()));
        } catch {
          /* DONE or heartbeat */
        }
      }
    },
    finish() {
      if (sse) {
        this.push("\n");
      } else {
        try {
          remember(JSON.parse(buffer));
        } catch {
          /* no complete usage body */
        }
      }
      return extractUsage(
        [...events.values()].map((x) => JSON.stringify(x)).join("\n"),
      );
    },
  };
}
