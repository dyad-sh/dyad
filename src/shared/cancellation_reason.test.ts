import { describe, expect, it } from "vitest";
import { CancellationReason, getCancellationInfo } from "./cancellation_reason";
import { describeTestRunStop } from "./test_run_stop";

describe("CancellationReason", () => {
  it("is an AbortError so existing abort detection is unchanged", () => {
    const reason = new CancellationReason("chat-stop");
    expect(reason).toBeInstanceOf(DOMException);
    expect(reason).toBeInstanceOf(Error);
    expect(reason.name).toBe("AbortError");
    expect(reason.message).toBe("The chat response was stopped.");
  });

  it("survives AbortSignal.any composition so nested work sees the cause", () => {
    const turn = new AbortController();
    const toolCall = new AbortController();
    const composed = AbortSignal.any([turn.signal, toolCall.signal]);
    turn.abort(new CancellationReason("chat-deleted"));
    expect(getCancellationInfo(composed.reason)).toEqual({
      kind: "chat-deleted",
    });
    expect(() => composed.throwIfAborted()).toThrow("The chat was deleted.");
  });

  it("keeps canceller detail and reports nothing for a reasonless abort", () => {
    const reason = new CancellationReason(
      "claude-code-call-abandoned",
      "MCP error -32001: Request timed out",
    );
    expect(reason.message).toBe(
      "Claude Code stopped waiting for this tool call: MCP error -32001: Request timed out",
    );
    expect(getCancellationInfo(reason)).toEqual({
      kind: "claude-code-call-abandoned",
      detail: "MCP error -32001: Request timed out",
    });
    expect(getCancellationInfo(AbortSignal.abort().reason)).toBeUndefined();
    expect(getCancellationInfo(new Error("boom"))).toBeUndefined();
  });
});

describe("describeTestRunStop", () => {
  it("names the cause, keeping the historical text when none was recorded", () => {
    expect(describeTestRunStop(undefined)).toBe("Test run stopped.");
    expect(describeTestRunStop(undefined, { beforeExecution: true })).toBe(
      "Test run stopped before execution.",
    );
    expect(describeTestRunStop({ kind: "tests-panel-stop" })).toBe(
      "Test run stopped from the Tests panel.",
    );
    expect(
      describeTestRunStop({ kind: "chat-stop" }, { beforeExecution: true }),
    ).toBe(
      "Test run stopped before execution because the chat response that started it was stopped.",
    );
    expect(
      describeTestRunStop({
        kind: "claude-code-call-abandoned",
        detail: "Request timed out",
      }),
    ).toBe(
      "Test run stopped because Claude Code stopped waiting for the run_tests call: Request timed out.",
    );
  });
});
