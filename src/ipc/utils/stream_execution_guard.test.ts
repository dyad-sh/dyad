import { describe, it, expect } from "vitest";
import {
  createStreamSafetyTracker,
  observeStreamPart,
  resolveStreamSafety,
} from "./stream_execution_guard";

describe("stream_execution_guard", () => {
  // A. Safe execution: a normal, unaborted stream that finishes with a
  // "stop" finishReason is confirmed safe.
  it("confirms safety when the stream finishes normally", () => {
    const tracker = createStreamSafetyTracker();
    observeStreamPart(tracker, { type: "text-delta", id: "1", text: "hi" });
    observeStreamPart(tracker, { type: "finish", finishReason: "stop" });

    const result = resolveStreamSafety(tracker);

    expect(result.confirmedSafe).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("confirms safety when the stream finishes via tool-calls", () => {
    const tracker = createStreamSafetyTracker();
    observeStreamPart(tracker, {
      type: "finish",
      finishReason: "tool-calls",
    });

    const result = resolveStreamSafety(tracker);

    expect(result.confirmedSafe).toBe(true);
  });

  // B. Length cutoff: well-formed `<dyad-write>` tags can precede a
  // generation that gets cut off by a token limit. This is the exact
  // scenario stream_execution_guard.ts exists to catch — a well-formed tag
  // is not proof the whole response finished safely.
  it("does not confirm safety when the stream is cut off by a token limit", () => {
    const tracker = createStreamSafetyTracker();
    observeStreamPart(tracker, {
      type: "text-delta",
      id: "1",
      text: '<dyad-write path="a.ts">complete content</dyad-write>',
    });
    observeStreamPart(tracker, { type: "finish", finishReason: "length" });

    const result = resolveStreamSafety(tracker);

    expect(result.confirmedSafe).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).not.toBe("complete");
  });

  // C. Truncated arguments (dyad-specific reading): the response-level
  // synthetic call is tracked under a fixed id separate from any real MCP
  // tool call the model may have also made in the same turn. A genuinely
  // truncated *unrelated* tool call must not leak into, or otherwise affect,
  // the response-level safety decision.
  it("is unaffected by a truncated, unrelated real tool call observed on the same stream", () => {
    const tracker = createStreamSafetyTracker();
    observeStreamPart(tracker, {
      type: "tool-input-start",
      id: "real-tool-call-1",
      toolName: "some_mcp_tool",
    });
    observeStreamPart(tracker, {
      type: "tool-input-delta",
      id: "real-tool-call-1",
      delta: '{"unterminated": "st',
    });
    // No tool-input-end for the real call — it never closes.
    observeStreamPart(tracker, { type: "finish", finishReason: "stop" });

    const result = resolveStreamSafety(tracker);

    expect(result.confirmedSafe).toBe(true);
  });

  // D. Provider error.
  it("does not confirm safety on a provider error part", () => {
    const tracker = createStreamSafetyTracker();
    observeStreamPart(tracker, {
      type: "error",
      error: new Error("upstream provider failed"),
    });

    const result = resolveStreamSafety(tracker);

    expect(result.confirmedSafe).toBe(false);
    expect(result.reason).not.toBe("complete");
  });

  it("does not confirm safety when finish reports finishReason: error", () => {
    const tracker = createStreamSafetyTracker();
    observeStreamPart(tracker, { type: "finish", finishReason: "error" });

    const result = resolveStreamSafety(tracker);

    expect(result.confirmedSafe).toBe(false);
  });

  // E. Unknown / unconfirmed terminal state: the stream is consumed to
  // exhaustion (e.g. an unexpected disconnect) without ever producing its
  // own finish/error/abort part, and the caller resolves with no fallback
  // meta either. Must fail closed, not default to safe.
  it("does not confirm safety when the stream ends with no terminal part and no fallback meta", () => {
    const tracker = createStreamSafetyTracker();
    observeStreamPart(tracker, { type: "text-delta", id: "1", text: "hi" });
    // Stream just... ends. No finish/error/abort ever observed.

    const result = resolveStreamSafety(tracker);

    expect(result.confirmedSafe).toBe(false);
  });

  // F. Abort.
  it("does not confirm safety when the stream reports abort", () => {
    const tracker = createStreamSafetyTracker();
    observeStreamPart(tracker, { type: "text-delta", id: "1", text: "hi" });
    observeStreamPart(tracker, { type: "abort" });

    const result = resolveStreamSafety(tracker);

    expect(result.confirmedSafe).toBe(false);
  });

  // G. Concurrency: two independently-created trackers use the exact same
  // fixed synthetic id (by design). Resolving them in adversarial order —
  // the unsafe one first, or interleaved — must never let one leak into the
  // other's decision, because each tracker owns a brand-new underlying
  // guard instance with no shared state.
  it("never cross-resolves two independent trackers that share the same synthetic id", () => {
    const safeTracker = createStreamSafetyTracker();
    const unsafeTracker = createStreamSafetyTracker();

    // Interleave observation across both trackers, unsafe resolved first.
    observeStreamPart(unsafeTracker, {
      type: "finish",
      finishReason: "length",
    });
    const unsafeResult = resolveStreamSafety(unsafeTracker);

    observeStreamPart(safeTracker, { type: "finish", finishReason: "stop" });
    const safeResult = resolveStreamSafety(safeTracker);

    expect(unsafeResult.confirmedSafe).toBe(false);
    expect(safeResult.confirmedSafe).toBe(true);
  });

  it("never cross-resolves when the safe tracker is resolved first", () => {
    const safeTracker = createStreamSafetyTracker();
    const unsafeTracker = createStreamSafetyTracker();

    observeStreamPart(safeTracker, { type: "finish", finishReason: "stop" });
    const safeResult = resolveStreamSafety(safeTracker);

    observeStreamPart(unsafeTracker, { type: "abort" });
    const unsafeResult = resolveStreamSafety(unsafeTracker);

    expect(safeResult.confirmedSafe).toBe(true);
    expect(unsafeResult.confirmedSafe).toBe(false);
  });

  // H. Cleanup / stale resolution: resolving the same tracker a second time
  // (e.g. a defensive double-call) must not flip a rejected outcome into an
  // executed one, and must not throw.
  it("resolving the same tracker twice never flips reject to execute", () => {
    const tracker = createStreamSafetyTracker();
    observeStreamPart(tracker, { type: "finish", finishReason: "length" });

    const first = resolveStreamSafety(tracker);
    const second = resolveStreamSafety(tracker);

    expect(first.confirmedSafe).toBe(false);
    expect(second.confirmedSafe).toBe(false);
  });

  it("resolving the same safe tracker twice stays safe both times", () => {
    const tracker = createStreamSafetyTracker();
    observeStreamPart(tracker, { type: "finish", finishReason: "stop" });

    const first = resolveStreamSafety(tracker);
    const second = resolveStreamSafety(tracker);

    expect(first.confirmedSafe).toBe(true);
    expect(second.confirmedSafe).toBe(true);
  });

  // A fresh, never-observed tracker (nothing pushed at all beyond the
  // constructor's own placeholder registration) must fail closed rather
  // than default to safe when resolved.
  it("fails closed when resolved with nothing observed at all", () => {
    const tracker = createStreamSafetyTracker();
    const result = resolveStreamSafety(tracker);
    expect(result.confirmedSafe).toBe(false);
  });

  // Malformed terminal event: an unrecognized finishReason literal (not one
  // of the AI SDK's documented values) must fail closed, not be treated as
  // an implicit success.
  it("fails closed on an unrecognized finishReason value", () => {
    const tracker = createStreamSafetyTracker();
    observeStreamPart(tracker, { type: "finish", finishReason: "other" });

    const result = resolveStreamSafety(tracker);

    expect(result.confirmedSafe).toBe(false);
  });

  // Malformed terminal event: a completely garbage (non-object) raw part
  // must not throw and must not be treated as confirming safety.
  it("does not throw and fails closed when a non-object part is observed", () => {
    const tracker = createStreamSafetyTracker();
    expect(() => observeStreamPart(tracker, "not-an-object")).not.toThrow();
    expect(() => observeStreamPart(tracker, null)).not.toThrow();

    const result = resolveStreamSafety(tracker);

    expect(result.confirmedSafe).toBe(false);
  });

  // Events observed after a terminal part (finish) must not be able to flip
  // an already-unsafe outcome back to safe — the underlying adapter treats
  // the stream as finished once its first terminal event is seen.
  it("ignores events observed after the stream has already reported finish", () => {
    const tracker = createStreamSafetyTracker();
    observeStreamPart(tracker, { type: "finish", finishReason: "length" });
    // A spurious late "stop" must not override the already-recorded length
    // cutoff.
    observeStreamPart(tracker, { type: "finish", finishReason: "stop" });

    const result = resolveStreamSafety(tracker);

    expect(result.confirmedSafe).toBe(false);
  });
});
