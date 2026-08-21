/**
 * stream_execution_guard.ts — positive-completion proof for `fullResponse`
 * before it is used to drive real side effects (file writes, deletes, SQL
 * execution, dependency installs — see `processFullResponseActions` in
 * `response_processor.ts`).
 *
 * Why this exists: `processStreamChunks` (chat_stream_handlers.ts) builds
 * `fullResponse` by accumulating `text-delta` parts from the provider's
 * `fullStream`, and the only existing safety check before applying it is
 * `!abortController.signal.aborted` — an explicit user cancel. Nothing
 * checks the stream's own `finishReason`. A `<dyad-write>` tag can be
 * completely well-formed (opened and closed) while the *surrounding*
 * generation is subsequently cut off by a token limit
 * (`finishReason: "length"`), a content filter, or a provider error that
 * only ever reaches the non-throwing `onError` callback. None of those
 * currently prevent `processFullResponseActions` from running on whatever
 * text happened to accumulate — a well-formed tag is treated as proof the
 * model's intent for that turn was fully expressed, which it is not.
 *
 * This wraps `prefix-safe-json`'s `createAiSdkExecutionGuard()` — the same
 * "requires positive terminal-state proof, not just structural validity"
 * guarantee it applies to individual tool calls — around the *whole
 * response*, using its own completeness/termination-reason classification
 * rather than reimplementing that logic. `<dyad-write>` and friends are
 * plain text, not an AI SDK tool call, so there is no real `toolCallId` to
 * key this on; a single fixed synthetic id represents "this response" for
 * the guard's bookkeeping. Its "arguments" are always the trivial, always-
 * valid placeholder `"{}"` — the guard's own JSON-completeness tracking is
 * irrelevant here on purpose; only its terminal-state classification
 * (fed by the real `finish` / `error` / `abort` parts observed below)
 * decides the outcome.
 *
 * Concurrency note: unlike a deferred-execution pattern, nothing here is
 * shared across calls or stored beyond one `processStreamChunks`
 * invocation. `createStreamSafetyTracker()` returns a fresh, independent
 * `prefix-safe-json` guard instance every time — there is no process-wide
 * map keyed by this module's fixed synthetic id, so two concurrent turns
 * (or retry-loop iterations within the same turn) can never observe or
 * resolve each other's tracker.
 */
import { createAiSdkExecutionGuard, type AiSdkExecutionGuard } from "prefix-safe-json";

const RESPONSE_CALL_ID = "__dyad_full_response__";

export interface StreamSafetyTracker {
  guard: AiSdkExecutionGuard;
}

/**
 * Starts tracking one `processStreamChunks` invocation's underlying
 * stream. Call `observeStreamPart` for every part read from `fullStream`,
 * then `resolveStreamSafety` once that stream is done being consumed
 * (however it ended — normal completion, break, or in-band error).
 */
export function createStreamSafetyTracker(): StreamSafetyTracker {
  const guard = createAiSdkExecutionGuard();
  guard.push({ type: "tool-input-start", id: RESPONSE_CALL_ID, toolName: "apply_response_actions" });
  guard.push({ type: "tool-input-delta", id: RESPONSE_CALL_ID, delta: "{}" });
  guard.push({ type: "tool-input-end", id: RESPONSE_CALL_ID });
  return { guard };
}

/** Feed one raw `fullStream` part through, unchanged, as observed. */
export function observeStreamPart(tracker: StreamSafetyTracker, part: unknown): void {
  tracker.guard.push(part);
}

export interface StreamSafetyResult {
  /** True only if the underlying stream positively confirmed a safe, complete termination. */
  confirmedSafe: boolean;
  /** Present when confirmedSafe is false: the guard's classification of why. */
  reason?: string;
}

/**
 * Resolves the tracker against everything observed so far. Safe to call
 * even if the stream never produced its own `finish`/`error`/`abort`
 * part (e.g. an unexpected disconnect) — `meta` is the fallback the
 * underlying guard uses in that case, and it is deliberately never
 * `"complete"`, so an unconfirmed termination fails closed rather than
 * defaulting to safe.
 */
export function resolveStreamSafety(
  tracker: StreamSafetyTracker,
  meta?: { providerReason?: string },
): StreamSafetyResult {
  const { decisions } = tracker.guard.finish(meta);
  const decision = decisions.find((d) => d.toolCallId === RESPONSE_CALL_ID);
  if (!decision) {
    // Should not happen (the synthetic call is always registered in
    // createStreamSafetyTracker), but fail closed rather than assume safe.
    return { confirmedSafe: false, reason: "no_decision" };
  }
  if (decision.action === "execute") {
    return { confirmedSafe: true };
  }
  return { confirmedSafe: false, reason: decision.reason };
}
