import { stepCountIs, streamText, type ToolSet } from "ai";
import { z } from "zod";
import log from "electron-log";
import { getModelClient } from "@/ipc/utils/get_model_client";
import { fastTextOutput } from "@/ipc/utils/stream_text_utils";
import { extractJson } from "@/ipc/utils/extract_json";
import type { UserSettings } from "@/lib/schemas";

export const TOOL_REVIEW_TIMEOUT_MS = 8_000;
const logger = log.scope("tool-safety-reviewer");

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
}): Promise<{
  decision: "allow" | D | "ask";
  reason: string;
  unavailable?: true;
}> {
  const state: { phase: "context" | "model setup" | "generation" | "verdict" } =
    { phase: "context" };
  let timedOut = false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("Review cancelled or timed out"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        timedOut = true;
        abort();
      }, TOOL_REVIEW_TIMEOUT_MS);
      if (signal?.aborted) abort();
    });
    const work = async () => {
      controller.signal.throwIfAborted();
      const { payload, tools } = await prepare(controller.signal);
      controller.signal.throwIfAborted();
      state.phase = "model setup";
      const { modelClient } = await getModelClient(
        { name: "gpt-6-luna", provider: "openai" },
        settings,
      );
      controller.signal.throwIfAborted();
      state.phase = "generation";
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
      state.phase = "verdict";
      const json = fallback === "ask" ? extractJson(text) : text.trim();
      if (!json) throw new Error("Missing decision");
      const result = z
        .object({
          reason:
            fallback === "block"
              ? z.string().trim().min(1)
              : z.string().optional(),
          decision:
            fallback === "block"
              ? z.enum(["allow", "ask", "block"])
              : z.enum(["allow", "ask"]),
        })
        .parse(JSON.parse(json));
      logger.info("Review completed", {
        decision: result.decision,
        reason: result.reason?.slice(0, 500),
      });
      return {
        decision: result.decision,
        reason: result.reason?.trim() || "No reason provided.",
      };
    };
    return await Promise.race([work(), stopped]);
  } catch (error) {
    const reason = signal?.aborted
      ? "Tool safety review was cancelled."
      : timedOut
        ? "Tool safety review timed out."
        : state.phase === "verdict"
          ? "The safety reviewer returned an invalid verdict."
          : `Tool safety review failed during ${state.phase}.`;
    // Fixed metadata avoids logging payloads or provider errors containing secrets.
    logger.warn(reason, {
      phase: state.phase,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return { decision: fallback, reason, unavailable: true };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
