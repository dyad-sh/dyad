import {
  createDyadEngine,
  type DyadEngineProvider,
} from "@/ipc/utils/llm_engine_provider";
import type { LanguageModel } from "ai";
import type { UserSettings } from "@/lib/schemas";

export type EvalProvider = "anthropic" | "openai" | "google";

// Eval-only model identifier. Lives here (not in production constants)
// because Dyad's production picker does not currently surface GPT 5.4 —
// it had refusal/routing issues — but the eval harness still uses it as
// the judge model.
export const GPT_5_4 = "gpt-5.4";

// Single source of truth for the Dyad Engine URL across the eval helpers.
export const DYAD_ENGINE_URL =
  process.env.DYAD_ENGINE_URL ?? "https://engine.dyad.sh/v1";

// Gateway prefixes must match CLOUD_PROVIDERS in language_model_constants.ts.
const GATEWAY_PREFIXES: Record<EvalProvider, string> = {
  openai: "",
  anthropic: "anthropic/",
  google: "gemini/",
};

export function hasDyadProKey(): boolean {
  return !!process.env.DYAD_PRO_API_KEY;
}

let _provider: DyadEngineProvider | null = null;

/**
 * Reassemble an SSE stream of OpenAI chat-completion chunks into a single
 * non-streaming JSON response that the AI SDK's `doGenerate` path can parse.
 *
 * The Dyad Engine only supports `stream: true`, but the AI SDK sends
 * non-streaming requests for `generateText`. This adapter bridges the gap.
 */
async function sseToNonStreamingResponse(
  response: Response,
): Promise<Response> {
  const text = await response.text();
  const lines = text.split("\n");

  let id = "";
  let model = "";
  // Track usage across the stream. When `stream_options.include_usage` is
  // set on the request, OpenAI-compatible providers emit a final chunk with
  // a populated `usage` object. We overwrite on every chunk that carries
  // one so the last value wins.
  let usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const choices: Map<
    number,
    {
      role: string;
      content: string;
      tool_calls: Map<
        number,
        {
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }
      >;
      finish_reason: string | null;
    }
  > = new Map();

  for (const line of lines) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    let chunk: any;
    try {
      chunk = JSON.parse(line.slice(6));
    } catch {
      continue;
    }

    // If the engine returned an error inside the SSE stream, surface it as
    // a JSON error response so the SDK's retry logic can handle it.
    if (chunk.error) {
      return new Response(JSON.stringify(chunk), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    if (chunk.id) id = chunk.id;
    if (chunk.model) model = chunk.model;

    if (chunk.usage) {
      usage = {
        prompt_tokens: chunk.usage.prompt_tokens ?? 0,
        completion_tokens: chunk.usage.completion_tokens ?? 0,
        total_tokens:
          chunk.usage.total_tokens ??
          (chunk.usage.prompt_tokens ?? 0) +
            (chunk.usage.completion_tokens ?? 0),
      };
    }

    for (const c of chunk.choices ?? []) {
      const idx = c.index ?? 0;
      if (!choices.has(idx)) {
        choices.set(idx, {
          role: "assistant",
          content: "",
          tool_calls: new Map(),
          finish_reason: null,
        });
      }
      const choice = choices.get(idx)!;
      const delta = c.delta ?? {};

      if (delta.role) choice.role = delta.role;
      if (delta.content) choice.content += delta.content;
      if (c.finish_reason) choice.finish_reason = c.finish_reason;

      for (const tc of delta.tool_calls ?? []) {
        const tcIdx = tc.index ?? 0;
        if (!choice.tool_calls.has(tcIdx)) {
          choice.tool_calls.set(tcIdx, {
            id: tc.id ?? "",
            type: tc.type ?? "function",
            function: { name: "", arguments: "" },
          });
        }
        const existing = choice.tool_calls.get(tcIdx)!;
        if (tc.id) existing.id = tc.id;
        if (tc.type) existing.type = tc.type;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (tc.function?.arguments)
          existing.function.arguments += tc.function.arguments;
      }
    }
  }

  const assembled = {
    id,
    object: "chat.completion",
    model,
    choices: Array.from(choices.entries())
      .sort(([a], [b]) => a - b)
      .map(([idx, c]) => ({
        index: idx,
        message: {
          role: c.role,
          content: c.content || null,
          ...(c.tool_calls.size > 0
            ? {
                tool_calls: Array.from(c.tool_calls.entries())
                  .sort(([a], [b]) => a - b)
                  .map(([, tc]) => tc),
              }
            : {}),
        },
        finish_reason: c.finish_reason ?? "stop",
      })),
    usage,
  };

  return new Response(JSON.stringify(assembled), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Fetch wrapper that adapts requests for the Dyad Engine, which only supports
 * streaming (`stream: true`). For non-streaming SDK calls (e.g. `generateText`),
 * this forces `stream: true` in the request and then reassembles the SSE
 * response into a single JSON object the SDK expects.
 */
const evalFetch: typeof fetch = async (input, init) => {
  if (!init?.body || typeof init.body !== "string") {
    return fetch(input, init);
  }

  // Only the JSON parse is allowed to fail silently — if the body isn't a
  // JSON request we don't know how to adapt, so fall through to a plain
  // fetch with the original init. Network and SSE-adaptation errors must
  // propagate so the SDK can surface them (and so we don't double-spend
  // tokens by transparently retrying a request the gateway already saw).
  let parsed: any;
  let wasNonStreaming: boolean;
  try {
    parsed = JSON.parse(init.body);
    wasNonStreaming = !parsed.stream;
  } catch {
    return fetch(input, init);
  }

  // Force streaming — the Dyad Engine returns 500 for non-streaming requests
  parsed.stream = true;
  // Ask OpenAI-compatible providers to include a final usage chunk so
  // we can surface token counts in the reassembled non-streaming
  // response instead of hard-coding zeros.
  parsed.stream_options = {
    ...parsed.stream_options,
    include_usage: true,
  };
  const modifiedInit = { ...init, body: JSON.stringify(parsed) };

  const response = await fetch(input, modifiedInit);

  // Convert the SSE stream back to a single JSON response for the SDK.
  // Only reassemble when the upstream response is actually an SSE stream —
  // otherwise (non-OK status, or a non-SSE body like a JSON error payload)
  // pass the response through unchanged so the SDK's error/retry path
  // sees the real failure instead of a synthetic empty 200.
  if (wasNonStreaming) {
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text/event-stream")) {
      return response;
    }
    return sseToNonStreamingResponse(response);
  }
  return response;
};

function getProvider(): DyadEngineProvider {
  if (!_provider) {
    _provider = createDyadEngine({
      apiKey: process.env.DYAD_PRO_API_KEY,
      baseURL: DYAD_ENGINE_URL,
      dyadOptions: {
        enableLazyEdits: false,
        enableSmartFilesContext: false,
        enableWebSearch: false,
      },
      settings: {} as UserSettings,
      fetch: evalFetch,
    });
  }
  return _provider;
}

export function getEvalModel(
  provider: EvalProvider,
  modelName: string,
): LanguageModel {
  const dyadProvider = getProvider();
  const modelId = `${GATEWAY_PREFIXES[provider]}${modelName}`;

  // Always use the chat completions model (not .responses()) because:
  // 1. The Dyad Engine only supports streaming for chat completions, and the
  //    SSE-to-JSON adapter handles that format. The Responses API uses a
  //    different SSE event format that would need its own adapter.
  // 2. The eval tests model quality (correct tool calls), not transport layer.
  return dyadProvider(modelId, { providerId: provider });
}
