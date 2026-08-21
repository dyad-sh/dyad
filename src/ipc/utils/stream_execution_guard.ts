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

/**
 * Marker reason used only by `createInitialStreamSafety()`. Lets
 * `combineStreamSafety` tell "no stream has contributed yet" apart from a
 * real unsafe verdict a stream actually produced — the former must defer to
 * whatever the first real stream reports, the latter must never be
 * overridden by a later one.
 */
const NOT_YET_OBSERVED_REASON = "not_yet_observed";

/**
 * The accumulator's starting value, before any `processStreamChunks`
 * invocation has contributed a stream to the turn's `fullResponse`. Fails
 * closed like every other unconfirmed state, but is distinguished from a
 * real unsafe verdict so `combineStreamSafety` knows to simply adopt the
 * first real stream's own result rather than treating it as "already
 * unsafe, stays unsafe".
 */
export function createInitialStreamSafety(): StreamSafetyResult {
  return { confirmedSafe: false, reason: NOT_YET_OBSERVED_REASON };
}

/**
 * Folds one more stream's safety verdict into the accumulated verdict for
 * everything that has contributed to `fullResponse` so far this turn.
 *
 * `fullResponse` is cumulative across `processStreamChunks` calls — the
 * initial generation, any Turbo Edits/search-replace repair streams, and
 * any "continue where you left off" streams for an unclosed `<dyad-write>`
 * tag all append to the same string that eventually reaches
 * `processFullResponseActions`. Each of those streams gets its own fresh
 * `StreamSafetyTracker` (see the concurrency note above), so on its own a
 * later stream's `stop` finish has no idea an earlier stream in the same
 * turn was cut off by `finishReason: "length"` — resolving trackers
 * independently and simply overwriting the turn's verdict with the latest
 * one would let a clean continuation "launder" content that was appended
 * to `fullResponse` while a previous stream was unsafe.
 *
 * Semantics are deliberately conservative and sticky: once any contributing
 * stream is unsafe, the accumulated verdict for the whole turn stays unsafe
 * no matter how safely a later stream in the same turn completes. Only "all
 * contributing streams safe" yields a safe accumulated verdict. A
 * successful continuation can still make the visible response text useful
 * to read — this only withholds the real filesystem/SQL/dependency side
 * effect, never the response itself (see the persisted-message write in
 * chat_stream_handlers.ts, which is unconditional).
 */
export function combineStreamSafety(
  accumulated: StreamSafetyResult,
  next: StreamSafetyResult,
): StreamSafetyResult {
  // Nothing has contributed yet: the first real stream's verdict *is* the
  // accumulated verdict so far, whether safe or not.
  if (accumulated.reason === NOT_YET_OBSERVED_REASON) {
    return next;
  }
  // Sticky-unsafe: a real (non-initial) unsafe verdict already recorded for
  // this turn can never be overridden by a later stream, safe or not.
  if (!accumulated.confirmedSafe) {
    return accumulated;
  }
  // Every stream so far has been safe — the latest stream's own verdict
  // decides whether that streak continues.
  return next;
}
