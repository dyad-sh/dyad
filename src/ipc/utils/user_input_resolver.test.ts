import { afterEach, describe, expect, it, vi } from "vitest";
import { createUserInputResolver } from "./user_input_resolver";

describe("createUserInputResolver", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves correlated input and reports stale responses", async () => {
    const resolver = createUserInputResolver<string>();
    const pending = resolver.wait("request-1", 7);

    expect(resolver.resolve("missing", "nope")).toBe(false);
    expect(resolver.resolve("request-1", "accepted")).toBe(true);
    await expect(pending).resolves.toBe("accepted");
  });

  it("aborts by chat without disturbing another chat", async () => {
    const resolver = createUserInputResolver<string>();
    const first = resolver.wait("first", 1);
    const second = resolver.wait("second", 2);

    resolver.abortChat(1);
    await expect(first).resolves.toBeNull();
    expect(resolver.resolve("second", "kept")).toBe(true);
    await expect(second).resolves.toBe("kept");
  });

  it("settles on abort and timeout", async () => {
    vi.useFakeTimers();
    const resolver = createUserInputResolver<string>({ timeoutMs: 1_000 });
    const controller = new AbortController();
    const aborted = resolver.wait("aborted", 1, controller.signal);
    const timedOut = resolver.wait("timed-out", 2);

    controller.abort();
    await expect(aborted).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(timedOut).resolves.toBeNull();
  });

  it("settles every waiter during teardown", async () => {
    const resolver = createUserInputResolver<string>();
    const pending = [resolver.wait("one", 1), resolver.wait("two", 2)];
    resolver.abortAll();
    await expect(Promise.all(pending)).resolves.toEqual([null, null]);
  });
});
