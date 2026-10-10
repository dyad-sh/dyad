export function getLmStudioBaseUrl(): string {
  return process.env.LM_STUDIO_BASE_URL_FOR_TESTING || "http://localhost:1234";
}

/**
 * The subset of a `GET /api/v0/models` entry that Dyad reads. The endpoint
 * returns more fields; only the context-length ones matter here.
 */
interface LMStudioModelInfo {
  id?: string;
  /** Only present for models LM Studio has loaded — the configured window. */
  loaded_context_length?: number;
  /** The model's architectural maximum context length. */
  max_context_length?: number;
}

/**
 * The context window LM Studio is actually using for `modelId`.
 *
 * Local models are not part of Dyad's model catalog, so `findLanguageModel`
 * has no context window for them and Dyad would otherwise fall back to a
 * generic default — which misreports the window for any model the user loaded
 * with a different context length. LM Studio reports the configured window as
 * `loaded_context_length` for loaded models and the architectural maximum as
 * `max_context_length`, so prefer the former.
 *
 * Returns `undefined` when LM Studio is unreachable, does not know the model,
 * or reports no usable value, so callers keep their own fallback.
 */
export async function fetchLMStudioModelContextLength(
  modelId: string,
): Promise<number | undefined> {
  try {
    const response = await fetch(`${getLmStudioBaseUrl()}/api/v0/models`, {
      // `getContextWindow()` runs this on the token-count and per-turn
      // compaction paths, so a stalled LM Studio (busy loading a model, or
      // another process bound to port 1234) must not block them.
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { data?: LMStudioModelInfo[] };
    const model = body.data?.find((entry) => entry.id === modelId);
    if (!model) {
      return undefined;
    }
    // Validate each candidate on its own: a present but unusable
    // `loaded_context_length` must not hide a usable `max_context_length`.
    return (
      toPositiveContextLength(model.loaded_context_length) ??
      toPositiveContextLength(model.max_context_length)
    );
  } catch {
    // LM Studio is not running or not reachable. A token-count read must not
    // fail because of this lookup, so let the caller use its own default.
    return undefined;
  }
}

function toPositiveContextLength(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
