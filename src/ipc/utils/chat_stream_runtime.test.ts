import { describe, expect, it, vi } from "vitest";
import { ChatStreamRuntimeState } from "./chat_stream_runtime";

describe("ChatStreamRuntimeState", () => {
  it("releases the controller and accumulated response after success", () => {
    const runtime = new ChatStreamRuntimeState();
    const controller = new AbortController();

    runtime.start(42, controller);
    runtime.setPartialResponse(42, "a large successful response");
    runtime.finish(42);

    expect(runtime.hasController(42)).toBe(false);
    expect(runtime.hasPartialResponse(42)).toBe(false);
    expect(runtime.getPartialResponse(42)).toBe("");
  });

  it("aborts and releases all streams during shutdown", () => {
    const runtime = new ChatStreamRuntimeState();
    const first = new AbortController();
    const second = new AbortController();
    const firstAbort = vi.spyOn(first, "abort");
    const secondAbort = vi.spyOn(second, "abort");

    runtime.start(1, first);
    runtime.start(2, second);
    runtime.setPartialResponse(1, "one");
    runtime.setPartialResponse(2, "two");
    runtime.abortAll();

    expect(firstAbort).toHaveBeenCalledOnce();
    expect(secondAbort).toHaveBeenCalledOnce();
    expect(runtime.hasController(1)).toBe(false);
    expect(runtime.hasPartialResponse(2)).toBe(false);
  });
});
