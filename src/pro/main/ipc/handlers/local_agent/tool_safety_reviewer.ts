import { stepCountIs, streamText, type ToolSet } from "ai";
import { z } from "zod";
import { getModelClient } from "@/ipc/utils/get_model_client";
import { fastTextOutput } from "@/ipc/utils/stream_text_utils";
import { extractJson } from "@/ipc/utils/extract_json";
import type { UserSettings } from "@/lib/schemas";

export const TOOL_REVIEW_TIMEOUT_MS = 8_000;

/** Policy-specific decisions share transport, cancellation, and fail-closed parsing. */
export async function reviewToolAction<D extends "ask" | "block">({
  settings,
  system,
  fallback,
  signal,
  prepare,
}: {
  settings: UserSettings;
  system: string;
  fallback: D;
  signal?: AbortSignal;
  prepare: (
    signal: AbortSignal,
  ) => Promise<{ payload: string; tools?: ToolSet }>;
}): Promise<{ decision: "allow" | D; reason: string }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("Review cancelled or timed out"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(abort, TOOL_REVIEW_TIMEOUT_MS);
      if (signal?.aborted) abort();
    });
    const work = async () => {
      controller.signal.throwIfAborted();
      const { payload, tools } = await prepare(controller.signal);
      controller.signal.throwIfAborted();
      const { modelClient } = await getModelClient(
        { name: "gpt-5.6-luna", provider: "openai" },
        settings,
      );
      controller.signal.throwIfAborted();
      const stream = streamText({
        output: fastTextOutput(),
        model: modelClient.model,
        system,
        maxRetries: 1,
        abortSignal: controller.signal,
        messages: [{ role: "user", content: payload }],
        ...(tools ? { tools, stopWhen: stepCountIs(4) } : {}),
      });
      const text = await stream.text;
      controller.signal.throwIfAborted();
      const json = fallback === "ask" ? extractJson(text) : text.trim();
      if (!json) throw new Error("Missing decision");
      const result = z
        .object({
          reason:
            fallback === "block"
              ? z.string().trim().min(1)
              : z.string().optional(),
          decision: z.enum(["allow", fallback]),
        })
        .parse(JSON.parse(json));
      return {
        decision: result.decision,
        reason: result.reason?.trim() || "No reason provided.",
      };
    };
    return await Promise.race([work(), stopped]);
  } catch {
    return {
      decision: fallback,
      reason: "Could not evaluate the tool call automatically.",
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
