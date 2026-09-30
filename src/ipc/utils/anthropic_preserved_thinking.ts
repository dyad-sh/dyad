import type { FetchFunction } from "@ai-sdk/provider-utils";
import log from "electron-log";

const logger = log.scope("anthropic_preserved_thinking");
export const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01";

// The pinned AI SDK doesn't yet expose block_binding or input_transformations.
// Apply the wire option after SDK serialization, on both BYOK and Engine paths.
// Sonnet 4 (claude-sonnet-4-20250514) rejects this beta with "invalid beta flag"
// through the Engine. Dyad does not support that model, so no compatibility
// retry is provided; provider errors are returned unchanged.
export function withAnthropicPreservedThinking(
  fetchFn: FetchFunction = fetch,
): FetchFunction {
  return async (input, init) => {
    if (typeof init?.body !== "string") return fetchFn(input, init);
    const body = JSON.parse(init.body);
    if (!["adaptive", "enabled"].includes(body.thinking?.type)) {
      return fetchFn(input, init);
    }
    body.thinking.block_binding = { prefix_mismatch_behavior: "drop_block" };
    const headers = new Headers(init.headers);
    const betas = new Set(
      (headers.get("anthropic-beta") ?? "").split(",").filter(Boolean),
    );
    betas.add(THINKING_BINDING_BETA);
    headers.set("anthropic-beta", [...betas].join(","));
    const response = await fetchFn(input, {
      ...init,
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) return response;

    const report = (message: Record<string, unknown>) => {
      if (!Array.isArray(message.input_transformations)) return;
      // Never log prompts, thinking text, signatures, or credentials.
      logger.debug("input_transformations", {
        model: body.model,
        requestId:
          response.headers.get("request-id") ??
          headers.get("x-dyad-request-id"),
        input_transformations: message.input_transformations.map((entry) => ({
          type: entry.type,
          path: entry.path,
          reason: entry.reason,
        })),
      });
    };
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      await response
        .clone()
        .json()
        .then(report)
        .catch(() => undefined);
      return response;
    }
    if (!response.body) return response;

    // Observe SSE without teeing/buffering a second copy of the whole response.
    // Anthropic emits a JSON data line per event. Forward the original bytes so
    // SDK parsing, backpressure and cancellation remain unchanged.
    const decoder = new TextDecoder();
    let pending = "";
    let skipLine = false;
    const stream = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(chunk);
          pending += decoder.decode(chunk, { stream: true });
          let newline: number;
          while ((newline = pending.indexOf("\n")) !== -1) {
            const line = pending.slice(0, newline).trimEnd();
            pending = pending.slice(newline + 1);
            if (!skipLine && line.startsWith("data:")) {
              try {
                const event = JSON.parse(line.slice(5).trimStart());
                if (event.type === "message_start") report(event.message);
                if (event.type === "message_delta") report(event);
              } catch {
                // Observability must not change SDK error handling.
              }
            }
            skipLine = false;
          }
          // Bound observer memory even if an upstream sends a huge data line.
          if (pending.length > 1_048_576) {
            pending = "";
            skipLine = true;
          }
        },
      }),
    );
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
